-- EAN Marketing bookings / orders
-- Apply in Supabase SQL Editor. Existing sales and invoice records are untouched.

create sequence if not exists public.booking_reference_seq;

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference_number text unique,
  customer_id uuid not null references public.customers(id) on delete restrict,
  status text not null default 'PENDING'
    check (status in ('PENDING','CONFIRMED','COMPLETED','CANCELLED')),
  total_selling numeric(12,2) not null default 0,
  total_cost numeric(12,2) not null default 0,
  notes text,
  created_by uuid references auth.users(id),
  created_by_name text,
  updated_by uuid references auth.users(id),
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  selling_price numeric(12,2) not null check (selling_price >= 0),
  cost_price numeric(12,2) not null check (cost_price >= 0),
  selling_subtotal numeric(12,2) not null,
  cost_subtotal numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create or replace function public.set_booking_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.reference_number := 'ORD-' || lpad(nextval('public.booking_reference_seq')::text, 6, '0');
    new.created_by := auth.uid();
    select full_name into new.created_by_name from public.profiles where id = auth.uid();
  else
    new.updated_by := auth.uid();
    select full_name into new.updated_by_name from public.profiles where id = auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists bookings_set_metadata on public.bookings;
create trigger bookings_set_metadata
before insert or update on public.bookings
for each row execute function public.set_booking_metadata();

alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;

drop policy if exists "Signed-in users can view bookings" on public.bookings;
create policy "Signed-in users can view bookings" on public.bookings
for select to authenticated using (true);

drop policy if exists "Signed-in users can create bookings" on public.bookings;
create policy "Signed-in users can create bookings" on public.bookings
for insert to authenticated with check (auth.uid() = created_by);

drop policy if exists "Signed-in users can update bookings" on public.bookings;
create policy "Signed-in users can update bookings" on public.bookings
for update to authenticated using (true) with check (true);

drop policy if exists "Signed-in users can view booking items" on public.booking_items;
create policy "Signed-in users can view booking items" on public.booking_items
for select to authenticated using (true);

drop policy if exists "Signed-in users can add booking items" on public.booking_items;
create policy "Signed-in users can add booking items" on public.booking_items
for insert to authenticated with check (true);

drop policy if exists "Signed-in users can update booking items" on public.booking_items;
create policy "Signed-in users can update booking items" on public.booking_items
for update to authenticated using (true) with check (true);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.bookings; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.booking_items; exception when duplicate_object then null; end;
  end if;
end $$;
