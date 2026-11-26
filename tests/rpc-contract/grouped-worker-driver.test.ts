import {expect,it} from 'vitest';
import {verifyWorkerExpiry} from './grouped-worker-driver.js';

it('accepts proven expiry only with no receipt, no observed landing and no recorded financial effect',async()=>{
  const row={request_id:'keeper:gain:1',signature:'original',status:'expired-unexecuted',
    result:{slot:'123',economicEffect:'not-applied',fee:null}};
  const absent={call:async()=>({value:[null]})};
  await expect(verifyWorkerExpiry(row,null,absent)).resolves.toEqual({id:row.request_id,signature:'original',proofSlot:'123'});
  await expect(verifyWorkerExpiry({...row,result:null},null,absent)).rejects.toThrow();
  await expect(verifyWorkerExpiry(row,{meta:{err:null}},absent)).rejects.toThrow(/finalized receipt/);
  await expect(verifyWorkerExpiry(row,null,{call:async()=>({value:[{confirmationStatus:'confirmed'}]})})).rejects.toThrow(/observed landing/);
});
