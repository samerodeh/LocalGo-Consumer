-- Run after schema.sql in the Supabase SQL editor as the project administrator.
-- This changes authorization only; existing accounts and orders are retained.
begin;

create table if not exists public.approved_drivers (
  id uuid primary key references auth.users(id) on delete cascade,
  singleton boolean not null default true unique check (singleton = true)
);
alter table public.approved_drivers enable row level security;
revoke all on public.approved_drivers from anon, authenticated;
grant select on public.approved_drivers to authenticated;
drop policy if exists "driver reads own approval" on public.approved_drivers;
create policy "driver reads own approval" on public.approved_drivers
  for select to authenticated using (id = auth.uid());
-- No client INSERT/UPDATE/DELETE policy: approval is administrator-managed.
-- The singleton constraint makes approving a second driver impossible.

-- Legacy anonymous insertion is removed by the activation migration after backend deployment.
drop policy if exists "customer inserts own order" on public.orders;
create policy "customer inserts own order" on public.orders
  for insert to authenticated with check (
    customer_id = auth.uid() and accepted_by is null
    and status = 'available' and delivery_status = 'available'
  );
drop policy if exists "authenticated can read orders" on public.orders;
create policy "authenticated can read orders" on public.orders
  for select to authenticated using (
    customer_id = auth.uid() or exists (select 1 from public.approved_drivers where id = auth.uid())
  );
drop policy if exists "authenticated can update orders" on public.orders;
drop policy if exists "driver can claim an available order" on public.orders;
create policy "driver can claim an available order" on public.orders
  for update to authenticated
  using (accepted_by is null and exists (select 1 from public.approved_drivers where id = auth.uid()))
  with check (accepted_by = auth.uid() and exists (select 1 from public.approved_drivers where id = auth.uid()));
drop policy if exists "driver can update own claimed order" on public.orders;
create policy "driver can update own claimed order" on public.orders
  for update to authenticated
  using (accepted_by = auth.uid() and exists (select 1 from public.approved_drivers where id = auth.uid()))
  with check (accepted_by = auth.uid() and exists (select 1 from public.approved_drivers where id = auth.uid()));

drop policy if exists "driver can insert own profile" on public.drivers;
drop policy if exists "authenticated can read drivers" on public.drivers;
create policy "authenticated can read drivers" on public.drivers
  for select to authenticated using (id = auth.uid());

-- Restrictive policies also protect against legacy permissive overlay policies.
drop policy if exists "approved driver overlay access" on public.driver_orders;
create policy "approved driver overlay access" on public.driver_orders as restrictive
  for all to authenticated
  using (driver_id = auth.uid() and exists (select 1 from public.approved_drivers where id = auth.uid()))
  with check (driver_id = auth.uid() and exists (select 1 from public.approved_drivers where id = auth.uid()));

commit;

-- Once Samer supplies the existing driver's email, approve that account with:
-- insert into public.approved_drivers (id)
-- select id from auth.users where lower(email) = lower('DRIVER_EMAIL_HERE');
-- Confirm this inserts exactly one row. No driver is approved automatically.
