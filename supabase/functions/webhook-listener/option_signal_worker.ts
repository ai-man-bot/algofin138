import { marketDate, optionOrder } from '../../../src/utils/optionWebhook.ts';

export class OptionActionReview extends Error {}
type Journal = { payload: any; attempted_at: string; order_id?: string; status?: string; filled_qty?: number };
type Deps = {
  broker: (path:string, body?:any, method?:'GET'|'POST'|'DELETE')=>Promise<any>;
  save: (patch:any)=>Promise<void>;
  saveAction: (action:any)=>Promise<void>;
  now?:()=>Date;
};
const final = new Set(['filled','canceled','expired','rejected','replaced']);
const amount = (value:any) => {
  const n=Number(value ?? 0);
  if (!Number.isFinite(n) || n<0 || !Number.isInteger(n)) throw new OptionActionReview('Invalid broker contract quantity');
  return n;
};
const sameOrder = (order:any,payload:any) => order.symbol===payload.symbol && order.client_order_id===payload.client_order_id &&
  order.side===payload.side && order.type===payload.type && Number(order.qty)===Number(payload.qty) &&
  (!payload.limit_price || Number(order.limit_price)===Number(payload.limit_price)) &&
  (!payload.stop_price || Number(order.stop_price)===Number(payload.stop_price));

// Called under the SAME plan lease as entry/first-target processing. Every POST
// is journaled before submission. Cancellations are confirmed on a later read.
export async function reconcileOptionSignals(plan:any, actions:any[], deps:Deps) {
  const now=deps.now ?? (()=>new Date());
  const save=async (patch:any)=>{ await deps.save(patch); Object.assign(plan,patch); };
  const write=async (action:any)=>{ await deps.saveAction(action); };
  async function lookup(payload:any, attempted?:string) {
    try {
      const order=await deps.broker(`/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(payload.client_order_id)}`);
      if (!sameOrder(order,payload)) throw new OptionActionReview('Broker order does not match managed instruction');
      if (amount(order.filled_qty)>amount(order.qty)) throw new OptionActionReview('Broker fill exceeds order quantity');
      return order;
    } catch(error:any) {
      if (error.status!==404) throw error;
      if (attempted) {
        if (now().getTime()-new Date(attempted).getTime()>300000) throw new OptionActionReview('Order outcome unknown; inspect Alpaca before recovery');
        return undefined;
      }
      return null;
    }
  }
  async function refresh(action:any,leg:'sale'|'stop') {
    const journal:Journal|undefined=action.execution?.[leg];
    if (!journal) return null;
    if (journal.order_id && final.has(journal.status!)) {
      // Terminal broker fills are immutable. Avoid rereading the entire history
      // on every tick as target and stop updates accumulate.
      return {...journal.payload,id:journal.order_id,status:journal.status,filled_qty:journal.filled_qty ?? 0};
    }
    const order=await lookup(journal.payload,journal.attempted_at);
    if (!order) return undefined;
    Object.assign(journal,{order_id:order.id,status:order.status,filled_qty:amount(order.filled_qty)});
    await write(action);
    return order;
  }
  const entry=await lookup(optionOrder(plan,'entry'),plan.entry_attempted_at);
  if (entry===undefined) return;
  const target=await lookup(optionOrder(plan,'target'),plan.target_attempted_at);
  if (target===undefined) return;
  await save({entry_filled_qty:amount(entry?.filled_qty), entry_status:entry?.status ?? plan.entry_status,
    target_filled_qty:amount(target?.filled_qty),target_status:target?.status ?? plan.target_status});
  const originals=[entry,target].filter(Boolean);
  const recorded:any[]=[];
  for (const action of actions) for (const leg of ['sale','stop'] as const) {
    const order=await refresh(action,leg);
    if (order===undefined) return; // Includes uncertain stop submission; never sell around it.
    if (order) recorded.push({action,leg,order});
  }
  const extraSold=recorded.reduce((sum,item)=>sum+amount(item.order.filled_qty),0);
  const sold=amount(target?.filled_qty)+extraSold;
  const filled=amount(entry?.filled_qty);
  if (sold>filled) throw new OptionActionReview('Managed sells exceed recorded entry fills');
  const remaining=filled-sold;
  const completed=actions.filter(a=>a.status==='completed').map(a=>a.execution?.decision).filter(Boolean);
  const management={...(plan.management || {}), enabled:true, exit_filled_qty:extraSold,
    milestones:Math.max(Number(plan.management?.milestones || 0),...completed.map(d=>Number(d.milestones || 0))),
    high_target:Math.max(Number(plan.management?.high_target || 0),...completed.map(d=>Number(d.high_target || 0))),
    stop_price:Math.max(Number(plan.management?.stop_price || 0),...completed.map(d=>Number(d.stop_price || 0))) || null};
  await save({management});
  const action=actions.find(a=>a.status==='queued'||a.status==='processing');
  if (!action) {
    const latest=recorded.filter(x=>x.leg==='stop').at(-1);
    if (latest && ['rejected','expired','replaced','canceled'].includes(latest.order.status) && remaining>0) throw new OptionActionReview('Protective stop is not active; inspect Alpaca');
    await save({status:remaining===0 ? 'closed' : latest && !final.has(latest.order.status) ? 'protected' : 'managed',last_error:null});
    return;
  }
  action.execution ??={};
  action.status='processing';
  await write(action);
  await save({status:'management_pending'});
  if (plan.expiration<marketDate(now()) && remaining>0) throw new OptionActionReview('Contract expired; inspect broker exercise/position state');

  // A managed position must be exclusive. Do not cancel another strategy's orders.
  const open=await deps.broker(`/v2/orders?status=open&symbols=${encodeURIComponent(plan.symbol)}&limit=500`);
  if (!Array.isArray(open) || open.length>=500) throw new OptionActionReview('Unable to verify all open orders for the contract');
  const owned=new Set([...originals,...recorded.map(x=>x.order)].map(o=>o.id));
  if (open.some(o=>o.symbol===plan.symbol && !owned.has(o.id))) throw new OptionActionReview('Unmanaged order exists for this contract; manual review required');

  // Cancel outstanding entry quantities, target, and previous protective stops.
  // Never cancel this action's new sale/stop while reconciling its fills.
  const cancel=[...originals,...recorded.filter(x=>x.leg==='stop' && x.action.id!==action.id).map(x=>x.order)]
    .filter(o=>!final.has(o.status));
  if (cancel.length) {
    for (const order of cancel) {
      try { await deps.broker(`/v2/orders/${encodeURIComponent(order.id)}`,undefined,'DELETE'); }
      catch(error:any) { if (![404,422].includes(error.status)) throw error; }
    }
    return; // Even HTTP 204 is only a cancellation request; confirm terminal state.
  }
  if (recorded.some(x=>x.leg==='sale' && x.action.id!==action.id && !final.has(x.order.status))) return;

  let position:any;
  try { position=await deps.broker(`/v2/positions/${encodeURIComponent(plan.symbol)}`); }
  catch(error:any) { if(error.status!==404) throw error; position={qty:0,qty_available:0}; }
  if (amount(position.qty)!==remaining) throw new OptionActionReview('Broker position differs from managed fills; manual review required');

  if (!action.execution.decision) {
    const signal=action.instruction;
    let milestones=Number(management.milestones || 0);
    let high=Number(management.high_target || 0);
    if (signal.action==='target_reached' && Number(signal.reference_price)>high) {
      milestones=Math.min(2,signal.target_number ? Math.max(milestones,signal.target_number) : milestones+1);
      high=Number(signal.reference_price);
    }
    const desired=signal.action==='close_all' ? filled : Math.min(Math.max(0,filled-1),milestones);
    action.execution.decision={desired_total:desired,milestones,high_target:high,
      stop_price:Math.max(Number(management.stop_price || 0),Number(signal.stop_price || 0)) || null};
    await write(action); // Freeze sizing and prices before attempting an order.
  }
  const decision=action.execution.decision;
  const need=Math.max(0,decision.desired_total-sold);
  async function submit(leg:'sale'|'stop', payload:any) {
    if (action.execution[leg]) return;
    action.execution[leg]={payload,attempted_at:now().toISOString()};
    await write(action);
    try {
      const order=await deps.broker('/v2/orders',payload,'POST');
      if (!sameOrder(order,payload)) throw new OptionActionReview('Broker submission returned a different order');
      Object.assign(action.execution[leg],{order_id:order.id,status:order.status,filled_qty:amount(order.filled_qty)});
      await write(action);
    } catch(error:any) {
      // A timeout or duplicate rejection is resolved by client ID on the next poll.
      action.last_error=error.message; await write(action);
    }
  }
  const sale=action.execution.sale;
  if (sale) {
    if (!final.has(sale.status)) return;
    if (sale.status!=='filled' || amount(sale.filled_qty)!==amount(sale.payload.qty)) throw new OptionActionReview('Exit order did not fully fill; manual recovery required');
  } else if (need>0) {
    if (amount(position.qty_available ?? position.qty)<need) return;
    await submit('sale',{symbol:plan.symbol,qty:String(need),side:'sell',position_intent:'sell_to_close',type:'market',time_in_force:'day',client_order_id:`oa-${action.id}-x`});
    return;
  }
  // Keep protection broker-side. Each new action cancels the prior stop first.
  // Stops cover all remaining contracts; no concurrent limit target is recreated.
  if (remaining>0 && decision.stop_price && action.instruction.action!=='close_all') {
    const stop=action.execution.stop;
    if (!stop) {
      if(amount(position.qty_available ?? position.qty)<remaining) return;
      await submit('stop',{symbol:plan.symbol,qty:String(remaining),side:'sell',position_intent:'sell_to_close',type:'stop',stop_price:Number(decision.stop_price).toFixed(2),time_in_force:'gtc',client_order_id:`oa-${action.id}-s`});
      return;
    }
    if (['rejected','expired','canceled','replaced'].includes(stop.status)) throw new OptionActionReview('Protective stop was not accepted; manual review required');
    if (!stop.order_id || !['new','accepted','partially_filled','filled'].includes(stop.status)) return;
  }
  action.status='completed'; action.last_error=null; await write(action);
  await save({management:{...management,milestones:decision.milestones,high_target:decision.high_target,stop_price:decision.stop_price},
    status:remaining===0?'closed':decision.stop_price?'protected':'managed',last_error:null});
}
