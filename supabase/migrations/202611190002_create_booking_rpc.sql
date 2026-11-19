-- Atomic booking creation: snapshots current product selling/cost prices.
-- Does not change product stock, existing sales, invoices, or customer records.

create or replace function public.create_booking(
  p_customer_id uuid,
  p_items jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking_id uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty integer;
  v_selling_total numeric(12,2) := 0;
  v_cost_total numeric(12,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create an order.';
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Please select a valid customer.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the order.';
  end if;

  insert into public.bookings (customer_id, notes)
  values (p_customer_id, nullif(trim(coalesce(p_notes, '')), ''))
  returning id into v_booking_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty is null or v_qty < 1 then
      raise exception 'Product quantity must be at least 1.';
    end if;

    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid;

    if not found then
      raise exception 'One of the selected products no longer exists.';
    end if;

    insert into public.booking_items (
      booking_id, product_id, product_name, quantity,
      selling_price, cost_price, selling_subtotal, cost_subtotal
    ) values (
      v_booking_id, v_product.id, v_product.name, v_qty,
      coalesce(v_product.price, 0), coalesce(v_product.cost, 0),
      round(coalesce(v_product.price, 0) * v_qty, 2),
      round(coalesce(v_product.cost, 0) * v_qty, 2)
    );

    v_selling_total := v_selling_total + coalesce(v_product.price, 0) * v_qty;
    v_cost_total := v_cost_total + coalesce(v_product.cost, 0) * v_qty;
  end loop;

  update public.bookings
  set total_selling = round(v_selling_total, 2),
      total_cost = round(v_cost_total, 2)
  where id = v_booking_id;

  return v_booking_id;
end;
$$;

revoke all on function public.create_booking(uuid, jsonb, text) from public;
grant execute on function public.create_booking(uuid, jsonb, text) to authenticated;
