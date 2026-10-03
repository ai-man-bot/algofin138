import assert from 'node:assert/strict';
import {parseWebhookSignal,signalExecutionGap} from '../src/utils/webhookSignal.ts';
import {parseOptionMessage,isOptionMessagePayload} from '../src/utils/optionWebhook.ts';
import {matchOptionSignalPlan} from '../supabase/functions/webhook-listener/option_signal_store.ts';

const now=new Date('2026-10-02T15:00:00Z');
const entries=[
  'WULF 20C 1/15/27: BTO Buy To Open at 1.10 with first target above 1.26',
  'WULF: 20C 01/15/2027: BTOBuy To Open at 1.10 with the first target above 1.26',
  'wulf 20c 1/15/27: bto at $1.10 with first target at $1.26!',
];
for(const text of entries) assert.equal(parseOptionMessage(text,now).symbol,'WULF270115C00020000');
assert.equal(parseOptionMessage('VFC 14.5C 10/16: BTOBuy To Open at 0.54 with first target above 0.62',now).strike,14.5);
assert.throws(()=>parseOptionMessage(entries[0].replace('1/15/27','1/15/26'),now),/passed/);
assert.throws(()=>parseOptionMessage(entries[0].replace('1/15/27','2/29/27'),now),/Invalid expiration/);
assert.throws(()=>parseWebhookSignal(entries[0]+' sell all'),/Expected/);
assert.throws(()=>parseWebhookSignal(entries[0].replace('1.10','0')),/positive price/);
const closes=[
  ['AAPL 335C 10/09 : STC Close the trade at 2.40!','signal'],
  ['GOOGL 360C 11/20 : STC Close the trade as it hit trailing stop at 10.35!','trailing_stop'],
  ['PURR: STCClose the trade as it hit stop at 11.88!','stop'],
];
for(const [text,reason] of closes) { const s=parseWebhookSignal(text);assert.equal(s.action,'close_all');assert.equal(s.close_reason,reason); }
const target=parseWebhookSignal("WULF 20C 01/15 : STCReached Target 1.27 and that's 15.45%! Lock some in and wait for next target. Raise the stops to 0.89");
assert.equal(target.action,'target_reached');assert.equal(target.stop_price,'0.89');assert.equal(target.year,undefined);
assert.equal(parseWebhookSignal('MSTR: STC Reached SellTarget1 @159.7. Take profits and ride the runners. Gain: 3.55%').target_number,1);
for(const text of ['PURR 20C 12/18: DCAAdd more at 0.71 for dollar cost averaging.','AAPL 335C 10/2: DCA Add more at 1.57 for dollar cost averaging.']) {
  const s=parseWebhookSignal(text);assert.equal(s.action,'add');assert.match(signalExecutionGap(s)!,/DCA/);
}
assert.match(signalExecutionGap(parseWebhookSignal('U: BTO Buy To Open at 40.18 with first target above 40.98'))!,/equity/);
assert.match(signalExecutionGap(parseWebhookSignal('RBLX 50P 10/16: STC'))!,/Needs review/);
assert.equal(signalExecutionGap(target),null);
assert.throws(()=>parseWebhookSignal('malformed'),/Expected/);
assert.throws(()=>parseWebhookSignal('AAPL 335C 10/09: STC close at 2.40 or buy at 3'),/Expected/);
assert.equal(isOptionMessagePayload({symbol:'AAPL',message:'AAPL: STCClose the trade at 2.40!',qty:1}),true);
const plan={id:'one',underlying:'WULF',strike:20,option_type:'call',expiration:'2027-01-15',status:'first_target_filled'};
assert.equal(matchOptionSignalPlan([plan],target,now).id,'one');
assert.throws(()=>matchOptionSignalPlan([plan,{...plan,id:'two',expiration:'2028-01-15'}],target,now),/Ambiguous/);
assert.equal(matchOptionSignalPlan([plan,{...plan,id:'two',expiration:'2028-01-15'}],{...target,year:2027},now).id,'one');
assert.throws(()=>matchOptionSignalPlan([{...plan,expiration:'2026-01-15'}],target,now),/No matching/);
console.log('Observed webhook formats, date validation, action routing, and trade matching passed');
