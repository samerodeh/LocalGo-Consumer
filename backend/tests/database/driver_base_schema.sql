-- LocalGO shared dispatch backend — idempotent, safe to re-run in the Supabase
-- SQL Editor at any time (re-running repairs any policy drift).
--
-- One Supabase project backs BOTH apps:
--   * LocalGODriverRN    — drivers sign in (Supabase Auth) and read the shared
--     order feed in real time; each driver's own progress lives in driver_orders.
--   * LocalGOConsumerRN  — customers sign in (Supabase Auth, own profile in
--     customers) and insert an order row (anon key) at checkout.
--
-- Column names/types match each app's mapRow()/auth store exactly. Customers
-- and drivers are both Supabase Auth users but never mix: separate profile
-- tables, and customers can only ever read their own row (drivers broadcast
-- read each other's since it's a shared dispatch board — different shape).

-- Orders: written once by the consumer (anon), read by every driver. The status
-- column is the birth value ('available') and is never updated — each driver's
-- lifecycle for an order lives in driver_orders.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  restaurant_name text not null,
  restaurant_address text not null,
  customer_name text not null,
  dropoff_address text not null,
  item_count int not null,
  order_total numeric not null,
  distance_km numeric not null,
  status text not null default 'available',
  items text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- Claim + customer-link columns (added idempotently so this file stays safe to
-- re-run against an existing project).
--   * customer_id  — the Supabase Auth uid of the consumer who placed the order,
--                    set at checkout so we can message that customer back.
--   * accepted_by  — the driver uid that claimed the order. NULL = still open.
--                    The first driver to set this wins (see claim policy below);
--                    once set, the order disappears from every other driver.
--   * accepted_at  — when it was claimed (drives the customer's ETA message).
--   * eta_minutes  — promised delivery window the driver commits to on accept.
alter table public.orders add column if not exists customer_id uuid;
alter table public.orders add column if not exists accepted_by uuid;
alter table public.orders add column if not exists accepted_at timestamptz;
alter table public.orders add column if not exists eta_minutes int;

-- Driver payout was removed from the product: drivers are not shown per-order
-- earnings. Drop the legacy column idempotently so existing projects lose it.
alter table public.orders drop column if exists payout;

-- Live delivery progression, mirrored onto the shared orders row so the CUSTOMER
-- (who cannot read the driver-private driver_orders overlay) can follow it in
-- real time. Written only by the driver who claimed the order (policy below).
--   * delivery_status — 'available' | 'accepted' | 'picked_up' | 'delivered'
--   * picked_up_at / delivered_at — when each milestone happened
--   * pickup_photo_url / dropoff_photo_url — proof photos the driver captures
alter table public.orders add column if not exists delivery_status text not null default 'available';
alter table public.orders add column if not exists picked_up_at timestamptz;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists pickup_photo_url text;
alter table public.orders add column if not exists dropoff_photo_url text;

-- Drivers: one row per driver, created on signup.
create table if not exists public.drivers (
  id uuid primary key,
  full_name text not null,
  phone text,
  vehicle_type text
);

-- Customers: one row per consumer account, created on signup. Unlike drivers
-- (broadcast-readable, shared dispatch board), customer profiles are private —
-- select is self-only.
create table if not exists public.customers (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null
);

-- Per-driver order state overlay. No row = 'available' for that driver, which
-- is what lets accounts created after an order still see it as new. References
-- auth.users (not public.drivers) because the profile row insert at signup is
-- best-effort client-side.
create table if not exists public.driver_orders (
  driver_id  uuid not null references auth.users (id) on delete cascade,
  order_id   uuid not null references public.orders (id) on delete cascade,
  status     text not null check (status in ('accepted', 'picked_up', 'delivered', 'declined')),
  updated_at timestamptz not null default now(),
  primary key (driver_id, order_id)
);

alter table public.orders enable row level security;
alter table public.drivers enable row level security;
alter table public.driver_orders enable row level security;
alter table public.customers enable row level security;

-- Consumer app uses the anon role and only inserts.
drop policy if exists "anon can insert orders" on public.orders;
create policy "anon can insert orders" on public.orders
  for insert to anon with check (true);

-- Every driver (authenticated) reads the whole feed — broadcast model.
drop policy if exists "authenticated can read orders" on public.orders;
create policy "authenticated can read orders" on public.orders
  for select to authenticated using (true);

-- Atomic claim: a driver may update an order ONLY while it is still unclaimed
-- (using: accepted_by is null) and ONLY to stamp themselves as the owner
-- (with check: accepted_by = auth.uid()). Two drivers racing to accept the same
-- order both target `accepted_by is null`, but Postgres serializes the writes —
-- the first commits, the second's WHERE no longer matches and it updates zero
-- rows, which the app reads as "already taken". Once claimed the row is frozen
-- to everyone (using clause fails), so it can never be stolen or corrupted.
drop policy if exists "authenticated can update orders" on public.orders; -- legacy name
drop policy if exists "driver can claim an available order" on public.orders;
create policy "driver can claim an available order" on public.orders
  for update to authenticated
  using (accepted_by is null)
  with check (accepted_by = auth.uid());

-- Once a driver owns an order they may keep updating it — this is what lets
-- their delivery_status / picked_up_at / delivered_at / photo columns flow back
-- to the customer's realtime subscription. Permissive policies are OR'd, so the
-- claim policy above still governs the first (unclaimed) write. The check keeps
-- ownership pinned to this driver so they can't hand the row to someone else.
drop policy if exists "driver can update own claimed order" on public.orders;
create policy "driver can update own claimed order" on public.orders
  for update to authenticated
  using (accepted_by = auth.uid())
  with check (accepted_by = auth.uid());

-- Driver profile rows.
drop policy if exists "driver can insert own profile" on public.drivers;
create policy "driver can insert own profile" on public.drivers
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "authenticated can read drivers" on public.drivers;
create policy "authenticated can read drivers" on public.drivers
  for select to authenticated using (true);

-- Each driver reads/writes only their own order state (insert + update
-- together are what make upsert work).
drop policy if exists "driver reads own order state" on public.driver_orders;
create policy "driver reads own order state" on public.driver_orders
  for select to authenticated using (auth.uid() = driver_id);
drop policy if exists "driver inserts own order state" on public.driver_orders;
create policy "driver inserts own order state" on public.driver_orders
  for insert to authenticated with check (auth.uid() = driver_id);
drop policy if exists "driver updates own order state" on public.driver_orders;
create policy "driver updates own order state" on public.driver_orders
  for update to authenticated using (auth.uid() = driver_id) with check (auth.uid() = driver_id);

-- Each customer reads/writes only their own profile row.
drop policy if exists "customer can insert own profile" on public.customers;
create policy "customer can insert own profile" on public.customers
  for insert to authenticated with check (auth.uid() = id);
drop policy if exists "customer can read own profile" on public.customers;
create policy "customer can read own profile" on public.customers
  for select to authenticated using (auth.uid() = id);

-- Realtime feed for the dashboard (orders only; driver_orders writes are the
-- driver's own and applied optimistically client-side).
do $$ begin
  alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null; end $$;

-- Chat: one thread per order, between whichever two uids are its customer_id
-- and accepted_by. No separate "conversations" table — the order row IS the
-- conversation; a message just points at it. Nothing here hardcodes "the"
-- single driver: a second driver account works with zero changes below.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  sender_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

-- Messages can carry an image (driver's pickup / drop-off proof photos, or
-- either participant attaching a photo in chat). NULL for plain text. The URL
-- points at the public `order-photos` storage bucket.
alter table public.messages add column if not exists image_url text;

-- Messages can also carry a voice note. NULL for plain text / image messages.
-- The URL points at the public `chat-audio` storage bucket; duration is shown
-- next to the play button without needing to load the audio first.
alter table public.messages add column if not exists audio_url text;
alter table public.messages add column if not exists audio_duration_sec numeric;

-- One row per (user, device). A user can have several devices registered;
-- the notify-push edge function (service-role key, bypasses this RLS) fans
-- out to all of them.
create table if not exists public.push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null,
  platform text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

alter table public.messages enable row level security;
alter table public.push_tokens enable row level security;

-- Only the order's two participants may read its thread.
drop policy if exists "participants can read messages" on public.messages;
create policy "participants can read messages" on public.messages
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or o.accepted_by = auth.uid())
    )
  );

-- Sending requires being a participant AND the order having been accepted —
-- chat is unlocked the moment a driver claims the order, not before.
drop policy if exists "participants can send messages" on public.messages;
create policy "participants can send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.orders o
      where o.id = order_id
        and o.accepted_by is not null
        and (o.customer_id = auth.uid() or o.accepted_by = auth.uid())
    )
  );

-- Either participant can mark the thread's messages read (their own inbound
-- unread ones) when they open the chat screen.
drop policy if exists "participants can mark messages read" on public.messages;
create policy "participants can mark messages read" on public.messages
  for update to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or o.accepted_by = auth.uid())
    )
  );

-- Each user manages only their own push tokens. The notify-push function
-- reads across all users via the service-role key, which bypasses RLS
-- entirely, so no cross-user select policy is needed here.
drop policy if exists "user manages own push tokens" on public.push_tokens;
create policy "user manages own push tokens" on public.push_tokens
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Storage: proof-of-delivery photos.
-- A public-read bucket holding the driver's pickup / drop-off photos. Public
-- read keeps the customer's <Image src> simple (no signed URLs); writes are
-- restricted to authenticated drivers. Photos are non-sensitive (a bag at a
-- counter / a doorstep) and the object keys are unguessable order uuids.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('order-photos', 'order-photos', true)
on conflict (id) do update set public = true;

-- Anyone may read (bucket is public); only signed-in users may upload/replace
-- their delivery photos into this bucket.
drop policy if exists "order photos are publicly readable" on storage.objects;
create policy "order photos are publicly readable" on storage.objects
  for select using (bucket_id = 'order-photos');

drop policy if exists "authenticated can upload order photos" on storage.objects;
create policy "authenticated can upload order photos" on storage.objects
  for insert to authenticated with check (bucket_id = 'order-photos');

drop policy if exists "authenticated can update order photos" on storage.objects;
create policy "authenticated can update order photos" on storage.objects
  for update to authenticated using (bucket_id = 'order-photos');

-- Storage: chat voice notes. Same shape as order-photos above — public read
-- (simple <audio src>), authenticated write, unguessable order-uuid-keyed paths.
insert into storage.buckets (id, name, public)
values ('chat-audio', 'chat-audio', true)
on conflict (id) do update set public = true;

drop policy if exists "chat audio is publicly readable" on storage.objects;
create policy "chat audio is publicly readable" on storage.objects
  for select using (bucket_id = 'chat-audio');

drop policy if exists "authenticated can upload chat audio" on storage.objects;
create policy "authenticated can upload chat audio" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-audio');

drop policy if exists "authenticated can update chat audio" on storage.objects;
create policy "authenticated can update chat audio" on storage.objects
  for update to authenticated using (bucket_id = 'chat-audio');


-- Single-driver authorization is applied last to replace legacy policies.
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

drop policy if exists "anon can insert orders" on public.orders;
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


-- Courier availability, timed offers and activity.
-- Apply after 20261111_single_driver.sql. No accounts are created or approved.
begin;
alter table public.orders add column if not exists dropoff_latitude double precision;
alter table public.orders add column if not exists dropoff_longitude double precision;
alter table public.orders add column if not exists delivery_instructions text not null default '';
alter table public.orders add column if not exists delivery_preference text;
alter table public.orders add column if not exists entry_code text not null default '';
alter table public.orders add column if not exists pickup_notes text not null default '';
alter table public.orders add column if not exists driver_pay_cents integer check (driver_pay_cents >= 0);
alter table public.orders alter column driver_pay_cents set default 500;
alter table public.orders add column if not exists driver_tip_cents integer not null default 0 check (driver_tip_cents >= 0);
alter table public.orders drop constraint if exists localgo_flat_driver_pay;
update public.orders set driver_pay_cents = 500 + driver_tip_cents where accepted_by is null and driver_pay_cents is null;
do $$ begin
  if not exists(select 1 from pg_constraint where conname = 'localgo_base_and_tip_pay' and conrelid = 'public.orders'::regclass) then
    alter table public.orders add constraint localgo_base_and_tip_pay check (driver_pay_cents is null or driver_pay_cents = 500 + driver_tip_cents) not valid;
  end if;
end $$;
alter table public.orders validate constraint localgo_base_and_tip_pay;

create table if not exists public.driver_dispatch (
  driver_id uuid primary key references public.approved_drivers(id) on delete cascade,
  is_online boolean not null default false,
  offer_order_id uuid references public.orders(id) on delete set null,
  offer_expires_at timestamptz,
  last_offer_id uuid,
  cooldown_until timestamptz,
  updated_at timestamptz not null default now()
);
create table if not exists public.driver_shifts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.approved_drivers(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create unique index if not exists one_open_driver_shift on public.driver_shifts(driver_id) where ended_at is null;
alter table public.driver_dispatch enable row level security;
alter table public.driver_shifts enable row level security;
revoke all on public.driver_dispatch, public.driver_shifts from anon, authenticated;
grant select on public.driver_dispatch, public.driver_shifts to authenticated;
drop policy if exists "driver reads own dispatch" on public.driver_dispatch;
create policy "driver reads own dispatch" on public.driver_dispatch for select to authenticated using (driver_id = auth.uid());
drop policy if exists "driver reads own shifts" on public.driver_shifts;
create policy "driver reads own shifts" on public.driver_shifts for select to authenticated using (driver_id = auth.uid());

-- Server-owned state and deadlines cannot be changed through direct REST writes.
create or replace function public.driver_set_online(p_online boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); current_online boolean;
begin
  if uid is null or not exists(select 1 from public.approved_drivers where id = uid) then raise exception 'Driver approval required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  insert into public.driver_dispatch(driver_id) values(uid) on conflict do nothing;
  select is_online into current_online from public.driver_dispatch where driver_id = uid;
  if p_online and not current_online then
    insert into public.driver_shifts(driver_id) values(uid);
  elsif not p_online and current_online then
    update public.driver_shifts set ended_at = now() where driver_id = uid and ended_at is null;
  end if;
  update public.driver_dispatch set is_online = p_online, updated_at = now(),
    offer_order_id = case when p_online then offer_order_id else null end,
    offer_expires_at = case when p_online then offer_expires_at else null end where driver_id = uid;
  return jsonb_build_object('online', p_online);
end $$;

create or replace function public.driver_next_offer() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); state public.driver_dispatch; chosen uuid;
begin
  if uid is null or not exists(select 1 from public.approved_drivers where id = uid) then raise exception 'Driver approval required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into state from public.driver_dispatch where driver_id = uid;
  if not found or not state.is_online then return null; end if;
  if exists(select 1 from public.orders where accepted_by = uid and delivery_status in ('accepted','picked_up')) then return null; end if;
  if state.offer_order_id is not null and state.offer_expires_at > now()
     and exists(select 1 from public.orders where id = state.offer_order_id and accepted_by is null) then
    return jsonb_build_object('orderId',state.offer_order_id,'expiresAt',state.offer_expires_at,'serverTime',now());
  end if;
  if state.offer_order_id is not null then
    update public.driver_dispatch set last_offer_id = state.offer_order_id, cooldown_until = now() + interval '60 seconds', offer_order_id = null, offer_expires_at = null where driver_id = uid;
    state.last_offer_id := state.offer_order_id; state.cooldown_until := now() + interval '60 seconds';
  end if;
  select o.id into chosen from public.orders o
    where o.accepted_by is null
      and not exists(select 1 from public.driver_orders d where d.driver_id = uid and d.order_id = o.id and d.status = 'declined')
      and (state.cooldown_until is null or state.cooldown_until <= now() or o.id is distinct from state.last_offer_id)
    order by o.created_at asc limit 1;
  if chosen is null then return null; end if;
  update public.driver_dispatch set offer_order_id = chosen, offer_expires_at = now() + interval '40 seconds', updated_at = now() where driver_id = uid;
  return jsonb_build_object('orderId',chosen,'expiresAt',now() + interval '40 seconds','serverTime',now());
end $$;

create or replace function public.driver_accept_offer(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); state public.driver_dispatch; claimed uuid;
begin
  if uid is null or not exists(select 1 from public.approved_drivers where id = uid) then raise exception 'Driver approval required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into state from public.driver_dispatch where driver_id = uid;
  if not found or not state.is_online or state.offer_order_id is distinct from p_order_id or state.offer_expires_at is null or state.offer_expires_at <= now() then return null; end if;
  if exists(select 1 from public.orders where accepted_by = uid and delivery_status in ('accepted','picked_up')) then return null; end if;
  update public.orders set accepted_by = uid, accepted_at = now(), delivery_status = 'accepted'
    where id = p_order_id and accepted_by is null returning id into claimed;
  if claimed is null then return null; end if;
  insert into public.driver_orders(driver_id, order_id, status, updated_at) values(uid, claimed, 'accepted', now())
    on conflict(driver_id, order_id) do update set status = 'accepted', updated_at = now();
  update public.driver_dispatch set offer_order_id = null, offer_expires_at = null, updated_at = now() where driver_id = uid;
  return jsonb_build_object('ok',true,'acceptedAt',now());
end $$;

create or replace function public.driver_decline_offer(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare uid uuid := auth.uid(); state public.driver_dispatch;
begin
  if uid is null or not exists(select 1 from public.approved_drivers where id = uid) then raise exception 'Driver approval required' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 0));
  select * into state from public.driver_dispatch where driver_id = uid;
  if not found or state.offer_order_id is distinct from p_order_id then return null; end if;
  if not exists(select 1 from public.orders where id = p_order_id and accepted_by is null) then return null; end if;
  insert into public.driver_orders(driver_id, order_id, status, updated_at) values(uid, p_order_id, 'declined', now())
    on conflict(driver_id, order_id) do update set status = 'declined', updated_at = now();
  update public.driver_dispatch set offer_order_id = null, offer_expires_at = null, updated_at = now() where driver_id = uid;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.driver_set_online(boolean), public.driver_next_offer(), public.driver_accept_offer(uuid), public.driver_decline_offer(uuid) from public, anon;
grant execute on function public.driver_set_online(boolean), public.driver_next_offer(), public.driver_accept_offer(uuid), public.driver_decline_offer(uuid) to authenticated;
-- Claiming must go through the expiring-offer transaction, not a raw PATCH.
revoke update on public.orders from authenticated;
grant update(delivery_status, picked_up_at, delivered_at, pickup_photo_url, dropoff_photo_url) on public.orders to authenticated;
commit;
