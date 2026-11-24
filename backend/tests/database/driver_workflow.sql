insert into auth.users(id,email) values
 ('22222222-2222-4222-8222-222222222222','driver@example.test'),
 ('33333333-3333-4333-8333-333333333333','customer@example.test'),
 ('44444444-4444-4444-8444-444444444444','other@example.test');
insert into public.approved_drivers(id) values('22222222-2222-4222-8222-222222222222');
do $$ begin
  begin
    insert into public.approved_drivers(id) values('44444444-4444-4444-8444-444444444444');
    raise exception 'a second driver was approved';
  exception when unique_violation then null; end;
end $$;
insert into public.orders(id, order_number, restaurant_name, restaurant_address, customer_name, customer_id, dropoff_address, item_count, order_total, distance_km, status, items)
values ('11111111-1111-4111-8111-111111111111','#LG-1','Al Taib','2125 Guy St','Test Customer','33333333-3333-4333-8333-333333333333','Montreal',1,20,0,'available',array['1× Shawarma']);
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if exists(select 1 from public.orders) then raise exception 'Unapproved account read deliveries'; end if;
  begin perform public.driver_set_online(true); raise exception 'Unapproved account went online'; exception when insufficient_privilege then null; end;
  begin insert into public.approved_drivers(id) values(auth.uid()); raise exception 'Client self-approved'; exception when insufficient_privilege then null; end;
end $$;
set request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
do $$ declare offer jsonb; again jsonb; begin
  if public.driver_next_offer() is not null then raise exception 'Offline driver received offer'; end if;
  if public.driver_accept_offer('11111111-1111-4111-8111-111111111111') is not null then raise exception 'Offline driver accepted'; end if;
  perform public.driver_set_online(true);
  offer := public.driver_next_offer(); again := public.driver_next_offer();
  if offer->>'orderId' != '11111111-1111-4111-8111-111111111111' then raise exception 'Missing offer'; end if;
  if offer->>'expiresAt' != again->>'expiresAt' then raise exception 'Refetch extended deadline'; end if;
  begin update public.driver_dispatch set offer_expires_at = now() + interval '1 day'; raise exception 'Client extended deadline'; exception when insufficient_privilege then null; end;
  begin update public.orders set accepted_by = auth.uid(); raise exception 'Raw claim bypassed deadline'; exception when insufficient_privilege then null; end;
end $$;
reset role;
update public.driver_dispatch set offer_expires_at = now() - interval '1 second';
set role authenticated;
do $$ begin
  if public.driver_accept_offer('11111111-1111-4111-8111-111111111111') is not null then raise exception 'Expired offer accepted'; end if;
end $$;
reset role;
update public.driver_dispatch set offer_expires_at = now() + interval '40 seconds';
set role authenticated;
do $$ begin
  if public.driver_accept_offer('11111111-1111-4111-8111-111111111111') is null then raise exception 'Valid offer rejected'; end if;
  if public.driver_next_offer() is not null then raise exception 'New offer during active delivery'; end if;
  perform public.driver_set_online(false);
  if not exists(select 1 from public.orders where accepted_by = auth.uid() and delivery_status = 'accepted') then raise exception 'Offline lost active delivery'; end if;
  if not exists(select 1 from public.driver_orders where driver_id = auth.uid() and status = 'accepted') then raise exception 'Claim overlay missing'; end if;
end $$;
reset role;
select 'Database workflow and authorization checks passed' as result;
