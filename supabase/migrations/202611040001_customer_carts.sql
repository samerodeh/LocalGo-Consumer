-- Apply deliberately to the shared LocalGo Supabase project; not run by app startup.
begin;

create table public.customer_carts (
    user_id uuid primary key references auth.users(id) on delete cascade,
    revision bigint not null check (revision >= 0),
    data jsonb not null check (jsonb_typeof(data) = 'object'),
    updated_at timestamptz not null default now()
);

create table public.customer_cart_requests (
    user_id uuid not null references auth.users(id) on delete cascade,
    request_key text not null check (length(request_key) between 1 and 200),
    request_hash text not null check (length(request_hash) = 64),
    data jsonb not null,
    created_at timestamptz not null default now(),
    primary key (user_id, request_key)
);

alter table public.customer_carts enable row level security;
alter table public.customer_cart_requests enable row level security;
revoke all on public.customer_carts from anon, authenticated;
revoke all on public.customer_cart_requests from anon, authenticated;
grant select on public.customer_carts to authenticated;
grant all on public.customer_carts, public.customer_cart_requests to service_role;

create policy customer_cart_read_own on public.customer_carts
    for select to authenticated using (user_id = (select auth.uid()));

-- Only the verified backend may commit a server-priced snapshot. Clients have
-- no direct writes or RPC execution; accepting arbitrary prices here from an
-- authenticated browser would bypass Python validation.
create function public.commit_customer_cart(
    p_user_id uuid,
    p_expected_revision bigint,
    p_request_key text,
    p_request_hash text,
    p_cart jsonb
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
    v_receipt public.customer_cart_requests%rowtype;
    v_revision bigint;
begin
    if p_user_id is null or p_expected_revision is null or p_expected_revision < 0
       or p_request_key is null or length(btrim(p_request_key)) not between 1 and 200
       or p_request_hash is null or length(p_request_hash) <> 64 then
        raise exception 'Invalid cart commit input';
    end if;

    -- Serializes even the first write, when no cart row exists yet.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

    select * into v_receipt from public.customer_cart_requests
      where user_id = p_user_id and request_key = p_request_key;
    if found then
        if v_receipt.request_hash <> p_request_hash then
            return jsonb_build_object('status', 'IDEMPOTENCY_CONFLICT');
        end if;
        return jsonb_build_object('status', 'ok', 'cart', v_receipt.data);
    end if;

    select revision into v_revision from public.customer_carts where user_id = p_user_id;
    if coalesce(v_revision, 0) <> p_expected_revision then
        return jsonb_build_object('status', 'CART_REVISION_CONFLICT');
    end if;
    if (p_cart ->> 'revision')::bigint is distinct from p_expected_revision + 1 then
        raise exception 'Invalid next cart revision';
    end if;

    insert into public.customer_carts(user_id, revision, data)
      values (p_user_id, p_expected_revision + 1, p_cart)
      on conflict (user_id) do update set
        revision = excluded.revision, data = excluded.data, updated_at = now();
    insert into public.customer_cart_requests(user_id, request_key, request_hash, data)
      values (p_user_id, p_request_key, p_request_hash, p_cart);
    return jsonb_build_object('status', 'ok', 'cart', p_cart);
end;
$$;

revoke all on function public.commit_customer_cart(uuid, bigint, text, text, jsonb)
    from public, anon, authenticated;
grant execute on function public.commit_customer_cart(uuid, bigint, text, text, jsonb)
    to service_role;

commit;
