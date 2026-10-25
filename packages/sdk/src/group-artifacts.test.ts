import {createHash} from 'node:crypto';
import {address,getAddressEncoder,getProgramDerivedAddress} from '@solana/kit';
import {expect,it} from 'vitest';
import {GroupArtifactVerifier} from './group-artifacts.js';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';

const loader=address('BPFLoaderUpgradeab1e11111111111111111111111'),authority=address('11111111111111111111111111111111');
async function fixture(){
  const [programData]=await getProgramDerivedAddress({programAddress:loader,seeds:[getAddressEncoder().encode(CLEARING_PROGRAM_ADDRESS)]});
  const code=Uint8Array.of(127,69,76,70,1,2,3,4),data=new Uint8Array(45+code.length+8),view=new DataView(data.buffer);
  view.setUint32(0,3,true);view.setBigUint64(4,10n,true);data[12]=1;data.set(getAddressEncoder().encode(authority),13);data.set(code,45);
  const program=new Uint8Array(36);new DataView(program.buffer).setUint32(0,2,true);program.set(getAddressEncoder().encode(programData),4);
  const account=(bytes:Uint8Array,executable=false)=>({owner:loader,executable,space:bytes.length,data:[Buffer.from(bytes).toString('base64'),'base64']});
  const current:any={[CLEARING_PROGRAM_ADDRESS]:account(program,true),[programData]:account(data)},finalized=structuredClone(current);
  let confirmedSlot=30,finalizedSlot=20;const calls:{method:string;params:any[]}[]=[];
  const rpc={async call(method:string,params:any[]=[]){
    calls.push({method,params});const options=params[1],state=options.commitment==='finalized'?finalized:current;
    const encode=(key:string)=>{const value=structuredClone(state[key]);if(options.dataSlice){const bytes=Buffer.from(value.data[0],'base64');value.data[0]=bytes.subarray(0,options.dataSlice.length).toString('base64');}return value;};
    return {context:{slot:options.commitment==='finalized'?finalizedSlot:confirmedSlot},value:method==='getMultipleAccounts'?params[0].map(encode):encode(params[0])};
  }};
  const verifier=new GroupArtifactVerifier(rpc,[{name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:code.length,sha256:createHash('sha256').update(code).digest('hex')}]);
  return {verifier,current,finalized,programData,data,account,calls,slots:(confirmed:number,final:number)=>{confirmedSlot=confirmed;finalizedSlot=final;}};
}
it('pins code and authority once finalized, then verifies observed loader headers without refetching binary payloads',async()=>{
  const {verifier,calls}=await fixture();await verifier.verify(authority);expect(calls).toHaveLength(2);
  await verifier.verify(authority);expect(calls).toHaveLength(3);expect(calls[2].params[1].dataSlice).toEqual({offset:0,length:45});
});
it('rejects a changed confirmed artifact even while finalized metadata still shows the previously qualified deployment',async()=>{
  const {verifier,current,programData,data,account}=await fixture();await verifier.verify(authority);
  new DataView(data.buffer).setBigUint64(4,21n,true);data[45]^=1;current[programData]=account(data);
  await expect(verifier.verify(authority)).rejects.toThrow(/Unqualified group clearing artifact/);
});
it('does not cache same-slot finalized code and catches another change before a later finalized context',async()=>{
  const {verifier,current,finalized,programData,data,account,slots,calls}=await fixture();slots(10,10);
  await verifier.verify(authority);data[45]^=1;current[programData]=account(data);finalized[programData]=account(data);
  await expect(verifier.verify(authority)).rejects.toThrow(/artifact/);expect(calls).toHaveLength(4);
});
it('checks executable pointers, loader ownership and authority before trusting cached identity',async()=>{
  for(const mutation of ['owner','authority','pointer','executable']){
    const {verifier,current,programData,data,account}=await fixture();await verifier.verify(authority);
    if(mutation==='owner')current[programData].owner=authority;
    if(mutation==='authority'){data[13]=1;current[programData]=account(data);}
    if(mutation==='pointer'){const bytes=Buffer.from(current[CLEARING_PROGRAM_ADDRESS].data[0],'base64');bytes[4]^=1;current[CLEARING_PROGRAM_ADDRESS]=account(bytes,true);}
    if(mutation==='executable')current[CLEARING_PROGRAM_ADDRESS].executable=false;
    await expect(verifier.verify(authority)).rejects.toThrow();
  }
});
it('rejects nonzero padding and changes to allocated program space',async()=>{
  const {verifier,current,finalized,programData,data,account}=await fixture();await verifier.verify(authority);
  const grown=new Uint8Array(data.length+1);grown.set(data);grown[grown.length-1]=1;
  current[programData]=account(grown);finalized[programData]=account(grown);
  await expect(verifier.verify(authority)).rejects.toThrow(/length\/padding/);
  const short=data.slice(0,47);current[programData]=account(short);finalized[programData]=account(short);
  await expect(verifier.verify(authority)).rejects.toThrow(/length\/padding/);
});
it('rejects a provider context older than the full finalized verification',async()=>{
  const {verifier,slots}=await fixture();await verifier.verify(authority);slots(19,20);
  await expect(verifier.verify(authority)).rejects.toThrow(/predates verified finality/);
});
it('rehashes an unfinalized identical-code upgrade and caches it only after later finality',async()=>{
  const {verifier,current,finalized,programData,data,account,calls,slots}=await fixture();await verifier.verify(authority);
  new DataView(data.buffer).setBigUint64(4,21n,true);current[programData]=account(data);
  await verifier.verify(authority);expect(calls.at(-1)?.method).toBe('getAccountInfo');
  await verifier.verify(authority);expect(calls.at(-1)?.method).toBe('getAccountInfo');
  finalized[programData]=account(data);slots(35,30);await verifier.verify(authority);const count=calls.length;
  await verifier.verify(authority);expect(calls.length).toBe(count+1);
});

it('rejects nonzero allocated padding even when the pinned ELF prefix is unchanged',async()=>{
  const {verifier,current,finalized,programData,data,account}=await fixture();
  data[data.length-1]=1;current[programData]=account(data);finalized[programData]=account(data);
  await expect(verifier.verify(authority)).rejects.toThrow(/length\/padding/);
});
