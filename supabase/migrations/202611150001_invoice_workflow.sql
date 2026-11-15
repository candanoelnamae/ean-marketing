-- EAN Marketing invoice confirmation, signature, payment details, and numbering
-- Run this migration in the Supabase SQL Editor.

alter table public.invoices
  add column if not exists customer_signature text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by uuid,
  add column if not exists printed_at timestamptz;

alter table public.payments
  add column if not exists cash_denominations jsonb,
  add column if not exists cash_received numeric(12,2),
  add column if not exists cash_change numeric(12,2),
  add column if not exists gcash_sender_name text,
  add column if not exists gcash_sender_number text,
  add column if not exists gcash_receiver_number text;

-- A database sequence and trigger make invoice numbers unique even if two staff
-- members create invoices at nearly the same time.
create sequence if not exists public.invoice_number_seq;

do $$
declare
  last_number bigint;
begin
  select coalesce(
    max(nullif(substring(invoice_number from '([0-9]+)$'), '')::bigint),
    0
  )
  into last_number
  from public.invoices;

  if last_number > 0 then
    perform setval('public.invoice_number_seq', last_number, true);
  else
    perform setval('public.invoice_number_seq', 1, false);
  end if;
end $$;

create or replace function public.assign_invoice_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.invoice_number := 'INV-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
  return new;
end;
$$;

drop trigger if exists invoices_assign_invoice_number on public.invoices;
create trigger invoices_assign_invoice_number
before insert on public.invoices
for each row execute function public.assign_invoice_number();

create unique index if not exists invoices_invoice_number_unique
  on public.invoices (invoice_number);
