-- Apply after 202611040001. No startup auto-migration. Backend-only checkout RPCs.
begin;
alter table public.customer_carts add column checkout_id uuid;
create table public.customer_cart_checkouts (
    order_id uuid primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    cart_revision bigint not null,
    cart jsonb not null,
    tip_cents integer not null check (tip_cents between 0 and 20000),
    quote jsonb,
    payment_intent_id text,
    status text not null default 'pending' check (status in ('pending','released','consumed')),
    created_at timestamptz not null default now()
);
alter table public.customer_cart_checkouts enable row level security;
revoke all on public.customer_cart_checkouts from public, anon, authenticated;
grant all on public.customer_cart_checkouts to service_role;

create function public.lock_customer_checkout(p_user_id uuid, p_order_id uuid,
    p_revision bigint, p_tip_cents integer) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
    v_quote public.customer_cart_checkouts%rowtype;
    v_cart public.customer_carts%rowtype;
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
    select * into v_quote from public.customer_cart_checkouts where order_id=p_order_id;
    if found then
        if v_quote.user_id<>p_user_id or v_quote.cart_revision<>p_revision or v_quote.tip_cents<>p_tip_cents then
            return jsonb_build_object('status','CHECKOUT_CONFLICT');
        end if;
        if v_quote.status='released' then return jsonb_build_object('status','CHECKOUT_CLOSED'); end if;
        return jsonb_build_object('status','ok','checkout',to_jsonb(v_quote));
    end if;
    select * into v_cart from public.customer_carts where user_id=p_user_id for update;
    if not found or v_cart.revision<>p_revision then
        return jsonb_build_object('status','CART_REVISION_CONFLICT');
    end if;
    if v_cart.checkout_id is not null then return jsonb_build_object('status','CART_CHECKOUT_LOCKED'); end if;
    if jsonb_array_length(v_cart.data->'lines')=0 then return jsonb_build_object('status','CART_EMPTY'); end if;
    insert into public.customer_cart_checkouts(order_id,user_id,cart_revision,cart,tip_cents)
      values(p_order_id,p_user_id,p_revision,v_cart.data,p_tip_cents) returning * into v_quote;
    update public.customer_carts set checkout_id=p_order_id where user_id=p_user_id;
    return jsonb_build_object('status','ok','checkout',to_jsonb(v_quote));
end;
$$;

create function public.update_customer_checkout(p_user_id uuid,p_order_id uuid,p_action text,
    p_quote jsonb default null,p_payment_id text default null) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
    v_quote public.customer_cart_checkouts%rowtype;
    v_cart public.customer_carts%rowtype;
    v_empty jsonb;
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
    select * into v_quote from public.customer_cart_checkouts where order_id=p_order_id and user_id=p_user_id for update;
    if not found then return jsonb_build_object('status','CHECKOUT_NOT_FOUND'); end if;
    if v_quote.status='consumed' and p_action='consume' and p_payment_id=v_quote.payment_intent_id then
        return jsonb_build_object('status','ok','checkout',to_jsonb(v_quote));
    end if;
    if v_quote.status='released' and p_action='release' and p_payment_id is not distinct from v_quote.payment_intent_id then
        return jsonb_build_object('status','ok','checkout',to_jsonb(v_quote));
    end if;
    if v_quote.status<>'pending' then return jsonb_build_object('status','CHECKOUT_CLOSED'); end if;
    if p_action='prepare' then
        if v_quote.quote is null then
            update public.customer_cart_checkouts set quote=p_quote where order_id=p_order_id returning * into v_quote;
        end if;
    elsif p_action='attach' then
        if p_payment_id is null or (v_quote.payment_intent_id is not null and v_quote.payment_intent_id<>p_payment_id) then
            return jsonb_build_object('status','CHECKOUT_CONFLICT');
        end if;
        update public.customer_cart_checkouts set payment_intent_id=p_payment_id where order_id=p_order_id returning * into v_quote;
    elsif p_action in ('release','consume') then
        if p_payment_id is distinct from v_quote.payment_intent_id then
            return jsonb_build_object('status','CHECKOUT_CONFLICT');
        end if;
        select * into v_cart from public.customer_carts where user_id=p_user_id for update;
        if v_cart.checkout_id is distinct from p_order_id or v_cart.revision<>v_quote.cart_revision then
            return jsonb_build_object('status','CHECKOUT_CONFLICT');
        end if;
        if p_action='consume' then
            if p_payment_id is null then return jsonb_build_object('status','CHECKOUT_CONFLICT'); end if;
            v_empty=jsonb_build_object('revision',v_cart.revision+1,'merchant_id',null,'currency','CAD',
                'lines','[]'::jsonb,'subtotal_cents',0,'delivery_fee_cents',0,'total_cents',0);
            update public.customer_carts set checkout_id=null,revision=revision+1,data=v_empty,updated_at=now() where user_id=p_user_id;
        else
            update public.customer_carts set checkout_id=null where user_id=p_user_id;
        end if;
        update public.customer_cart_checkouts set status=case when p_action='consume' then 'consumed' else 'released' end
          where order_id=p_order_id returning * into v_quote;
    else raise exception 'Invalid checkout action';
    end if;
    return jsonb_build_object('status','ok','checkout',to_jsonb(v_quote));
end;
$$;

-- Same commit contract, now sharing the checkout lock. Receipt replay remains
-- before the lock check so a previously successful request still replays safely.
create or replace function public.commit_customer_cart(p_user_id uuid,p_expected_revision bigint,
    p_request_key text,p_request_hash text,p_cart jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
    v_receipt public.customer_cart_requests%rowtype;
    v_revision bigint;
    v_checkout uuid;
begin
    if p_user_id is null or p_expected_revision is null or p_expected_revision<0
       or p_request_key is null or length(btrim(p_request_key)) not between 1 and 200
       or p_request_hash is null or length(p_request_hash)<>64 then raise exception 'Invalid cart commit input'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
    select * into v_receipt from public.customer_cart_requests where user_id=p_user_id and request_key=p_request_key;
    if found then
        if v_receipt.request_hash<>p_request_hash then return jsonb_build_object('status','IDEMPOTENCY_CONFLICT'); end if;
        return jsonb_build_object('status','ok','cart',v_receipt.data);
    end if;
    select revision,checkout_id into v_revision,v_checkout from public.customer_carts where user_id=p_user_id;
    if v_checkout is not null then return jsonb_build_object('status','CART_CHECKOUT_LOCKED'); end if;
    if coalesce(v_revision,0)<>p_expected_revision then return jsonb_build_object('status','CART_REVISION_CONFLICT'); end if;
    if (p_cart->>'revision')::bigint is distinct from p_expected_revision+1 then raise exception 'Invalid next revision'; end if;
    insert into public.customer_carts(user_id,revision,data) values(p_user_id,p_expected_revision+1,p_cart)
      on conflict(user_id) do update set revision=excluded.revision,data=excluded.data,updated_at=now();
    insert into public.customer_cart_requests(user_id,request_key,request_hash,data) values(p_user_id,p_request_key,p_request_hash,p_cart);
    return jsonb_build_object('status','ok','cart',p_cart);
end;
$$;
revoke all on function public.lock_customer_checkout(uuid,uuid,bigint,integer) from public,anon,authenticated;
revoke all on function public.update_customer_checkout(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.lock_customer_checkout(uuid,uuid,bigint,integer) to service_role;
grant execute on function public.update_customer_checkout(uuid,uuid,text,jsonb,text) to service_role;
revoke all on function public.commit_customer_cart(uuid,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.commit_customer_cart(uuid,bigint,text,text,jsonb) to service_role;
commit;
