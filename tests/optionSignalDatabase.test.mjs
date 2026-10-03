// Optional isolated PostgreSQL verification; never connects to production.
// npm install --prefix tmp/webhook-db-verification --no-save @electric-sql/pglite
// node tests/optionSignalDatabase.test.mjs
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '../tmp/webhook-db-verification/node_modules/@electric-sql/pglite/dist/index.js';

const db=new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql as 'select null::uuid';`);
for(const path of ['202609250001_option_trade_plans.sql','202610020001_option_signal_actions.sql']) {
  await db.exec(await readFile(new URL(`../supabase/migrations/${path}`,import.meta.url),'utf8'));
}
const owner='11111111-1111-4111-8111-111111111111';
const plan='22222222-2222-4222-8222-222222222222';
const peer='33333333-3333-4333-8333-333333333333';
const scope='route:owned';
await db.query('insert into auth.users values ($1)',[owner]);
async function insert(id,key,status='first_target_filled') {
  return db.query(`insert into option_trade_plans(id,user_id,broker_account_id,broker_base_url,route_scope,delivery_key,
  original_message,underlying,symbol,expiration,strike,option_type,entry_price,target_price,status,entry_filled_qty,target_filled_qty)
  values($1,$2,'paper','https://paper-api.alpaca.markets',$3,$4,'fixture','AAPL','AAPL301009C00335000','2030-10-09',335,'call',2,2.4,$5,3,1)`,[id,owner,scope,key,status]);
}
await insert(plan,'entry-key');
const instruction={asset:'option',action:'close_all',underlying:'AAPL',strike:335,option_type:'call',month:10,day:9,reference_price:'2.40'};
const enqueue=(key,signal=instruction,p=plan)=>db.query('select enqueue_option_signal_action($1,$2,$3,$4,$5,$6) as result',
  [p,owner,scope,key,signal,'fixture close']);
const first=(await enqueue('close-key')).rows[0].result;
assert.equal(first.duplicate,false);
assert.equal((await enqueue('close-key')).rows[0].result.duplicate,true);
await assert.rejects(()=>enqueue('close-key',{...instruction,reference_price:'2.50'}),/different instructions/);
await assert.rejects(()=>enqueue('entry-key'),/already used/);
await assert.rejects(()=>insert(peer,'close-key'),/management instruction/);
const claimed=(await db.query('select * from claim_option_trade_plans(null)')).rows;
assert.equal(claimed.length,1,'Actions wake plans after the first target filled');
assert.equal(claimed[0].id,plan);
await insert(peer,'peer-key','queued');
assert.equal((await db.query('select * from claim_option_trade_plans(null)')).rows.length,0,'One account/contract lease at a time');
await assert.rejects(()=>db.query('select save_option_action($1,$2,$3,$4,$5,$6)',[plan,peer,first.action.id,{},'processing',null]),/lease lost/);
await db.query('select save_option_action($1,$2,$3,$4,$5,$6)',[plan,claimed[0].lease_token,first.action.id,{decision:{desired_total:2}},'completed',null]);
assert.equal((await db.query('select status from option_signal_actions where id=$1',[first.action.id])).rows[0].status,'completed');
await db.query("update option_trade_plans set status='closed',lease_until=null,lease_token=null where id=$1",[plan]);
const next=(await db.query('select * from claim_option_trade_plans(null)')).rows;
assert.deepEqual(next.map(p=>p.id),[peer],'Closed plans do not recreate entry/target orders');
await db.query('update option_trade_plans set lease_until=now()-interval \'1 second\' where id=$1',[peer]);
await db.query("update option_trade_plans set status='entry_terminal',entry_filled_qty=0 where id=$1",[peer]);
await enqueue('another-close');
assert.equal((await db.query('select * from claim_option_trade_plans(null)')).rows[0].id,plan,'A later close on a closed plan can reconcile as a no-op');
const permissions=(await db.query(`select
  has_function_privilege('anon','enqueue_option_signal_action(uuid,uuid,text,text,jsonb,text)','execute') as anon_enqueue,
  has_function_privilege('authenticated','save_option_action(uuid,uuid,uuid,jsonb,text,text)','execute') as user_write,
  has_function_privilege('service_role','save_option_action(uuid,uuid,uuid,jsonb,text,text)','execute') as worker_write`)).rows[0];
assert.deepEqual(permissions,{anon_enqueue:false,user_write:false,worker_write:true});
await db.close();
console.log('Isolated PostgreSQL migrations, action idempotency/conflicts, worker leases, and permissions passed');
