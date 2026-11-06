-- Read-only security review for the cart, checkout and Goer history tables.
-- Run in the Supabase SQL Editor. It changes nothing.

-- 1. Row-level security must be ON for every table.
select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('customer_carts', 'customer_cart_requests', 'customer_cart_checkouts',
                    'goer_conversations', 'goer_history_turns')
order by 1;

-- 2. Policies: who may read/write which rows.
select tablename, policyname, cmd, roles, qual as using_expr, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('customer_carts', 'customer_cart_requests', 'customer_cart_checkouts',
                    'goer_conversations', 'goer_history_turns')
order by tablename, policyname;

-- 3. Table privileges granted to the API roles (anon must have none).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated')
  and table_name in ('customer_carts', 'customer_cart_requests', 'customer_cart_checkouts',
                     'goer_conversations', 'goer_history_turns')
group by table_name, grantee
order by table_name, grantee;

-- 4. RPC functions: security mode and who may execute them.
select p.proname as function_name,
       case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security,
       array_to_string(p.proconfig, ', ') as settings,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_can_execute
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('commit_customer_cart', 'lock_customer_checkout', 'update_customer_checkout',
                    'save_goer_history_turn')
order by 1;
