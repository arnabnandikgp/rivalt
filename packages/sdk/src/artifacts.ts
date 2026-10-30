import {address,getAddressDecoder,getAddressEncoder,getProgramDerivedAddress,type Address} from '@solana/kit';
import {fromBase64,hex,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

const LOADER=address('BPFLoaderUpgradeab1e11111111111111111111111');
export type Artifact=Readonly<{name:string;program:Address;bytes:number;sha256:string}>;
type Verified={header:string;space:number;finalizedContext:bigint};

/** Pin executable bytes, loader identity, padding and the local deployment
 * authority. Cache only a full finalized read strictly after deployment's slot.
 * A later loader upgrade must then have a different slot; same-slot unfinalized
 * code never enters this cache. Authority/size/pointer changes also invalidate it. */
export class ArtifactVerifier {
  private readonly verified=new Map<Address,Verified>();
  private readonly identities;
  // Explicit artifacts are a low-level test seam; all live clients use the fixed
  // explicit qualified set. Neither HTTP nor public deployment config accepts hashes.
  constructor(private readonly rpc:Pick<UserRpc,'call'>,private readonly artifacts:readonly Artifact[]){
    this.identities=Promise.all(artifacts.map(async artifact=>({...artifact,programData:(await getProgramDerivedAddress({
      programAddress:LOADER,seeds:[getAddressEncoder().encode(artifact.program)]}))[0]})));
  }
  async verify(authority:Address){
    const identities=await this.identities,keys=identities.flatMap(identity=>[identity.program,identity.programData]);
    const observed=await this.rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'confirmed',dataSlice:{offset:0,length:45}}]);
    requireValue(Array.isArray(observed.value)&&observed.value.length===keys.length,'Incomplete deployment identities.');
    const context=rpcInteger(observed.context.slot),missing:typeof identities=[];
    identities.forEach((identity,index)=>{
      const program=observed.value[index*2],data=observed.value[index*2+1];
      const programBytes=this.bytes(program),header=this.header(data,authority);
      requireValue(program.executable===true&&programBytes.length===36&&new DataView(programBytes.buffer,programBytes.byteOffset).getUint32(0,true)===2&&
        getAddressDecoder().decode(programBytes.slice(4))===identity.programData,'Wrong executable binding.');
      const cached=this.verified.get(identity.programData);
      if(cached&&cached.header===hex(header)&&cached.space===data.space){
        requireValue(context>=cached.finalizedContext,'Deployment RPC predates verified finality.');
      }else missing.push(identity);
    });
    if(!missing.length)return;
    // Read finalized code first. A concurrently observed upgrade is verified
    // separately at confirmed and cannot be cached before its own finality.
    const finalized=await this.rpc.call('getMultipleAccounts',[missing.map(identity=>identity.programData),{encoding:'base64',commitment:'finalized'}]);
    requireValue(finalized.value?.length===missing.length,'Incomplete finalized code.');
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
    requireValue(account?.owner===LOADER&&account.data?.[1]==='base64','Foreign or missing executable account.');
    return fromBase64(account.data[0]);
  }
  private header(account:any,authority:Address){
    const bytes=this.bytes(account),header=bytes.slice(0,45);
    requireValue(account.executable===false&&header.length===45&&new DataView(header.buffer,header.byteOffset).getUint32(0,true)===3&&
      header[12]===1&&getAddressDecoder().decode(header.slice(13,45))===authority,'Wrong ProgramData authority/header.');
    return header;
  }
  private async code(identity:Artifact,account:any,authority:Address){
    const header=this.header(account,authority),bytes=this.bytes(account);
    requireValue(bytes.length>=45+identity.bytes&&bytes.length<=45+identity.bytes*2&&bytes.slice(45+identity.bytes).every(value=>value===0),
      'Wrong program length/padding.');
    const hash=hex(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.slice(45,45+identity.bytes))));
    requireValue(hash===identity.sha256,`Unqualified ${identity.name} artifact.`);
    return new DataView(header.buffer,header.byteOffset).getBigUint64(4,true);
  }
}
