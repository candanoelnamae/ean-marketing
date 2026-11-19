-- Idempotent invoice creation for offline queue synchronization.
-- Keeps the original create_invoice business rules: server-side prices,
-- stock locking/deduction, invoice_items, sales, and optional initial payment.

create table if not exists public.invoice_creation_request_keys (
  client_request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id),
  items jsonb not null,
  discount numeric,
  amount_paid numeric,
  due_date date,
  notes text,
  invoice_id uuid references public.invoices(id),
  created_at timestamptz not null default now()
);

alter table public.invoice_creation_request_keys enable row level security;
revoke all on public.invoice_creation_request_keys from public, anon, authenticated;

create or replace function public.create_invoice_idempotent(
  p_client_request_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_discount numeric,
  p_amount_paid numeric,
  p_due_date date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_line record;
  v_product public.products%rowtype;
  v_invoice_id uuid;
  v_invoice_number text;
  v_subtotal numeric(12,2) := 0;
  v_discount numeric(12,2);
  v_total numeric(12,2);
  v_paid numeric(12,2);
  v_balance numeric(12,2);
  v_status text;
  v_inserted uuid;
  v_existing public.invoice_creation_request_keys%rowtype;
begin
  if v_user_id is null then
    raise exception 'Please log in first';
  end if;
  if p_client_request_id is null then
    raise exception 'A unique invoice request ID is required';
  end if;
  if p_customer_id is null then
    raise exception 'Choose a customer for this invoice';
  end if;
  if jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product to the invoice';
  end if;

  insert into public.invoice_creation_request_keys(
    client_request_id,user_id,customer_id,items,discount,amount_paid,due_date,notes
  ) values (
    p_client_request_id,v_user_id,p_customer_id,p_items,p_discount,p_amount_paid,p_due_date,p_notes
  )
  on conflict(client_request_id) do nothing
  returning client_request_id into v_inserted;

  if v_inserted is null then
    select * into v_existing
    from public.invoice_creation_request_keys
    where client_request_id=p_client_request_id;

    if v_existing.user_id <> v_user_id
       or v_existing.customer_id <> p_customer_id
       or v_existing.items is distinct from p_items
       or v_existing.discount is distinct from p_discount
       or v_existing.amount_paid is distinct from p_amount_paid
       or v_existing.due_date is distinct from p_due_date
       or v_existing.notes is distinct from p_notes then
      raise exception 'This invoice request ID was already used for different invoice details';
    end if;

    if v_existing.invoice_id is null then
      raise exception 'The earlier invoice request is still being processed. Please retry shortly.';
    end if;
    return v_existing.invoice_id;
  end if;

  -- Lock products in a consistent order and calculate subtotal using
  -- authoritative current server prices.
  for v_line in
    select product_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items)
      as x(product_id uuid, quantity integer)
    group by product_id
    order by product_id
  loop
    if v_line.product_id is null or v_line.quantity is null
       or v_line.quantity <= 0 then
      raise exception 'Invalid product or quantity';
    end if;

    select * into v_product
    from public.products
    where id = v_line.product_id
    for update;

    if not found then
      raise exception 'Product not found';
    end if;
    if v_product.stock < v_line.quantity then
      raise exception 'Not enough stock for %', v_product.name;
    end if;
    if v_product.price is null or v_product.price <= 0 then
      raise exception 'Invalid selling price for %', v_product.name;
    end if;
    v_subtotal := v_subtotal + (v_product.price * v_line.quantity);
  end loop;

  v_discount := coalesce(p_discount, 0);
  v_paid := coalesce(p_amount_paid, 0);
  if v_discount < 0 or v_discount > v_subtotal then
    raise exception 'Invalid discount amount';
  end if;
  v_total := v_subtotal - v_discount;
  if v_paid < 0 or v_paid > v_total then
    raise exception 'Initial payment cannot exceed invoice total';
  end if;
  v_balance := v_total - v_paid;

  if v_balance = 0 then
    v_status := 'PAID';
  elsif v_paid > 0 then
    v_status := 'PARTIAL';
  else
    v_status := 'UNPAID';
  end if;

  v_invoice_number :=
    'INV-' || to_char(now(), 'YYYYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.invoices (
    invoice_number, customer_id, subtotal, discount,
    total, amount_paid, balance, payment_status,
    due_date, notes, created_by
  )
  values (
    v_invoice_number, p_customer_id, v_subtotal, v_discount,
    v_total, v_paid, v_balance, v_status,
    p_due_date, p_notes, v_user_id
  )
  returning id into v_invoice_id;

  -- Save invoice lines, deduct inventory, and record sales exactly once.
  for v_line in
    select product_id, sum(quantity)::integer as quantity
    from jsonb_to_recordset(p_items)
      as x(product_id uuid, quantity integer)
    group by product_id
    order by product_id
  loop
    select * into v_product
    from public.products
    where id = v_line.product_id;

    update public.products
    set stock = stock - v_line.quantity,
        updated_at = now()
    where id = v_line.product_id;

    insert into public.invoice_items (
      invoice_id, product_id, product_name,
      quantity, unit_price, line_total
    )
    values (
      v_invoice_id, v_product.id, v_product.name,
      v_line.quantity, v_product.price,
      v_product.price * v_line.quantity
    );

    insert into public.sales (
      product_id, quantity, unit_price,
      total_amount, profit, sold_by
    )
    values (
      v_product.id, v_line.quantity, v_product.price,
      v_product.price * v_line.quantity,
      (v_product.price - v_product.cost) * v_line.quantity,
      v_user_id
    );
  end loop;

  if v_paid > 0 then
    insert into public.payments (
      invoice_id, amount, payment_method, received_by
    )
    values (
      v_invoice_id, v_paid, 'CASH', v_user_id
    );
  end if;

  update public.invoice_creation_request_keys
  set invoice_id=v_invoice_id
  where client_request_id=p_client_request_id;

  return v_invoice_id;
end;
$function$;

revoke all on function public.create_invoice_idempotent(uuid,uuid,jsonb,numeric,numeric,date,text) from public;
grant execute on function public.create_invoice_idempotent(uuid,uuid,jsonb,numeric,numeric,date,text) to authenticated;
