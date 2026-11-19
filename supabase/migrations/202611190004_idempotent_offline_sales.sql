-- Idempotent wrapper for the existing stock-aware record_sale RPC.
-- The original record_sale function remains the single place that changes stock
-- and inserts the sale. This wrapper records a stable request ID in the same
-- database transaction, so a retry cannot apply the sale twice.

create table if not exists public.sale_request_keys (
  client_request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now()
);

alter table public.sale_request_keys enable row level security;

create or replace function public.record_sale_idempotent(
  p_client_request_id uuid,
  p_product_id uuid,
  p_quantity integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted_id uuid;
  v_existing public.sale_request_keys%rowtype;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to record a sale.';
  end if;
  if p_client_request_id is null then
    raise exception 'A unique sale request ID is required.';
  end if;
  if p_product_id is null or p_quantity is null or p_quantity < 1 then
    raise exception 'Choose a product and enter a quantity of at least 1.';
  end if;

  insert into public.sale_request_keys(client_request_id,user_id,product_id,quantity)
  values(p_client_request_id,v_user_id,p_product_id,p_quantity)
  on conflict(client_request_id) do nothing
  returning client_request_id into v_inserted_id;

  if v_inserted_id is null then
    select * into v_existing
    from public.sale_request_keys
    where client_request_id=p_client_request_id;

    if v_existing.user_id <> v_user_id
       or v_existing.product_id <> p_product_id
       or v_existing.quantity <> p_quantity then
      raise exception 'This sale request ID was already used for a different sale.';
    end if;
    return p_client_request_id;
  end if;

  -- The original RPC performs the authoritative stock check and sale insert.
  -- If it fails, this transaction (including the request key) rolls back.
  perform public.record_sale(p_product_id,p_quantity);
  return p_client_request_id;
end;
$$;

revoke all on function public.record_sale_idempotent(uuid,uuid,integer) from public;
grant execute on function public.record_sale_idempotent(uuid,uuid,integer) to authenticated;
