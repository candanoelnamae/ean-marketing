-- Retry-safe invoice payment recording for offline queue synchronization.
-- The existing record_invoice_payment RPC remains responsible for validating
-- invoice balance and updating the invoice/payment tables.

create table if not exists public.invoice_payment_request_keys (
  client_request_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  payment_method text not null,
  reference_number text,
  payment_id uuid,
  created_at timestamptz not null default now()
);

alter table public.invoice_payment_request_keys enable row level security;

create or replace function public.record_invoice_payment_idempotent(
  p_client_request_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_inserted uuid;
  v_existing public.invoice_payment_request_keys%rowtype;
  v_payment_id uuid;
begin
  if v_user_id is null then
    raise exception 'You must be signed in to record a payment.';
  end if;
  if p_client_request_id is null then
    raise exception 'A unique payment request ID is required.';
  end if;
  if p_invoice_id is null or p_amount is null or p_amount <= 0 then
    raise exception 'Choose an invoice and enter a payment amount greater than zero.';
  end if;
  if coalesce(trim(p_payment_method),'') = '' then
    raise exception 'A payment method is required.';
  end if;

  insert into public.invoice_payment_request_keys(
    client_request_id,user_id,invoice_id,amount,payment_method,reference_number
  ) values (
    p_client_request_id,v_user_id,p_invoice_id,p_amount,p_payment_method,p_reference_number
  )
  on conflict(client_request_id) do nothing
  returning client_request_id into v_inserted;

  if v_inserted is null then
    select * into v_existing
    from public.invoice_payment_request_keys
    where client_request_id=p_client_request_id;

    if v_existing.user_id <> v_user_id
       or v_existing.invoice_id <> p_invoice_id
       or v_existing.amount <> p_amount
       or v_existing.payment_method <> p_payment_method
       or v_existing.reference_number is distinct from p_reference_number then
      raise exception 'This payment request ID was already used for a different payment.';
    end if;

    if v_existing.payment_id is null then
      raise exception 'The earlier payment request is still being processed. Please retry shortly.';
    end if;
    return v_existing.payment_id;
  end if;

  v_payment_id := public.record_invoice_payment(
    p_invoice_id,p_amount,p_payment_method,p_reference_number
  );

  update public.invoice_payment_request_keys
  set payment_id=v_payment_id
  where client_request_id=p_client_request_id;

  return v_payment_id;
end;
$$;

revoke all on function public.record_invoice_payment_idempotent(uuid,uuid,numeric,text,text) from public;
grant execute on function public.record_invoice_payment_idempotent(uuid,uuid,numeric,text,text) to authenticated;
