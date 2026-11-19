-- Admin user-management foundation.
-- Adds a forced-password-change flag and role/module permission settings.
-- Existing profile rows and ADMIN/USER roles are preserved.

alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

create table if not exists public.role_permissions (
  role text not null check (role in ('ADMIN', 'USER')),
  module text not null check (
    module in (
      'products',
      'sales',
      'bookings',
      'booking_search',
      'customers',
      'billing',
      'vendors',
      'expenses',
      'reports',
      'settings'
    )
  ),
  can_view boolean not null default false,
  can_add boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (role, module)
);

alter table public.role_permissions enable row level security;

-- Signed-in users may read the permission matrix so the app can render
-- the correct navigation and controls.
drop policy if exists "Authenticated users can read role permissions"
  on public.role_permissions;
create policy "Authenticated users can read role permissions"
  on public.role_permissions
  for select
  to authenticated
  using (true);

-- Only an existing ADMIN profile may change permission settings.
drop policy if exists "Admins can insert role permissions"
  on public.role_permissions;
create policy "Admins can insert role permissions"
  on public.role_permissions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'ADMIN'
    )
  );

drop policy if exists "Admins can update role permissions"
  on public.role_permissions;
create policy "Admins can update role permissions"
  on public.role_permissions
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'ADMIN'
    )
  )
  with check (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'ADMIN'
    )
  );

drop policy if exists "Admins can delete role permissions"
  on public.role_permissions;
create policy "Admins can delete role permissions"
  on public.role_permissions
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'ADMIN'
    )
  );

-- Preserve current access expectations: admins receive every permission;
-- standard users can view/add/edit operational records but cannot delete or
-- access admin settings by default. Admin can change these later in the app.
insert into public.role_permissions
  (role, module, can_view, can_add, can_edit, can_delete)
values
  ('ADMIN', 'products', true, true, true, true),
  ('ADMIN', 'sales', true, true, true, true),
  ('ADMIN', 'bookings', true, true, true, true),
  ('ADMIN', 'booking_search', true, true, true, true),
  ('ADMIN', 'customers', true, true, true, true),
  ('ADMIN', 'billing', true, true, true, true),
  ('ADMIN', 'vendors', true, true, true, true),
  ('ADMIN', 'expenses', true, true, true, true),
  ('ADMIN', 'reports', true, true, true, true),
  ('ADMIN', 'settings', true, true, true, true),
  ('USER', 'products', true, true, true, false),
  ('USER', 'sales', true, true, false, false),
  ('USER', 'bookings', true, true, true, false),
  ('USER', 'booking_search', true, false, false, false),
  ('USER', 'customers', true, true, true, false),
  ('USER', 'billing', true, true, true, false),
  ('USER', 'vendors', true, true, true, false),
  ('USER', 'expenses', true, true, true, false),
  ('USER', 'reports', true, false, false, false),
  ('USER', 'settings', false, false, false, false)
on conflict (role, module) do nothing;
