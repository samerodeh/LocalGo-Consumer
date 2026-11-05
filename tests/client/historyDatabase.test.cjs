// Run with LOCALGO_PGLITE_MODULE pointing to a temporary @electric-sql/pglite
// installation. No production dependency or access to the real Supabase project.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('PostgreSQL migrations execute and history enforces ownership, immutability and replay',
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
    await db.query('DELETE FROM auth.users WHERE id = $1', [alice]);
    assert.equal((await db.query('SELECT * FROM public.goer_history_turns')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM public.goer_conversations')).rows.length, 0);
  } finally { await db.close(); }
});
