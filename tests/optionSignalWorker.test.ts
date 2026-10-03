import assert from 'node:assert/strict';
import {reconcileOptionSignals,OptionActionReview} from '../supabase/functions/webhook-listener/option_signal_worker.ts';
import {optionOrder} from '../src/utils/optionWebhook.ts';

const start=new Date('2026-10-02T15:00:00Z');
function fixture(targetFilled=0,entryFilled=3) {
  const plan:any={id:'plan',symbol:'AAPL261009C00335000',expiration:'2026-10-09',entry_price:'2.00',target_price:'2.40',
    target_time_in_force:'gtc',entry_attempted_at:start.toISOString(),target_attempted_at:start.toISOString(),management:{}};
  const entry={...optionOrder(plan,'entry'),id:'entry',status:entryFilled===3?'filled':'partially_filled',filled_qty:String(entryFilled)};
  const target={...optionOrder(plan,'target'),id:'target',status:targetFilled?'filled':'new',filled_qty:String(targetFilled)};
  const orders=new Map<string,any>([[entry.client_order_id,entry],[target.client_order_id,target]]);
  const actions:any[]=[];const posts:any[]=[];const deletes:string[]=[];
  let qty=entryFilled-targetFilled,autoCancel=true,loseResponse=false,current=start,extraPosition=0;
  const saved=new Map<string,any>();
  const deps={now:()=>current,save:async(p:any)=>Object.assign(plan,p),saveAction:async(a:any)=>{saved.set(a.id,structuredClone(a));},
    broker:async(path:string,body?:any,method?:string):Promise<any>=>{
      if(method==='DELETE') {const id=path.split('/').at(-1);deletes.push(id!);const o=[...orders.values()].find(o=>o.id===id);if(autoCancel)o.status='canceled';else o.status='pending_cancel';return {};}
      if(body) {
        const a=actions.find(a=>body.client_order_id.includes(a.id));const leg=body.type==='stop'?'stop':'sale';
        assert.ok(saved.get(a.id)?.execution?.[leg]?.attempted_at,'Persist intent before POST');
        assert.equal(body.side,'sell');assert.equal(body.position_intent,'sell_to_close');
        posts.push(body);const order={...body,id:`order-${posts.length}`,status:body.type==='market'?'filled':'new',filled_qty:body.type==='market'?body.qty:'0'};
        orders.set(body.client_order_id,order);if(body.type==='market')qty-=Number(body.qty);
        if(loseResponse){loseResponse=false;throw new Error('Response lost');}return order;
      }
      if(path.startsWith('/v2/orders?'))return [...orders.values()].filter(o=>!['filled','canceled','expired','rejected'].includes(o.status));
      if(path.startsWith('/v2/positions/'))return {qty:String(qty+extraPosition),qty_available:String(qty-[...orders.values()].filter(o=>o.side==='sell'&&!['filled','canceled','expired','rejected'].includes(o.status)).reduce((n,o)=>n+Number(o.qty)-Number(o.filled_qty),0))};
      const key=decodeURIComponent(path.split('client_order_id=')[1]);const order=orders.get(key);
      if(!order)throw Object.assign(new Error('not found'),{status:404});return order;
    }};
  return {plan,actions,orders,posts,deletes,entry,target,deps,
    add(action='target_reached',price='2.40',stop='1.67') {const a={id:`a${actions.length+1}`,status:'queued',instruction:{action,reference_price:price,stop_price:stop},execution:{}};actions.push(a);return a;},
    run:()=>reconcileOptionSignals(plan,actions,deps),setAutoCancel:(v:boolean)=>autoCancel=v,lose:()=>loseResponse=true,
    advance:()=>current=new Date(start.getTime()+360000),extra:(n:number)=>extraPosition=n,
    triggerStop(){const o=[...orders.values()].filter(o=>o.type==='stop').at(-1)!;o.status='filled';o.filled_qty=o.qty;qty-=Number(o.qty);},
    async drain(){for(let n=0;n<10 && actions.some(a=>a.status!=='completed');n++)await reconcileOptionSignals(plan,actions,deps);}
  };
}
// Full close waits for cancellation, then sells the remaining two (not three).
const close=fixture(1);close.add('close_all');await close.drain();
assert.equal(close.posts.length,1);assert.equal(close.posts[0].qty,'2');assert.equal(close.posts[0].type,'market');assert.equal(close.plan.status,'closed');
await close.run();assert.equal(close.posts.length,1);

// Existing automatic first-target fill credits the first alert; protect the two.
const f=fixture(1);f.add();await f.drain();assert.equal(f.posts.length,1);assert.equal(f.posts[0].type,'stop');assert.equal(f.posts[0].qty,'2');
f.add('target_reached','2.80','2.01');await f.drain();
assert.equal(f.posts.filter(o=>o.type==='market').length,1);assert.equal(f.posts.find(o=>o.type==='market').qty,'1');
assert.equal(f.posts.at(-1).qty,'1');assert.equal(f.posts.at(-1).stop_price,'2.01');
f.add('target_reached','3.20','2.56');await f.drain();assert.equal(f.posts.filter(o=>o.type==='market').length,1,'Retain one runner');
f.add('target_reached','2.60','1.70');await f.drain();assert.equal(f.posts.at(-1).stop_price,'2.56','Older alert cannot lower stop');
assert.equal(f.posts.filter(o=>o.type==='market').length,1,'Older target cannot sell again');
f.triggerStop();await f.run();assert.equal(f.plan.status,'closed');
f.add('close_all');await f.drain();assert.equal(f.posts.filter(o=>o.type==='market').length,1,'Already closed is no-op');

// First target not filled: cancel it and sell one exactly once.
const first=fixture();first.add();await first.drain();assert.equal(first.posts[0].qty,'1');assert.equal(first.posts.at(-1).qty,'2');
first.add();await first.drain();assert.equal(first.posts.filter(o=>o.type==='market').length,1,'Duplicate price cannot create another milestone');

// Cancel response does not imply terminal cancellation. A racing target fill is
// counted on the next reconciliation before final close sizing.
const race=fixture();race.setAutoCancel(false);race.add('close_all');await race.run();assert.equal(race.posts.length,0);
race.target.status='filled';race.target.filled_qty='1';race.extra(-1);await race.run();
assert.equal(race.posts[0].qty,'2');

// Ambiguous POST is recovered through the same client ID; no repeat submission.
const uncertain=fixture(1);uncertain.add('close_all');uncertain.lose();await uncertain.drain();assert.equal(uncertain.posts.length,1);
assert.equal(uncertain.plan.status,'closed');

// Partial entry is canceled before exiting its filled quantity.
const partial=fixture(0,1);partial.add('close_all');await partial.drain();assert.ok(partial.deletes.includes('entry'));assert.equal(partial.posts[0].qty,'1');

const drift=fixture(1);drift.add('close_all');drift.extra(2);
await assert.rejects(()=>drift.run(),OptionActionReview);assert.equal(drift.posts.length,0);
const foreign=fixture(1);foreign.add('close_all');foreign.orders.set('foreign',{id:'foreign',symbol:foreign.plan.symbol,side:'sell',qty:'1',filled_qty:'0',status:'new'});
await assert.rejects(()=>foreign.run(),/Unmanaged order/);assert.equal(foreign.deletes.length,0);

// Restart between completed action and plan save reconstructs monotonic stop policy.
const restart=fixture(1);restart.add();await restart.drain();restart.plan.management={enabled:true};
restart.add('target_reached','2.80','1.00');await restart.drain();assert.equal(restart.posts.at(-1).stop_price,'1.67');
console.log('Option close, milestone credit, raised stops, races, retries, ownership, and recovery passed');
