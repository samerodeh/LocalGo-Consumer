-- Disposable localhost accounts and metadata only. Never apply to a hosted DB.
insert into auth.users(id,email) values
('33333333-3333-4333-8333-333333333333','customer@example.test'),
('44444444-4444-4444-8444-444444444444','other@example.test'),
('22222222-2222-4222-8222-222222222222','driver@example.test') on conflict do nothing;
insert into approved_drivers(id) values('22222222-2222-4222-8222-222222222222') on conflict do nothing;
insert into consumer_merchant_staff(user_id,merchant_id) values('44444444-4444-4444-8444-444444444444','al-taib') on conflict do nothing;
update consumer_merchants set pickup_enabled=true where id='al-taib';
insert into consumer_promotions(code,active,kind,amount,minimum_cents,usage_limit,per_customer_limit) values('LOCAL20',true,'percent',20,1000,50,10) on conflict do nothing;
