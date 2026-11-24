begin;
-- Activate only after the backend uses verified service-owned dispatch writes.
drop policy if exists "anon can insert orders" on public.orders;
revoke insert on public.orders from anon,authenticated;
create or replace function public.driver_update_status(p_order_id uuid,p_status text,p_photo_url text default null,p_verified_items integer[] default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 uid uuid:=auth.uid(); task public.orders; stamp timestamptz:=now(); path text; stage text; expected integer[]; supplied integer[];
 prefix constant text:='https://sxednzdbbfjxdvezmouf.supabase.co/storage/v1/object/public/order-photos/';
begin
 if uid is null or not exists(select 1 from public.approved_drivers where id=uid) then raise exception 'Driver approval required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(uid::text,0));
 select * into task from public.orders where id=p_order_id for update;
 if not found or task.accepted_by is distinct from uid then raise exception 'Assigned driver required' using errcode='42501'; end if;
 if p_status is null or p_status not in ('accepted','picked_up','nearby','arrived','delivered') then raise exception 'Unsupported status' using errcode='22023'; end if;
 if task.delivery_status=p_status then
  stamp:=case p_status when 'accepted' then task.accepted_at when 'picked_up' then task.picked_up_at when 'nearby' then task.nearby_at when 'arrived' then task.arrived_at else task.delivered_at end;
  if stamp is null then raise exception 'Missing historical status timestamp' using errcode='22023'; end if;
  insert into public.driver_orders(driver_id,order_id,status,updated_at) values(uid,p_order_id,p_status,stamp)
   on conflict(driver_id,order_id) do update set status=excluded.status,updated_at=excluded.updated_at;
  return jsonb_build_object('ok',true,'changed',false,'updatedAt',stamp);
 end if;
 if not ((task.delivery_status='accepted' and p_status='picked_up')
  or (task.delivery_status='picked_up' and p_status in ('nearby','arrived','delivered'))
  or (task.delivery_status='nearby' and p_status in ('arrived','delivered'))
  or (task.delivery_status='arrived' and p_status='delivered')) then raise exception 'Invalid delivery transition' using errcode='22023'; end if;
 if p_status='picked_up' then
  select array_agg(i order by i) into expected from generate_series(0,cardinality(task.items)-1) i;
  select array_agg(i order by i) into supplied from unnest(p_verified_items) i;
  if expected is null or supplied is distinct from expected then raise exception 'Verify every pickup item' using errcode='22023'; end if;
 end if;
 if p_status='delivered' and p_photo_url is null then raise exception 'Uploaded drop-off photo required' using errcode='22023'; end if;
 if p_photo_url is not null and p_status in ('picked_up','delivered') then
  stage:=case p_status when 'picked_up' then 'pickup' else 'dropoff' end;
  if left(p_photo_url,length(prefix))<>prefix then raise exception 'Invalid proof-photo origin' using errcode='22023'; end if;
  path:=substring(p_photo_url from length(prefix)+1);
  if path !~ ('^'||p_order_id::text||'/'||stage||'-[A-Za-z0-9_.-]+$') or not exists(
   select 1 from storage.objects where bucket_id='order-photos' and name=path and owner_id=uid::text and metadata->>'mimetype' like 'image/%'
  ) then raise exception 'Uploaded order-owned proof photo required' using errcode='22023'; end if;
 end if;
 update public.orders set delivery_status=p_status,
  picked_up_at=case when p_status='picked_up' then stamp else picked_up_at end,
  nearby_at=case when p_status='nearby' then stamp else nearby_at end,
  arrived_at=case when p_status='arrived' then stamp else arrived_at end,
  delivered_at=case when p_status='delivered' then stamp else delivered_at end,
  pickup_photo_url=case when p_status='picked_up' then coalesce(p_photo_url,pickup_photo_url) else pickup_photo_url end,
  dropoff_photo_url=case when p_status='delivered' then p_photo_url else dropoff_photo_url end where id=p_order_id;
 insert into public.driver_orders(driver_id,order_id,status,updated_at) values(uid,p_order_id,p_status,stamp)
  on conflict(driver_id,order_id) do update set status=excluded.status,updated_at=excluded.updated_at;
 return jsonb_build_object('ok',true,'changed',true,'updatedAt',stamp);
end $$;
revoke all on function public.driver_update_status(uuid,text,text,integer[]) from public,anon;
grant execute on function public.driver_update_status(uuid,text,text,integer[]) to authenticated;
revoke update(delivery_status,picked_up_at,delivered_at,pickup_photo_url,dropoff_photo_url,nearby_at,arrived_at) on public.orders from authenticated;
revoke insert,update,delete on public.driver_orders from authenticated;
commit;
