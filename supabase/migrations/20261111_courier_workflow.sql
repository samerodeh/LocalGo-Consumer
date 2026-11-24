-- Apply after 20261111_single_driver.sql. No accounts are created or approved.
begin;
alter table public.orders add column if not exists nearby_at timestamptz;
alter table public.orders add column if not exists arrived_at timestamptz;
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
-- Historical orders keep unknown pay until their actual tip can be reconciled.
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
  if exists(select 1 from public.orders where accepted_by = uid and delivery_status in ('accepted','picked_up','nearby','arrived')) then return null; end if;
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
  if exists(select 1 from public.orders where accepted_by = uid and delivery_status in ('accepted','picked_up','nearby','arrived')) then return null; end if;
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
grant update(delivery_status, picked_up_at, delivered_at, pickup_photo_url, dropoff_photo_url, nearby_at, arrived_at) on public.orders to authenticated;
commit;
