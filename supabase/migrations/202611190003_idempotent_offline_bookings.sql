-- Safe, idempotent booking creation for offline retries.
-- Existing booking rows and reference numbers are preserved.
alter table public.bookings
  add column if not exists client_request_id uuid;

create unique index if not exists bookings_client_request_id_uidx
  on public.bookings(client_request_id)
  where client_request_id is not null;

drop function if exists public.create_booking(uuid, jsonb, text);
drop function if exists public.create_booking(uuid, jsonb, text, uuid);

create or replace function public.create_booking(
  p_customer_id uuid,
  p_items jsonb,
  p_notes text,
  p_client_request_id uuid,
  p_use_snapshots boolean default false
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
  v_selling_price numeric(12,2);
  v_cost_price numeric(12,2);
  v_product_name text;
  v_selling_total numeric(12,2) := 0;
  v_cost_total numeric(12,2) := 0;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to create an order.';
  end if;
  if p_client_request_id is null then
    raise exception 'A unique order request ID is required.';
  end if;

  insert into public.bookings (customer_id, notes, client_request_id)
  values (p_customer_id, nullif(trim(coalesce(p_notes, '')), ''), p_client_request_id)
  on conflict (client_request_id) where client_request_id is not null
  do nothing
  returning id into v_booking_id;

  if v_booking_id is null then
    select id into v_booking_id
    from public.bookings
    where client_request_id = p_client_request_id;
    return v_booking_id;
  end if;

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Please select a valid customer.';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the order.';
  end if;

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

    v_selling_price := case when p_use_snapshots then coalesce((v_item->>'selling_price')::numeric, v_product.price, 0) else coalesce(v_product.price, 0) end;
    v_cost_price := case when p_use_snapshots then coalesce((v_item->>'cost_price')::numeric, v_product.cost, 0) else coalesce(v_product.cost, 0) end;
    v_product_name := case when p_use_snapshots then coalesce(nullif(v_item->>'product_name', ''), v_product.name) else v_product.name end;
    if v_selling_price < 0 or v_cost_price < 0 then
      raise exception 'Product prices cannot be negative.';
    end if;

    insert into public.booking_items (
      booking_id, product_id, product_name, quantity,
      selling_price, cost_price, selling_subtotal, cost_subtotal
    ) values (
      v_booking_id, v_product.id, v_product_name, v_qty,
      v_selling_price, v_cost_price,
      round(v_selling_price * v_qty, 2),
      round(v_cost_price * v_qty, 2)
    );
    v_selling_total := v_selling_total + v_selling_price * v_qty;
    v_cost_total := v_cost_total + v_cost_price * v_qty;
  end loop;

  update public.bookings
  set total_selling = round(v_selling_total, 2),
      total_cost = round(v_cost_total, 2)
  where id = v_booking_id;
  return v_booking_id;
end;
$$;

revoke all on function public.create_booking(uuid, jsonb, text, uuid, boolean) from public;
grant execute on function public.create_booking(uuid, jsonb, text, uuid, boolean) to authenticated;
