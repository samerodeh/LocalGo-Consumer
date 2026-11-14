// Local-only Auth/PostgREST subset backed by the REAL disposable PostgreSQL
// schema. Fixture tokens model identities, not JWT cryptography or Supabase.
const http=require('http'),{execFileSync}=require('child_process');
const q=v=>"'"+String(v).replace(/'/g,"''")+"'";
const identities={'simulation-customer':'33333333-3333-4333-8333-333333333333','simulation-other':'44444444-4444-4444-8444-444444444444','simulation-driver':'22222222-2222-4222-8222-222222222222'};
const tables=new Set(['consumer_merchant_catalog','consumer_merchants','consumer_merchant_staff','consumer_receipts','consumer_promotions','consumer_promotion_availability','consumer_promo_customer_usage','consumer_promo_redemptions','consumer_reviews','consumer_courier_locations','orders','approved_drivers','push_tokens']);
const valid=s=>/^[a-z_]+$/.test(s);
function sql(token,query){const role=token==='simulation-service'?'service_role':identities[token]?'authenticated':'anon';const uid=identities[token]||'';const result=execFileSync('/opt/homebrew/opt/postgresql@16/bin/psql',['-h','127.0.0.1','-p','55439','-d','localgo_consumer_ux_test','-qAt','-v','ON_ERROR_STOP=1','-c',`begin;set local role ${role};select set_config('request.jwt.claim.sub',${q(uid)},true);${query};commit;`],{encoding:'utf8',stdio:['ignore','pipe','pipe']});return JSON.parse(result.trim().split('\n').pop()||'null');}
http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers']||'authorization,apikey,content-type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
 const url=new URL(req.url,'http://localhost'),token=(req.headers.authorization||'').replace('Bearer ',''),uid=identities[token];
 const send=(status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 let body=req.body;if(!body)body=await new Promise(resolve=>{let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{try{resolve(JSON.parse(raw||'{}'));}catch{resolve({});}});});
 const profile=id=>({id,aud:'authenticated',role:'authenticated',email:id===identities['simulation-driver']?'driver@example.test':'customer@example.test',user_metadata:{first_name:'Jamie',last_name:'Chen'},app_metadata:{},created_at:new Date().toISOString()});
 if(url.pathname==='/auth/v1/user')return uid?send(200,profile(uid)):send(401,{message:'Invalid fixture token'});
 if(url.pathname==='/auth/v1/token'){const id=body.email==='customer@example.test'?identities['simulation-customer']:body.email==='driver@example.test'?identities['simulation-driver']:null;if(!id||body.password!=='simulation-only')return send(400,{message:'Invalid fixture credentials'});return send(200,{access_token:id===identities['simulation-driver']?'simulation-driver':'simulation-customer',refresh_token:'fixture-refresh',token_type:'bearer',expires_in:3600,user:profile(id)});}
 if(url.pathname==='/auth/v1/logout')return send(200,{});
 try{
 if(url.pathname==='/rest/v1/rpc/consumer_checkout')return send(200,sql(token,`select consumer_checkout(${q(JSON.stringify(body.p_order))}::jsonb)`));
 if(url.pathname==='/rest/v1/rpc/consumer_share_location')return send(200,sql(token,`select to_jsonb(consumer_share_location(${q(body.p_order_id)}::uuid,${q(body.p_driver_id)}::uuid,${q(body.p_latitude)}::double precision,${q(body.p_longitude)}::double precision,${q(body.p_recorded_at)}::timestamptz))`));
 if(!url.pathname.startsWith('/rest/v1/'))return send(501,{message:'Outside modeled contract'});
 const table=url.pathname.split('/').pop();if(!tables.has(table))return send(501,{message:'Outside modeled table'});
 const filters=[];for(const [key,value] of url.searchParams){if(!valid(key)||['select','order','limit'].includes(key))continue;if(value.startsWith('eq.'))filters.push(`${key}=${q(value.slice(3))}`);else if(value.startsWith('gte.'))filters.push(`${key}>=${q(value.slice(4))}`);else if(value.startsWith('in.(')&&value.endsWith(')'))filters.push(`${key} in (${value.slice(4,-1).split(',').map(q).join(',')})`);else return send(501,{message:'Filter outside modeled contract'});}
 const where=filters.length?' where '+filters.join(' and '):'';
 if(req.method==='GET'){const selection=url.searchParams.get('select')||'*';if(selection!=='*'&&!selection.split(',').every(valid))return send(501,{});const order=url.searchParams.get('order')?.split('.');const ordered=order&&valid(order[0])?` order by ${order[0]} ${order[1]==='desc'?'desc':'asc'}`:'';const limit=Math.min(1000,Math.max(1,parseInt(url.searchParams.get('limit'))||100));return send(200,sql(token,`select coalesce(jsonb_agg(row),'[]') from (select ${selection} from public.${table}${where}${ordered} limit ${limit}) row`));}
 const columns=Object.keys(body).filter(valid),data=`jsonb_populate_record(null::public.${table},${q(JSON.stringify(body))}::jsonb)`;
 if(req.method==='POST'){const rows=sql(token,`with rows as(insert into public.${table}(${columns.join(',')}) select ${columns.join(',')} from ${data} returning *) select coalesce(jsonb_agg(rows),'[]') from rows`);return send(201,rows);}
 if(req.method==='PATCH')return send(200,sql(token,`with rows as(update public.${table} set ${columns.map(k=>`${k}=(select ${k} from ${data})`).join(',')}${where} returning *) select coalesce(jsonb_agg(rows),'[]') from rows`));
 return send(501,{});
 }catch(e){const error=String(e.stderr||e.message);return send(error.includes('duplicate key')?409:403,{message:error.slice(0,600)});}
}).listen(process.env.PORT||4501,'127.0.0.1');
