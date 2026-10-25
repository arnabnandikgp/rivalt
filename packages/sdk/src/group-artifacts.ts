import {address,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type Address} from '@solana/kit';
import {CLEARING_PROGRAM_ADDRESS} from './generated/index.js';
import {MAKER_A_PROGRAM_ADDRESS} from './generatedMakerA/index.js';
import {MAKER_B_PROGRAM_ADDRESS} from './generatedMakerB/index.js';
import {fromBase64,hex,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

export const GROUP_ARTIFACT_SET='p20-qualified-local-v1';
export const GROUP_ARTIFACTS=Object.freeze([
  {name:'clearing',program:CLEARING_PROGRAM_ADDRESS,bytes:2_480_048,sha256:'dce212e4c03c847eb47bf6873c29b5652098824b9eeb51f30f0a40c65a6b28a7'},
  {name:'maker-a',program:MAKER_A_PROGRAM_ADDRESS,bytes:252_760,sha256:'2120f7fa2d5a15304197ff296bd5dda01e5b6df1da33219eff8396887ccecd03'},
  {name:'maker-b',program:MAKER_B_PROGRAM_ADDRESS,bytes:252_824,sha256:'8beb63928f2b9428b8ae6eb307ec7b39f8b362e35f61fe53be01eb65c8b8a0e8'},
  {name:'oracle-fixture',program:address('A5ACpHNQHLkCQtfvRkPoR45juvuxwfi9mEWGU43eD5nj'),bytes:151_608,sha256:'d8996b99368c7edf94a812d0c58bac4bf43471d4dbbb943ec610d839769b57c4'},
].map(artifact=>Object.freeze(artifact)));
const LOADER=address('BPFLoaderUpgradeab1e11111111111111111111111');
type Artifact=typeof GROUP_ARTIFACTS[number];
type Verified={header:string;space:number;finalizedContext:bigint};

/** Pin executable bytes, loader identity, padding and the local deployment
 * authority. Cache only a full finalized read strictly after deployment's slot.
 * A later loader upgrade must then have a different slot; same-slot unfinalized
 * code never enters this cache. Authority/size/pointer changes also invalidate it. */
export class GroupArtifactVerifier {
  private readonly verified=new Map<Address,Verified>();
  private readonly identities;
  // Explicit artifacts are a low-level test seam; all live clients use the fixed
  // qualified set above. Neither HTTP nor public deployment config accepts hashes.
  constructor(private readonly rpc:Pick<UserRpc,'call'>,private readonly artifacts:readonly Artifact[]=GROUP_ARTIFACTS){
    this.identities=Promise.all(artifacts.map(async artifact=>({...artifact,programData:(await getProgramDerivedAddress({
      programAddress:LOADER,seeds:[getAddressEncoder().encode(artifact.program)]}))[0]})));
  }
  async verify(authority:Address){
    const identities=await this.identities,keys=identities.flatMap(identity=>[identity.program,identity.programData]);
    const observed=await this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:45}}]);
    requireValue(Array.isArray(observed.value)&&observed.value.length===keys.length,'Incomplete group deployment identities.');
    const context=rpcInteger(observed.context.slot),missing:typeof identities=[];
    identities.forEach((identity,index)=>{
      const program=observed.value[index*2],data=observed.value[index*2+1];
      const programBytes=this.bytes(program),header=this.header(data,authority);
      requireValue(program.executable===true&&programBytes.length===36&&new DataView(programBytes.buffer,programBytes.byteOffset).getUint32(0,true)===2&&
        getAddressDecoder().decode(programBytes.slice(4))===identity.programData,'Wrong group executable binding.');
      const cached=this.verified.get(identity.programData);
      if(cached&&cached.header===hex(header)&&cached.space===data.space){
        requireValue(context>=cached.finalizedContext,'Group deployment RPC predates verified finality.');
      }else missing.push(identity);
    });
    if(!missing.length)return;
    // Read finalized code first. A concurrently observed upgrade is verified
    // separately at confirmed and cannot be cached before its own finality.
    const finalized=await this.rpc.call('getMultipleAccounts',[missing.map(identity=>identity.programData),{encoding:'base64',commitment:'finalized'}]);
    requireValue(finalized.value?.length===missing.length,'Incomplete finalized group code.');
    const finalizedContext=rpcInteger(finalized.context.slot);
    for(const [index,identity] of missing.entries()){
      const current=observed.value[keys.indexOf(identity.programData)],account=finalized.value[index];
      if(account?.data?.[1]==='base64'&&hex(fromBase64(account.data[0]).slice(0,45))===hex(fromBase64(current.data[0]))&&
        (current.space===undefined||current.space===account.space)){
        const deploymentSlot=await this.code(identity,account,authority);
        if(Number.isSafeInteger(account.space)&&account.space===fromBase64(account.data[0]).length&&finalizedContext>deploymentSlot)
          this.verified.set(identity.programData,{header:hex(fromBase64(account.data[0]).slice(0,45)),space:account.space,finalizedContext});
      }else{
        const latest=await this.rpc.call('getAccountInfo',[identity.programData,{encoding:'base64',commitment:'confirmed'}]);
        await this.code(identity,latest.value,authority);this.verified.delete(identity.programData);
      }
    }
  }
  private bytes(account:any){
    requireValue(account?.owner===LOADER&&account.data?.[1]==='base64','Foreign or missing group executable account.');
    return fromBase64(account.data[0]);
  }
  private header(account:any,authority:Address){
    const bytes=this.bytes(account),header=bytes.slice(0,45);
    requireValue(account.executable===false&&header.length===45&&new DataView(header.buffer,header.byteOffset).getUint32(0,true)===3&&
      header[12]===1&&getAddressDecoder().decode(header.slice(13,45))===authority,'Wrong group ProgramData authority/header.');
    return header;
  }
  private async code(identity:Artifact,account:any,authority:Address){
    const header=this.header(account,authority),bytes=this.bytes(account);
    requireValue(bytes.length>=45+identity.bytes&&bytes.length<=45+identity.bytes*2&&bytes.slice(45+identity.bytes).every(value=>value===0),
      'Wrong group program length/padding.');
    const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice(45,45+identity.bytes))));
    requireValue(hash===identity.sha256,`Unqualified group ${identity.name} artifact.`);
    return new DataView(header.buffer,header.byteOffset).getBigUint64(4,true);
  }
}
