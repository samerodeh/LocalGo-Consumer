// Local-only PostgREST subset. Actual PostgreSQL enforces RLS and courier RPCs.
const { execFileSync } = require('child_process');
const quote = (v) => "'" + String(v).replace(/'/g, "''") + "'";
function sql(uid, query) {
  const result = execFileSync(process.env.LOCALGO_TEST_PSQL || '/opt/homebrew/opt/postgresql@16/bin/psql', ['-h','127.0.0.1','-p',process.env.LOCALGO_TEST_PORT || '55440','-d',process.env.LOCALGO_TEST_DATABASE || 'localgo_release_http','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-c', `begin; set local role ${uid === 'service' ? 'service_role' : 'authenticated'}; select set_config('request.jwt.claim.sub',${quote(uid === 'service' ? '' : uid)},true); ${query}; commit;`], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] });
  return JSON.parse(result.trim().split('\n').pop() || 'null');
}
const tables = new Set(['orders','driver_orders','approved_drivers','driver_dispatch','driver_shifts','messages','customers','drivers','push_tokens']);
const functions = new Set(['driver_set_online','driver_next_offer','driver_accept_offer','driver_decline_offer','driver_update_status']);
function tableRequest(uid, method, table, search, body) {
  if (!tables.has(table)) return null;
  const columns = Object.keys(body).filter((key) => /^[a-z_]+$/.test(key));
  const where = [];
  for (const key of ['id','driver_id','order_id','accepted_by','delivery_status','customer_id','is_online']) {
    const value = search.get(key);
    if (value?.startsWith('eq.')) where.push(`${key} = ${quote(value.slice(3))}`);
    else if (value === 'is.null') where.push(`${key} is null`);
  }
  const since = search.get('delivered_at');
  if (since?.startsWith('gte.')) where.push(`delivered_at >= ${quote(since.slice(4))}`);
  const clause = where.length ? ' where ' + where.join(' and ') : '';
  if (method === 'GET') return sql(uid, `select coalesce(jsonb_agg(row),'[]') from (select * from public.${table}${clause} order by ${table === 'orders' || table === 'messages' ? 'created_at desc' : '1'} limit 1000) row`);
  const data = `jsonb_populate_record(null::public.${table},${quote(JSON.stringify(body))}::jsonb)`;
  if (method === 'POST') {
    const conflict = table === 'driver_orders' ? ' on conflict(driver_id,order_id) do update set status=excluded.status,updated_at=excluded.updated_at' : table === 'push_tokens' ? ' on conflict(user_id,token) do nothing' : '';
    return sql(uid, `with changed as (insert into public.${table}(${columns.join(',')}) select ${columns.join(',')} from ${data}${conflict} returning *) select coalesce(jsonb_agg(changed),'[]') from changed`);
  }
  if (method === 'PATCH') return sql(uid, `with changed as (update public.${table} set ${columns.map((key) => `${key}=(select ${key} from ${data})`).join(',')}${clause} returning *) select coalesce(jsonb_agg(changed),'[]') from changed`);
  return null;
}
function callRpc(uid, name, body) {
  if (!functions.has(name)) return null;
  if (name === 'driver_update_status') {
    const items = Array.isArray(body.p_verified_items) ? `array[${body.p_verified_items.map(Number).join(',')}]::integer[]` : 'null::integer[]';
    return sql(uid, `select public.driver_update_status(${quote(body.p_order_id)}::uuid,${quote(body.p_status)},${body.p_photo_url == null ? 'null' : quote(body.p_photo_url)},${items})::text`);
  }
  const arg = name === 'driver_set_online' ? (body.p_online === true ? 'true' : 'false') : name === 'driver_next_offer' ? '' : `${quote(body.p_order_id)}::uuid`;
  return sql(uid, `select coalesce(public.${name}(${arg})::text,'null')`);
}
function recordPhoto(uid, path) {
  return sql(uid, `with stored as (insert into storage.objects(bucket_id,name,owner_id,metadata) values('order-photos',${quote(path)},${quote(uid)},'{"mimetype":"image/jpeg"}'::jsonb) returning id) select jsonb_agg(id) from stored`);
}
module.exports = { tableRequest, callRpc, recordPhoto };
