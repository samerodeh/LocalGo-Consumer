// Local test Supabase HTTP stand-in: fixture Auth, actual disposable PostgreSQL.
const http = require('http');
const { tableRequest, callRpc, recordPhoto } = require('./database');
const DRIVER = '22222222-2222-4222-8222-222222222222';
const CUSTOMER = '33333333-3333-4333-8333-333333333333';
const users = { 'simulation-service': 'service', 'simulation-driver': DRIVER, 'simulation-customer': CUSTOMER, 'simulation-other': '44444444-4444-4444-8444-444444444444' };
function profile(uid) { return { id: uid, aud: 'authenticated', role: 'authenticated', email: uid === DRIVER ? 'driver@example.test' : 'customer@example.test', app_metadata: {}, user_metadata: uid === DRIVER ? { full_name: 'Alex Morgan', vehicle_type: 'bike' } : { first_name: 'Jamie', last_name: 'Chen' }, created_at: new Date().toISOString() }; }
http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers'] || 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept, x-upsert, accept-profile, content-profile');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const url = new URL(req.url,'http://localhost');
  const uid = users[(req.headers.authorization || '').replace('Bearer ','')];
  const send = (status, body) => { res.writeHead(status,{'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith('/storage/v1/object/public/')) { res.writeHead(200,{'Content-Type':'image/png'}); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6mCEAAAAASUVORK5CYII=','base64')); }
  const body = req.body || await new Promise((resolve) => { let raw=''; req.on('data',(c)=>raw+=c); req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch{resolve({});}}); });
  if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
    const account = body.email === 'driver@example.test' ? DRIVER : body.email === 'customer@example.test' ? CUSTOMER : null;
    if (!account || body.password !== 'simulation-only') return send(400,{error:'invalid_grant',error_description:'Invalid simulation credentials'});
    return send(200,{access_token:account === DRIVER ? 'simulation-driver':'simulation-customer',token_type:'bearer',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,refresh_token:'simulation-refresh',user:profile(account)});
  }
  if (url.pathname === '/auth/v1/logout') return send(200,{});
  if (url.pathname === '/auth/v1/user') return uid ? send(200,profile(uid)):send(401,{message:'Invalid JWT fixture'});
  if (!uid) return send(401,{});
  if (url.pathname.startsWith('/storage/v1/object/order-photos/') && req.method === 'POST') { recordPhoto(uid, url.pathname.split('/order-photos/')[1]); return send(200,{Key:url.pathname.split('/object/')[1]}); }
  if (url.pathname === '/__control' && req.method === 'POST') { await pm.state.set('supabase.failure',body.failure||null); return send(200,{ok:true}); }
  const failure = await pm.state.get('supabase.failure');
  if ((failure === 'mirror' && ((req.method === 'PATCH' && url.pathname === '/rest/v1/orders') || url.pathname === '/rest/v1/rpc/driver_update_status')) || (failure === 'overlay' && req.method === 'GET' && url.pathname === '/rest/v1/driver_orders')) return send(500,{});
  try {
    if (url.pathname.startsWith('/rest/v1/rpc/')) return send(200,callRpc(uid,url.pathname.split('/').pop(),body));
    if (url.pathname.startsWith('/rest/v1/')) {
      const result = tableRequest(uid,req.method,url.pathname.split('/').pop(),url.searchParams,body);
      if (result === null) return send(501,{});
      if (req.headers.accept?.includes('vnd.pgrst.object+json')) return result.length === 1 ? send(200,result[0]):send(406,{message:'Expected one row'});
      return send(req.method === 'POST' ? 201:200,result);
    }
  } catch (error) { const detail=String(error.stderr||error.message); const code=detail.includes('22023') ? '22023' : '42501'; return send(code==='22023' ? 400 : 403,{code,message:'Disposable database rejected operation'}); }
  return send(501,{message:'Outside modeled Supabase contract'});
}).listen(process.env.PORT||4500);
