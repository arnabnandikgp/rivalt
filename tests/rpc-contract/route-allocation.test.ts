import assert from 'node:assert/strict';
import { it } from 'vitest';
import * as sdk from '@rivalt/sdk';
import { makerAddresses } from './maker-cases.js';

// Independent comparator: enumerate each marginal lot, accumulate prefix arrays,
// and evaluate every legal integer partition with a separate cash/loss equation.
function oracle(input:Parameters<typeof sdk.allocateRoute>[0]) {
  const abs=(x:bigint)=>x<0n?-x:x,scale=1_000_000_000n;
  const health=(p:sdk.RouteBalance,delta:bigint,virtual:bigint,fee=0n)=> {
    const q=p.lots+delta,v=p.virtualScaled+virtual;
    const loss=-(q*(q<0n?input.upper:input.lower)*scale+v);
    const cash=(p.cash-fee)*scale;
    return cash>=(loss>0n?loss:0n)+((abs(q)*input.upper+9n)/10n+p.reserved)*scale;
  };
  const sorted=[...input.candidates].sort((a,b)=>a.state.makerId-b.state.makerId);
  const tables=sorted.map(c=> {
    const id=c.state.makerId,r=c.request,depth=id===0?512n:4096n,table=[0n];
    const cap=[depth-r.consumed,r.inventoryLimit+(input.side===0?r.inventory:-r.inventory),r.cash*10n/r.referencePrice-abs(r.inventory)].reduce((x,y)=>x<y?x:y);
    for(let k=0n;k<cap;k++) {
      const index=r.consumed+k,offset=id===0?10n+index:30n+(index>256n?index-256n:0n);
      const center=r.referencePrice-(id===0?r.inventory/64n*4n:r.inventory/256n);
      const marginal=input.side===0?center+offset:center-offset;
      if(marginal<1n||marginal>1_000_000n)break;
      table.push(table.at(-1)!+marginal);
    }
    return table;
  });
  let best:{allIn:bigint;grossQuote:bigint;fee:bigint;legs:{makerId:number;lots:bigint;grossQuote:bigint}[]}|null=null;
  for(let n=0n;n<=input.lots;n++) {
    const amounts=sorted.length===1?[input.lots]:[n,input.lots-n];
    if(sorted.length===1&&n!==0n)break;
    let total=0n,valid=true;const legs=[];
    for(let i=0;i<sorted.length;i++) {
      const qty=amounts[i];if(!qty)continue;
      const c=sorted[i],quote=tables[i][Number(qty)];
      if(quote===undefined){valid=false;break;}
      const sign=input.side===0?-1n:1n;
      if(quote*10n<qty*c.request.referencePrice*9n||quote*10n>qty*c.request.referencePrice*11n||
        abs(c.balance.lots+sign*qty)>c.request.inventoryLimit||!health(c.balance,sign*qty,-sign*quote*scale)){valid=false;break;}
      total+=quote;legs.push({makerId:c.state.makerId,lots:qty,grossQuote:quote});
    }
    const fee=(total+4999n)/5000n,allIn=input.side===0?total+fee:total-fee,sign=input.side===0?1n:-1n;
    if(!valid||total<1000n||fee>input.maxFee||!health(input.trader,sign*input.lots,-sign*total*scale,fee)||
      (input.side===0?allIn>input.allInLimit:allIn<input.allInLimit))continue;
    if(!best||(input.side===0?allIn<best.allIn:allIn>best.allIn)||(allIn===best.allIn&&
      (legs.length<best.legs.length||(legs.length===best.legs.length&&(legs[0].makerId<best.legs[0].makerId||
        (legs[0].makerId===best.legs[0].makerId&&legs[0].lots>best.legs[0].lots))))))best={allIn,grossQuote:total,fee,legs};
  }
  return best;
}

it('finds beneficial/required splits and matches 600 independently enumerated, health-filtered optima',async()=>{
  const addresses=await Promise.all([0,1].map(makerAddresses)),domain=new Uint8Array(32).fill(3);
  let seed=0x504f34524f555445n;
  function random(){seed=(seed*6364136223846793005n+1n)&((1n<<64n)-1n);return seed;}
  const make=(side:number,id:number,inventory=0n,cash=500_000_000n,consumed=0n):sdk.RouteCandidate=>({
    state:{version:1,makerId:id,owner:addresses[id].owner.address,market:addresses[id].market,capital:addresses[id].capital,domain,quoteEpoch:1n,startSlot:100n,expirySlot:3600n,bump:1},
    request:{version:1,domain,market:addresses[id].market,capital:addresses[id].capital,quoteEpoch:1n,authorityEpoch:1n,termsEpoch:1n,marketConfigEpoch:1n,side,lots:1n,inventory,cash,inventoryLimit:100_000n,consumed,referencePrice:60_000n,slot:100n},
    balance:{id:id+1,cash,lots:inventory,virtualScaled:-inventory*60_000n*1_000_000_000n,reserved:0n},
  });
  const base={snapshotSlot:100n,side:0,lots:100n,lower:59_400n,upper:60_600n,trader:{id:0,cash:100_000_000n,lots:0n,virtualScaled:0n,reserved:0n},candidates:[make(0,0),make(0,1)],grossLots:0n,maxFee:1_000_000n,allInLimit:1_000_000_000n};
  const good=sdk.allocateRoute(base)!;assert.equal(good.grossQuote,6_002_790n);assert.equal(good.legs.length,2);
  assert.equal(sdk.allocateRoute({...base,lots:4097n})!.legs.length,2);
  assert.equal(sdk.allocateRoute({...base,lots:4608n})!.lots,4608n);
  assert.equal(sdk.allocateRoute({...base,lots:4097n,candidates:[make(0,1)]}),null);
  assert.throws(()=>sdk.allocateRoute({...base,candidates:[make(0,0),make(0,0)]}),/binding/);
  assert.throws(()=>sdk.allocateRoute({...base,candidates:[make(1,0)]}),/binding/);
  assert.equal(sdk.allocateRoute({...base,maxFee:0n}),null);
  for(let i=0;i<600;i++) {
    const side=Number(random()%2n),lots=1n+random()%4608n;
    const candidates=[0,1].map(id=>make(side,id,random()%801n-400n,1n+random()%60_000_000n,random()%(id===0?512n:4096n)));
    const trader={...base.trader,cash:random()%60_000_000n,virtualScaled:(random()%2_000_001n-1_000_000n)*1_000_000_000n};
    const input={...base,side,lots,candidates,trader,grossLots:candidates.reduce((n,c)=>n+(c.balance.lots<0n?-c.balance.lots:c.balance.lots),0n),allInLimit:side===0?1_000_000_000n:0n};
    const actual=sdk.allocateRoute(input),expected=oracle(input);
    assert.deepEqual(actual&&{allIn:actual.allIn,grossQuote:actual.grossQuote,fee:actual.fee,legs:actual.legs},expected,`vector ${i}`);
    assert.deepEqual(sdk.allocateRoute({...input,candidates:[...candidates].reverse()}),actual,`candidate-order invariance ${i}`);
  }
});
