-- Apply after 202611050001. Serializes paid-order publication against refund claims.
begin;

alter table public.customer_cart_checkouts
  drop constraint customer_cart_checkouts_status_check;
alter table public.customer_cart_checkouts
  add constraint customer_cart_checkouts_status_check
  check (status in ('pending', 'released', 'consumed', 'refunding', 'refunded'));
alter table public.customer_cart_checkouts add column refund_id text;

-- The service role claims an orphan only after Stripe confirms the one-hour age.
-- The advisory lock is shared with the order INSERT trigger below.
create function public.claim_customer_checkout_refund(
    p_user_id uuid, p_order_id uuid, p_payment_id text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
    v_checkout public.customer_cart_checkouts%rowtype;
begin
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
    select * into v_checkout from public.customer_cart_checkouts
      where order_id = p_order_id and user_id = p_user_id for update;
    if not found then return jsonb_build_object('status', 'CHECKOUT_NOT_FOUND'); end if;
    if v_checkout.payment_intent_id is distinct from p_payment_id or p_payment_id is null then
        return jsonb_build_object('status', 'CHECKOUT_CONFLICT');
    end if;
    if exists (select 1 from public.orders where id::text = p_order_id::text) then
        return jsonb_build_object('status', 'ORDER_PUBLISHED');
    end if;
    if v_checkout.status in ('released', 'consumed') then
        return jsonb_build_object('status', 'CHECKOUT_CLOSED');
    end if;
    if v_checkout.status = 'pending' then
        update public.customer_cart_checkouts
          set status = 'refunding' where order_id = p_order_id returning * into v_checkout;
    end if;
    return jsonb_build_object('status', 'ok', 'checkout', to_jsonb(v_checkout));
end;
$$;

-- Record the provider refund ID before releasing the cart. A pending or failed
-- Stripe refund keeps the cart locked; only confirmed success unlocks it.
create function public.record_customer_checkout_refund(
    p_user_id uuid, p_order_id uuid, p_payment_id text,
    p_refund_id text, p_succeeded boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
    v_checkout public.customer_cart_checkouts%rowtype;
    v_cart public.customer_carts%rowtype;
begin
    if p_refund_id is null or length(btrim(p_refund_id)) = 0 then
        return jsonb_build_object('status', 'CHECKOUT_CONFLICT');
    end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));
    select * into v_checkout from public.customer_cart_checkouts
      where order_id = p_order_id and user_id = p_user_id for update;
    if not found then return jsonb_build_object('status', 'CHECKOUT_NOT_FOUND'); end if;
    if v_checkout.payment_intent_id is distinct from p_payment_id
       or v_checkout.refund_id is not null and v_checkout.refund_id <> p_refund_id then
        return jsonb_build_object('status', 'CHECKOUT_CONFLICT');
    end if;
    if v_checkout.status = 'refunded' and v_checkout.refund_id = p_refund_id then
        return jsonb_build_object('status', 'ok', 'checkout', to_jsonb(v_checkout));
    end if;
    if v_checkout.status <> 'refunding' then
        return jsonb_build_object('status', 'CHECKOUT_CLOSED');
    end if;
    if exists (select 1 from public.orders where id::text = p_order_id::text) then
        return jsonb_build_object('status', 'ORDER_PUBLISHED');
    end if;
    if p_succeeded then
        select * into v_cart from public.customer_carts where user_id = p_user_id for update;
        if not found or v_cart.checkout_id is distinct from p_order_id then
            return jsonb_build_object('status', 'CHECKOUT_CONFLICT');
        end if;
        update public.customer_carts set checkout_id = null where user_id = p_user_id;
        update public.customer_cart_checkouts set status = 'refunded', refund_id = p_refund_id
          where order_id = p_order_id returning * into v_checkout;
    else
        update public.customer_cart_checkouts set refund_id = p_refund_id
          where order_id = p_order_id returning * into v_checkout;
    end if;
    return jsonb_build_object('status', 'ok', 'checkout', to_jsonb(v_checkout));
end;
$$;

-- An order INSERT and a refund claim take the same lock. Whichever commits
-- first wins: the other sees the committed order or the refunding status.
create function public.guard_refunding_checkout_order() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
    v_owner uuid;
    v_checkout public.customer_cart_checkouts%rowtype;
begin
    select user_id into v_owner from public.customer_cart_checkouts
      where order_id::text = new.id::text;
    if not found then return new; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text, 0));
    select * into v_checkout from public.customer_cart_checkouts
      where order_id::text = new.id::text for update;
    if v_checkout.status not in ('pending', 'consumed')
       or v_checkout.payment_intent_id is distinct from new.payment_intent_id
       or v_checkout.user_id::text is distinct from new.customer_id::text then
        raise exception 'Checkout is unavailable for order publication';
    end if;
    return new;
end;
$$;
create trigger guard_refunding_checkout_order_before_insert
  before insert on public.orders for each row
  execute function public.guard_refunding_checkout_order();

revoke all on function public.claim_customer_checkout_refund(uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function public.record_customer_checkout_refund(uuid,uuid,text,text,boolean)
  from public, anon, authenticated;
grant execute on function public.claim_customer_checkout_refund(uuid,uuid,text) to service_role;
grant execute on function public.record_customer_checkout_refund(uuid,uuid,text,text,boolean) to service_role;
revoke all on function public.guard_refunding_checkout_order() from public, anon, authenticated;
commit;