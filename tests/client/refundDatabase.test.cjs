const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const migrationDir = path.join(__dirname, '../../supabase/migrations');

test('refund claims and order inserts serialize; only successful refunds unlock carts',
  { skip: !process.env.LOCALGO_PGLITE_MODULE }, async () => {
  const { PGlite } = require(process.env.LOCALGO_PGLITE_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE TABLE public.orders (id uuid PRIMARY KEY, customer_id uuid, payment_intent_id text);
      GRANT SELECT ON public.orders TO service_role;
      GRANT INSERT ON public.orders TO anon;`);
    for (const name of ['202611040001_customer_carts.sql', '202611040002_cart_checkout.sql',
      '202611080001_payment_refund_reconciliation.sql']) {
      await db.exec(fs.readFileSync(path.join(migrationDir, name), 'utf8'));
    }
    const owner = randomUUID(), order = randomUUID(), secondOrder = randomUUID();
    await db.query('INSERT INTO auth.users VALUES ($1)', [owner]);
    const cart = { revision: 1, merchant_id: 'al-taib', currency: 'CAD',
      lines: [{ product_id: 'pizza', name: 'Pizza', quantity: 1, unit_price_cents: 550, line_total_cents: 550 }],
      subtotal_cents: 550, delivery_fee_cents: 500, total_cents: 1050 };
    async function rpc(name, args) {
      return db.transaction(async tx => {
        await tx.exec('SET LOCAL ROLE service_role');
        return (await tx.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS value`, args)).rows[0].value;
      });
    }
    assert.equal((await rpc('commit_customer_cart', [owner, 0, 'add', 'a'.repeat(64), JSON.stringify(cart)])).status, 'ok');
    assert.equal((await rpc('lock_customer_checkout', [owner, order, 1, 0])).status, 'ok');
    assert.equal((await rpc('update_customer_checkout', [owner, order, 'attach', null, 'pi_first'])).status, 'ok');
    assert.equal((await rpc('claim_customer_checkout_refund', [owner, order, 'pi_wrong'])).status, 'CHECKOUT_CONFLICT');
    assert.equal((await rpc('claim_customer_checkout_refund', [owner, order, 'pi_first'])).checkout.status, 'refunding');
    await assert.rejects(db.query('INSERT INTO public.orders VALUES ($1,$2,$3)', [order, owner, 'pi_first']),
      /Checkout is unavailable/);
    assert.equal((await rpc('record_customer_checkout_refund', [owner, order, 'pi_first', 're_first', false])).checkout.status, 'refunding');
    assert.equal((await db.query('SELECT checkout_id FROM public.customer_carts WHERE user_id=$1', [owner])).rows[0].checkout_id, order);
    assert.equal((await rpc('record_customer_checkout_refund', [owner, order, 'pi_first', 're_first', true])).checkout.status, 'refunded');
    assert.equal((await rpc('record_customer_checkout_refund', [owner, order, 'pi_first', 're_first', true])).status, 'ok');
    assert.equal((await db.query('SELECT checkout_id FROM public.customer_carts WHERE user_id=$1', [owner])).rows[0].checkout_id, null);
    await assert.rejects(db.query('INSERT INTO public.orders VALUES ($1,$2,$3)', [order, owner, 'pi_first']),
      /Checkout is unavailable/);

    assert.equal((await rpc('lock_customer_checkout', [owner, secondOrder, 1, 0])).status, 'ok');
    assert.equal((await rpc('update_customer_checkout', [owner, secondOrder, 'attach', null, 'pi_second'])).status, 'ok');
    await db.query('INSERT INTO public.orders VALUES ($1,$2,$3)', [secondOrder, owner, 'pi_second']);
    assert.equal((await rpc('claim_customer_checkout_refund', [owner, secondOrder, 'pi_second'])).status, 'ORDER_PUBLISHED');
    assert.equal((await db.query('SELECT status FROM public.customer_cart_checkouts WHERE order_id=$1', [secondOrder])).rows[0].status, 'pending');
    await assert.rejects(db.transaction(async tx => {
      await tx.exec('SET LOCAL ROLE authenticated');
      await tx.query('SELECT public.claim_customer_checkout_refund($1,$2,$3)', [owner, secondOrder, 'pi_second']);
    }), /permission denied/);
  } finally { await db.close(); }
});