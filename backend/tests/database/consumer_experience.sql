-- Run only against a disposable database bootstrapped with the driver schema.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('33333333-3333-4333-8333-333333333333','consumer-ux@example.test'),
 ('44444444-4444-4444-8444-444444444444','other-ux@example.test'),
 ('22222222-2222-4222-8222-222222222222','courier-ux@example.test') on conflict do nothing;
update public.consumer_merchants set pickup_enabled=true where id='al-taib';
insert into public.consumer_promotions(code,active,kind,amount,minimum_cents,usage_limit) values('TEST20',true,'percent',20,1000,1);
create temporary table checkout_fixture(body jsonb);
insert into checkout_fixture values ('{"id":"11111111-1111-4111-8111-111111111111","customer_id":"33333333-3333-4333-8333-333333333333","merchant_id":"al-taib","customer_name":"Sample Customer","mode":"delivery","address":{"addressLine":"1510 De Maisonneuve Ouest","latitude":45.496339,"longitude":-73.578666,"instructions":"Ring bell","preference":"Leave at door","entryCode":"123"},"quote":{"subtotalCents":1250,"deliveryFeeCents":500,"tipCents":225,"discountCents":250,"totalCents":1725,"promoCode":"TEST20","currency":"CAD"},"items":["1× Create your bowl (500 g)"],"line_items":[{"productId":"create-your-bowl-500-g","quantity":1}]}'::jsonb);
select public.consumer_checkout(body) is not null as delivery_created from checkout_fixture;
do $$ begin
 if (select count(*) from public.orders where id='11111111-1111-4111-8111-111111111111')<>1 then raise exception 'Missing dispatch'; end if;
 if (select driver_pay_cents from public.orders where id='11111111-1111-4111-8111-111111111111')<>725 then raise exception 'Tip changed'; end if;
 if (select count(*) from public.consumer_promo_redemptions where code='TEST20')<>1 then raise exception 'Redemption missing'; end if;
end $$;
select public.consumer_checkout(body) is not null as retry_idempotent from checkout_fixture;
do $$ begin
 begin
  perform public.consumer_checkout(jsonb_set((select body from checkout_fixture),'{id}','"55555555-5555-4555-8555-555555555555"'));
  raise exception 'Expected promotion exhaustion' using errcode='P9999';
 exception when raise_exception then
  if sqlerrm not like '%Promotion exhausted%' then raise; end if;
 end;
 if (select count(*) from public.consumer_receipts)<>1 then raise exception 'Partial checkout escaped rollback'; end if;
end $$;
select public.consumer_checkout((body-'address') || '{"id":"66666666-6666-4666-8666-666666666666","mode":"pickup","quote":{"subtotalCents":1250,"deliveryFeeCents":0,"tipCents":0,"discountCents":0,"totalCents":1250,"promoCode":null,"currency":"CAD"}}'::jsonb) is not null as pickup_created from checkout_fixture;
do $$ begin
 if exists(select 1 from public.orders where id='66666666-6666-4666-8666-666666666666') then raise exception 'Pickup entered driver feed'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
do $$ begin
 if (select count(*) from public.consumer_receipts)<>0 then raise exception 'Cross-customer receipt leak'; end if;
 begin perform public.consumer_checkout('{}'); raise exception 'Public privileged RPC access' using errcode='P9999'; exception when insufficient_privilege then null; end;
 begin insert into public.consumer_reviews(order_id,merchant_id,customer_id,rating) values('11111111-1111-4111-8111-111111111111','al-taib',auth.uid(),5); raise exception 'Direct review insert allowed' using errcode='P9999'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.orders set accepted_by='22222222-2222-4222-8222-222222222222',delivery_status='accepted' where id='11111111-1111-4111-8111-111111111111';
do $$ begin
 if public.consumer_share_location('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444',45.49,-73.57,now()) then raise exception 'Wrong driver shared location'; end if;
 if not public.consumer_share_location('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',45.49,-73.57,now()) then raise exception 'Assigned driver rejected'; end if;
 if public.consumer_share_location('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',45.48,-73.58,now()-interval '10 seconds') then raise exception 'Out-of-order position accepted'; end if;
end $$;
update public.orders set delivery_status='delivered' where id='11111111-1111-4111-8111-111111111111';
do $$ begin
 if public.consumer_share_location('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',45.49,-73.57,now()) then raise exception 'Completed order still shares position'; end if;
end $$;
insert into public.consumer_reviews(order_id,merchant_id,customer_id,rating) values('11111111-1111-4111-8111-111111111111','al-taib','33333333-3333-4333-8333-333333333333',5);
do $$ begin
 if (select rating from public.consumer_merchant_catalog where id='al-taib')<>5 then raise exception 'Rating aggregate wrong'; end if;
 if (select reviewed from public.consumer_receipts where id='11111111-1111-4111-8111-111111111111')<>true then raise exception 'Review acknowledgement missing'; end if;
end $$;
select 'PASS: atomic checkout, idempotency, promo exhaustion, pickup isolation, RLS, RPC grants, courier ownership, stale positions and review aggregation' as result;
rollback;
