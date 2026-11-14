-- Apply after the existing driver schema and security/workflow migrations.
-- Additive: legacy delivery dispatch remains intact. New privileged mutations
-- are reachable only through the authenticated FastAPI service.
begin;
create table if not exists public.consumer_merchants (
 id text primary key check(id ~ '^[a-z0-9-]+$'), name text not null, cuisine text not null,
 address text not null, category text not null default 'restaurants' check(category in ('restaurants','grocery','convenience','specialty','pharmacy')),
 logo_url text, hero_image_url text, latitude double precision, longitude double precision,
 active boolean not null default true, pickup_enabled boolean not null default false,
 verified boolean not null default false, top_local boolean not null default false,
 delivery_fee_cents integer not null default 500 check(delivery_fee_cents between 0 and 200000),
 eta_min integer not null default 20 check(eta_min > 0), eta_max integer not null default 30,
 check(eta_max >= eta_min), check((latitude is null)=(longitude is null)),
 check(latitude between -90 and 90), check(longitude between -180 and 180)
);
create table if not exists public.consumer_merchant_staff (
 user_id uuid not null references auth.users(id) on delete cascade,
 merchant_id text not null references public.consumer_merchants(id) on delete cascade,
 primary key(user_id,merchant_id)
);
create table if not exists public.consumer_promotions (
 code text primary key check(code ~ '^[A-Z0-9_-]{1,40}$'),
 active boolean not null default false, kind text not null check(kind in ('fixed','percent')),
 amount integer not null check(amount > 0), minimum_cents integer not null default 0 check(minimum_cents >= 0),
 max_discount_cents integer check(max_discount_cents >= 0),
 merchant_id text references public.consumer_merchants(id), mode text check(mode in ('delivery','pickup')),
 starts_at timestamptz, expires_at timestamptz, usage_limit integer check(usage_limit > 0),
 per_customer_limit integer not null default 1 check(per_customer_limit > 0),
 check(kind <> 'percent' or amount <= 100), check(expires_at is null or starts_at is null or expires_at > starts_at)
);
create table if not exists public.consumer_receipts (
 id uuid primary key, customer_id uuid not null references auth.users(id) on delete cascade,
 merchant_id text not null references public.consumer_merchants(id),
 order_number text not null unique, mode text not null check(mode in ('delivery','pickup')),
 status text not null default 'placed' check(status in ('placed','preparing','ready','completed')),
 customer_name text not null, address jsonb, quote jsonb not null,
 items text[] not null, line_items jsonb not null,
 reviewed boolean not null default false, created_at timestamptz not null default now(),
 check(mode <> 'delivery' or address is not null)
);
create index if not exists consumer_receipts_customer_created on public.consumer_receipts(customer_id,created_at desc);
create table if not exists public.consumer_promo_redemptions (
 order_id uuid primary key references public.consumer_receipts(id) on delete cascade,
 code text not null references public.consumer_promotions(code),
 customer_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create index if not exists consumer_promo_customer on public.consumer_promo_redemptions(code,customer_id);
create table if not exists public.consumer_reviews (
 order_id uuid primary key references public.consumer_receipts(id) on delete cascade,
 merchant_id text not null references public.consumer_merchants(id),
 customer_id uuid not null references auth.users(id) on delete cascade,
 rating integer not null check(rating between 1 and 5), created_at timestamptz not null default now()
);
create table if not exists public.consumer_courier_locations (
 order_id uuid primary key references public.orders(id) on delete cascade,
 driver_id uuid not null references auth.users(id) on delete cascade,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 updated_at timestamptz not null
);

alter table public.consumer_merchants enable row level security;
alter table public.consumer_merchant_staff enable row level security;
alter table public.consumer_promotions enable row level security;
alter table public.consumer_receipts enable row level security;
alter table public.consumer_promo_redemptions enable row level security;
alter table public.consumer_reviews enable row level security;
alter table public.consumer_courier_locations enable row level security;
drop policy if exists consumer_public_merchants on public.consumer_merchants;
create policy consumer_public_merchants on public.consumer_merchants for select to anon,authenticated using(active);
drop policy if exists consumer_own_receipts on public.consumer_receipts;
create policy consumer_own_receipts on public.consumer_receipts for select to authenticated using(customer_id=auth.uid());
-- Reviews expose aggregate ratings only; individual reviews remain private.
revoke all on public.consumer_merchants,public.consumer_merchant_staff,public.consumer_promotions,public.consumer_receipts,public.consumer_promo_redemptions,public.consumer_reviews,public.consumer_courier_locations from anon,authenticated;
grant select on public.consumer_merchants to anon,authenticated;
grant select on public.consumer_receipts to authenticated;
grant all on public.consumer_merchants,public.consumer_merchant_staff,public.consumer_promotions,public.consumer_receipts,public.consumer_promo_redemptions,public.consumer_reviews,public.consumer_courier_locations to service_role;

-- Owner-rights view deliberately projects only public store data + aggregates.
create or replace view public.consumer_merchant_catalog as
 select m.*, round(avg(r.rating),1) as rating, count(r.rating)::int as review_count
 from public.consumer_merchants m left join public.consumer_reviews r on r.merchant_id=m.id
 where m.active group by m.id;
grant select on public.consumer_merchant_catalog to anon,authenticated,service_role;

insert into public.consumer_merchants(id,name,cuisine,address,logo_url,hero_image_url,eta_min,eta_max) values
 ('al-taib','Al Taib','Boulangerie & Grills','2125 Rue Guy, Montreal, QC','https://betterresto.s3.us-west-1.wasabisys.com/production/13143/Al_taib_logo_ea0ac3f5c9.jpeg','https://betterresto.s3.us-west-1.wasabisys.com/production/13125/all_dressed_pizza_bb4e2f9ccd.png',20,30),
 ('chateau-kabab','Château Kabab','Persian & Iraqi Grill','2140 Rue Guy, Montreal, QC','https://betterresto.s3.us-west-1.wasabisys.com/production/13126/812053f8_8814_46c4_ba75_bf4fb65be016_afde25f69c.jpeg','https://betterresto.s3.us-west-1.wasabisys.com/production/13126/18_151_Chateau_Kabab_226_79bd645e70.jpg',30,40)
 on conflict(id) do nothing;
create or replace view public.consumer_promotion_availability as
 select p.*,count(r.order_id)::int as redeemed_count from public.consumer_promotions p left join public.consumer_promo_redemptions r on r.code=p.code group by p.code;
create or replace view public.consumer_promo_customer_usage as
 select code,customer_id,count(*)::int as uses from public.consumer_promo_redemptions group by code,customer_id;
revoke all on public.consumer_promotion_availability,public.consumer_promo_customer_usage from public,anon,authenticated;
grant select on public.consumer_promotion_availability,public.consumer_promo_customer_usage to service_role;
-- No invented reviews, promotions, pickup approval or verification badges.

create or replace function public.consumer_checkout(p_order jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 rid uuid := (p_order->>'id')::uuid;
 uid uuid := (p_order->>'customer_id')::uuid;
 merchant public.consumer_merchants; promo public.consumer_promotions;
 receipt public.consumer_receipts; q jsonb := p_order->'quote'; a jsonb := p_order->'address';
 v_code text := q->>'promoCode'; mode text := p_order->>'mode';
 subtotal integer := (q->>'subtotalCents')::int; fee integer; tip integer := (q->>'tipCents')::int;
 discount integer := 0; count_all bigint; count_user bigint;
begin
 perform pg_advisory_xact_lock(hashtextextended(rid::text,0));
 select * into receipt from consumer_receipts where id=rid;
 if found then
   if receipt.customer_id <> uid then raise exception 'Order conflict'; end if;
   return to_jsonb(receipt);
 end if;
 select * into merchant from consumer_merchants where id=p_order->>'merchant_id' and active for share;
 if not found then raise exception 'Store unavailable'; end if;
 if mode not in ('delivery','pickup') or subtotal < 0 or subtotal > 200000 or tip < 0 or tip > 200000 then raise exception 'Invalid order'; end if;
 if mode='pickup' and not merchant.pickup_enabled then raise exception 'Pickup unavailable'; end if;
 if mode='pickup' and tip<>0 then raise exception 'Invalid pickup tip'; end if;
 fee := case when mode='pickup' then 0 else merchant.delivery_fee_cents end;
 if v_code is not null then
  select * into promo from consumer_promotions where consumer_promotions.code=v_code for update;
  if not found then raise exception 'Promotion unavailable'; end if;
  if not promo.active or (promo.starts_at is not null and now()<promo.starts_at) or (promo.expires_at is not null and now()>=promo.expires_at) or subtotal<promo.minimum_cents or (promo.merchant_id is not null and promo.merchant_id<>merchant.id) or (promo.mode is not null and promo.mode<>mode) then raise exception 'Promotion unavailable'; end if;
  select count(*),count(*) filter(where customer_id=uid) into count_all,count_user from consumer_promo_redemptions where consumer_promo_redemptions.code=promo.code;
  if (promo.usage_limit is not null and count_all>=promo.usage_limit) or count_user>=promo.per_customer_limit then raise exception 'Promotion exhausted'; end if;
  discount := case when promo.kind='fixed' then promo.amount else (subtotal::bigint*promo.amount/100)::int end;
  if promo.max_discount_cents is not null then discount:=least(discount,promo.max_discount_cents); end if;
  discount:=least(discount,subtotal);
 end if;
 if (q->>'deliveryFeeCents')::int <> fee or (q->>'discountCents')::int <> discount or (q->>'totalCents')::int <> subtotal+fee+tip-discount then raise exception 'Total changed'; end if;
 insert into consumer_receipts(id,customer_id,merchant_id,order_number,mode,customer_name,address,quote,items,line_items)
 values(rid,uid,merchant.id,'#LG-'||upper(substr(replace(rid::text,'-',''),1,10)),mode,p_order->>'customer_name',case when mode='delivery' then a else null end,q,array(select jsonb_array_elements_text(p_order->'items')),p_order->'line_items') returning * into receipt;
 if v_code is not null then insert into consumer_promo_redemptions(order_id,code,customer_id) values(rid,v_code,uid); end if;
 if mode='delivery' then
  insert into orders(id,order_number,restaurant_name,restaurant_address,customer_name,customer_id,dropoff_address,item_count,order_total,distance_km,dropoff_latitude,dropoff_longitude,delivery_instructions,delivery_preference,entry_code,driver_pay_cents,driver_tip_cents,status,delivery_status,items)
  values(rid,receipt.order_number,merchant.name,merchant.address,receipt.customer_name,uid,concat_ws(', ',a->>'addressLine',nullif(a->>'apartmentSuite','')), (select sum((x->>'quantity')::int) from jsonb_array_elements(p_order->'line_items') x), (q->>'totalCents')::numeric/100,0,(a->>'latitude')::double precision,(a->>'longitude')::double precision,coalesce(a->>'instructions',''),a->>'preference',coalesce(a->>'entryCode',''),500+tip,tip,'available','available',receipt.items);
 end if;
 return to_jsonb(receipt);
end $$;
revoke all on function public.consumer_checkout(jsonb) from public,anon,authenticated;
grant execute on function public.consumer_checkout(jsonb) to service_role;

create or replace function public.consumer_share_location(p_order_id uuid,p_driver_id uuid,p_latitude double precision,p_longitude double precision,p_recorded_at timestamptz) returns boolean
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 -- Lock order ownership/status against a simultaneous completion/reassignment.
 perform 1 from orders where id=p_order_id and accepted_by=p_driver_id and delivery_status in ('accepted','picked_up') for share;
 if not found or p_recorded_at < now()-interval '2 minutes' or p_recorded_at > now()+interval '15 seconds' then return false; end if;
 insert into consumer_courier_locations(order_id,driver_id,latitude,longitude,updated_at)
 values(p_order_id,p_driver_id,p_latitude,p_longitude,p_recorded_at)
 on conflict(order_id) do update set driver_id=excluded.driver_id,latitude=excluded.latitude,longitude=excluded.longitude,updated_at=excluded.updated_at
 where consumer_courier_locations.updated_at < excluded.updated_at;
 return found;
end $$;
revoke all on function public.consumer_share_location(uuid,uuid,double precision,double precision,timestamptz) from public,anon,authenticated;
grant execute on function public.consumer_share_location(uuid,uuid,double precision,double precision,timestamptz) to service_role;

create or replace function public.consumer_review_received() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin update consumer_receipts set reviewed=true where id=new.order_id; return new; end $$;
drop trigger if exists consumer_review_received on public.consumer_reviews;
create trigger consumer_review_received after insert on public.consumer_reviews for each row execute function public.consumer_review_received();
commit;
