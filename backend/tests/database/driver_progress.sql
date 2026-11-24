-- Disposable PostgreSQL fixture only; run after test/database/workflow.sql.
alter table storage.objects add column if not exists name text;
alter table storage.objects add column if not exists owner_id text;
alter table storage.objects add column if not exists metadata jsonb;
insert into storage.objects(bucket_id,name,owner_id,metadata) values('order-photos','11111111-1111-4111-8111-111111111111/dropoff-fixture.jpg','22222222-2222-4222-8222-222222222222','{"mimetype":"image/jpeg"}');
set role authenticated;
set request.jwt.claim.sub='44444444-4444-4444-8444-444444444444';
do $$ begin
 begin perform public.driver_update_status('11111111-1111-4111-8111-111111111111','picked_up',null,array[0]); raise exception 'unapproved update allowed'; exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin
 begin update public.orders set delivery_status='delivered'; raise exception 'raw status bypass allowed'; exception when insufficient_privilege then null; end;
 begin perform public.driver_update_status('11111111-1111-4111-8111-111111111111','delivered',null,null); raise exception 'pickup bypass allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.driver_update_status('11111111-1111-4111-8111-111111111111','picked_up',null,array[]::integer[]); raise exception 'incomplete checklist allowed'; exception when invalid_parameter_value then null; end;
 perform public.driver_update_status('11111111-1111-4111-8111-111111111111','picked_up',null,array[0]);
 begin perform public.driver_update_status('11111111-1111-4111-8111-111111111111','delivered','https://other.test/dropoff-fixture.jpg',null); raise exception 'external proof allowed'; exception when invalid_parameter_value then null; end;
 begin perform public.driver_update_status('11111111-1111-4111-8111-111111111111','delivered','https://sxednzdbbfjxdvezmouf.supabase.co/storage/v1/object/public/order-photos/11111111-1111-4111-8111-111111111111/dropoff-missing.jpg',null); raise exception 'nonexistent proof allowed'; exception when invalid_parameter_value then null; end;
end $$;
reset role;
create function public.reject_overlay_fixture() returns trigger language plpgsql as $$ begin if new.status='delivered' then raise exception 'simulated overlay failure'; end if; return new; end $$;
create trigger reject_overlay_fixture before insert or update on public.driver_orders for each row execute function public.reject_overlay_fixture();
set role authenticated;
do $$ begin
 begin
  perform public.driver_update_status('11111111-1111-4111-8111-111111111111','delivered','https://sxednzdbbfjxdvezmouf.supabase.co/storage/v1/object/public/order-photos/11111111-1111-4111-8111-111111111111/dropoff-fixture.jpg',null);
  raise exception 'expected overlay failure';
 exception when raise_exception then
  if sqlerrm <> 'simulated overlay failure' then raise; end if;
 end;
 if exists(select 1 from public.orders where delivery_status='delivered') then raise exception 'partial completion escaped transaction'; end if;
end $$;
reset role;
drop trigger reject_overlay_fixture on public.driver_orders;
drop function public.reject_overlay_fixture();
set role authenticated;
do $$ declare first_result jsonb; retry_result jsonb; begin
 first_result:=public.driver_update_status('11111111-1111-4111-8111-111111111111','delivered','https://sxednzdbbfjxdvezmouf.supabase.co/storage/v1/object/public/order-photos/11111111-1111-4111-8111-111111111111/dropoff-fixture.jpg',null);
 retry_result:=public.driver_update_status('11111111-1111-4111-8111-111111111111','delivered',null,null);
 if (retry_result->>'changed')::boolean or first_result->>'updatedAt' <> retry_result->>'updatedAt' then raise exception 'retry changed completion timestamp'; end if;
 if not exists(select 1 from public.driver_orders where status='delivered' and updated_at=(first_result->>'updatedAt')::timestamptz) then raise exception 'overlay not atomically completed'; end if;
end $$;
reset role;
select 'Atomic progress, ownership, proof validation, rollback and retry checks passed' as result;
