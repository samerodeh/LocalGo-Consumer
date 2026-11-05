// Run with LOCALGO_PGLITE_MODULE pointing to a temporary @electric-sql/pglite
// installation. No production dependency or access to the real Supabase project.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('PostgreSQL executes cart/checkout/history RPCs with ownership, immutable replay and one-time consumption',
  { skip: !process.env.LOCALGO_PGLITE_MODULE }, async () => {
  const { PGlite } = require(process.env.LOCALGO_PGLITE_MODULE);
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      GRANT USAGE ON SCHEMA auth TO authenticated;`);
    const dir = path.join(__dirname, '../../supabase/migrations');
    for (const name of ['202611040001_customer_carts.sql', '202611040002_cart_checkout.sql',
      '202611050001_goer_history.sql']) await db.exec(fs.readFileSync(path.join(dir, name), 'utf8'));
    const alice = randomUUID(), bob = randomUUID(), conversation = randomUUID(), request = randomUUID();
    await db.query('INSERT INTO auth.users VALUES ($1), ($2)', [alice, bob]);
    const response = { conversation_id: conversation, turn_id: request, text: 'Pizza found.', cards: [] };
    async function asUser(user, callback, role = 'authenticated') {
      return db.transaction(async tx => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
        return callback(tx);
      });
    }
    const save = (tx, message = 'find pizza', value = response) => tx.query(
      'SELECT public.save_goer_history_turn($1, $2, $3, $4::jsonb)',
      [conversation, request, message, JSON.stringify(value)]);
    await asUser(alice, tx => save(tx));
    await asUser(alice, tx => save(tx));
    const own = await asUser(alice, tx => tx.query('SELECT * FROM public.goer_history_turns'));
    assert.equal(own.rows.length, 1, 'same UUID replays without another message');
    assert.equal(own.rows[0].user_id, alice);
    assert.equal((await asUser(bob, tx => tx.query('SELECT * FROM public.goer_history_turns'))).rows.length, 0);
    assert.equal((await asUser(bob, tx => tx.query('SELECT * FROM public.goer_conversations'))).rows.length, 0);
    await assert.rejects(asUser(bob, tx => save(tx)), /Conversation unavailable/);
    await assert.rejects(asUser(alice, tx => save(tx, 'different command')), /different content/);
    await assert.rejects(asUser(alice, tx => save(tx, 'find pizza', { ...response, text: 'changed' })), /different content/);
    await assert.rejects(asUser(alice, tx => save(tx, 'find pizza', { ...response, cards: null })), /Invalid history turn/);
    await assert.rejects(asUser(alice, tx => tx.exec('DELETE FROM public.goer_conversations')), /permission denied/);
    await assert.rejects(asUser('', tx => save(tx)), /Authentication required/);
    await assert.rejects(asUser('', tx => save(tx), 'anon'), /permission denied/);
    const cart = { revision: 1, merchant_id: 'al-taib', currency: 'CAD',
      lines: [{ product_id: 'pizza', name: 'Pizza', quantity: 1, unit_price_cents: 550, line_total_cents: 550 }],
      subtotal_cents: 550, delivery_fee_cents: 500, total_cents: 1050 };
    async function rpc(name, args) {
      return asUser('', async tx => (await tx.query(`SELECT public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) AS value`, args)).rows[0].value,
        'service_role');
    }
    const hash = 'a'.repeat(64);
    const commit = (revision, key, body = cart, digest = hash) => rpc('commit_customer_cart',
      [alice, revision, key, digest, JSON.stringify(body)]);
    assert.equal((await commit(0, 'add-pizza')).status, 'ok');
    assert.equal((await commit(0, 'add-pizza')).cart.revision, 1);
    assert.equal((await commit(0, 'add-pizza', cart, 'b'.repeat(64))).status, 'IDEMPOTENCY_CONFLICT');
    assert.equal((await commit(0, 'stale')).status, 'CART_REVISION_CONFLICT');
    assert.equal((await asUser(alice, tx => tx.query('SELECT * FROM public.customer_carts'))).rows.length, 1);
    assert.equal((await asUser(bob, tx => tx.query('SELECT * FROM public.customer_carts'))).rows.length, 0);
    await assert.rejects(asUser(alice, tx => tx.exec('UPDATE public.customer_carts SET revision=99')), /permission denied/);
    await assert.rejects(asUser(alice, tx => tx.query('SELECT public.commit_customer_cart($1,0,$2,$3,$4::jsonb)',
      [alice, 'forged', hash, JSON.stringify(cart)])), /permission denied/);
    await assert.rejects(asUser(alice, tx => tx.exec('SELECT * FROM public.customer_cart_requests')), /permission denied/);
    await assert.rejects(asUser(alice, tx => tx.exec('SELECT * FROM public.customer_cart_checkouts')), /permission denied/);
    const order = randomUUID();
    const lock = (owner = alice, id = order, revision = 1, tip = 100) => rpc('lock_customer_checkout', [owner, id, revision, tip]);
    assert.equal((await lock(alice, order, 0)).status, 'CART_REVISION_CONFLICT');
    assert.equal((await lock()).status, 'ok');
    assert.equal((await lock()).status, 'ok');
    assert.equal((await lock(alice, order, 1, 200)).status, 'CHECKOUT_CONFLICT');
    assert.equal((await lock(bob)).status, 'CHECKOUT_CONFLICT');
    assert.equal((await lock(alice, randomUUID())).status, 'CART_CHECKOUT_LOCKED');
    assert.equal((await commit(1, 'blocked', { ...cart, revision: 2 })).status, 'CART_CHECKOUT_LOCKED');
    assert.equal((await commit(0, 'add-pizza')).status, 'ok', 'a receipt replays even while checkout is locked');
    const update = (action, quote = null, payment = null) => rpc('update_customer_checkout',
      [alice, order, action, quote === null ? null : JSON.stringify(quote), payment]);
    assert.equal((await update('prepare', { total_cents: 1150 })).checkout.quote.total_cents, 1150);
    assert.equal((await update('prepare', { total_cents: 1 })).checkout.quote.total_cents, 1150);
    assert.equal((await update('attach', null, 'pi_test')).status, 'ok');
    assert.equal((await update('attach', null, 'pi_other')).status, 'CHECKOUT_CONFLICT');
    assert.equal((await update('release')).status, 'CHECKOUT_CONFLICT');
    assert.equal((await update('consume', null, 'pi_other')).status, 'CHECKOUT_CONFLICT');
    assert.equal((await update('consume', null, 'pi_test')).status, 'ok');
    assert.equal((await update('consume', null, 'pi_test')).status, 'ok');
    const consumed = (await db.query('SELECT revision,data,checkout_id FROM public.customer_carts WHERE user_id=$1', [alice])).rows[0];
    assert.equal(Number(consumed.revision), 2);
    assert.equal(consumed.data.lines.length, 0);
    assert.equal(consumed.checkout_id, null);
    await db.query('DELETE FROM auth.users WHERE id = $1', [alice]);
    assert.equal((await db.query('SELECT * FROM public.goer_history_turns')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM public.goer_conversations')).rows.length, 0);
    for (const table of ['customer_carts', 'customer_cart_requests', 'customer_cart_checkouts']) {
      assert.equal((await db.query(`SELECT * FROM public.${table}`)).rows.length, 0, `${table} account deletion cascades`);
    }
  } finally { await db.close(); }
});
