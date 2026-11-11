import {AccountRole,type Address,type Decoder,type ReadonlyUint8Array} from '@solana/kit';
import * as protocol from './generated/index.js';
import {deriveAccountPortfolio,deriveCapitalBinding,deriveMarginAccount,deriveMemberIndex,deriveMemberPage,deriveMemberPath,
  deriveRecoveryStorage,deriveVenueComponent} from './account-addresses.js';
import {fromBase64,hex,requireValue,rpcInteger,type UserRpc} from './wallet-client.js';

export const ACCOUNT_SCHEMA=10;
export const ACCOUNT_PROFILE=6;
export const MEMBER_REGISTERED=1;
export const MEMBER_FINANCIAL=2;
export const MEMBER_RETIRED=3;

export function decodeMembershipAccount<T>(raw:any,discriminator:ReadonlyUint8Array,decoder:Decoder<T>&{fixedSize:number}):T {
  requireValue(raw?.owner===protocol.CLEARING_PROGRAM_ADDRESS&&!raw.executable&&raw.data?.[1]==='base64','Missing or foreign membership account.');
  const bytes=fromBase64(raw.data[0]);
  requireValue(bytes.length===decoder.fixedSize&&hex(bytes.slice(0,8))===hex(discriminator),'Wrong membership account layout.');
  return decoder.decode(bytes);
}
export async function readMembershipRegistry(rpc:Pick<UserRpc,'call'>,venue:Address) {
  const [registry,bump]=await deriveVenueComponent(venue,'registry'),[liveIndex]=await deriveMemberIndex(venue,14,0n);
  const response=await rpc.call('getAccountInfo',[registry,{encoding:'base64',commitment:'finalized'}]);
  const state=decodeMembershipAccount(response.value,protocol.VENUE_REGISTRY_DISCRIMINATOR,protocol.getVenueRegistryDecoder());
  requireValue(state.schemaVersion===ACCOUNT_SCHEMA&&state.venue===venue&&state.bump===bump&&state.liveIndex===liveIndex
    &&state.revision>0n&&state.membershipEpoch>0n&&state.financialCount<=state.registeredCount&&state.registeredCount<=state.nextId,
    'Invalid membership registry.');
  return {registry,state,contextSlot:rpcInteger(response.context.slot)};
}

/** One coherent bounded RPC snapshot for an owner membership transition. It
 * provides optimistic revision guards, never a replacement for landed admission. */
export async function readMarginMembership(rpc:Pick<UserRpc,'call'>,venue:Address,owner:Address,margin:Address,financialPath=true) {
  const discovery=await rpc.call('getAccountInfo',[margin,{encoding:'base64',commitment:'finalized'}]);
  const discovered=decodeMembershipAccount(discovery.value,protocol.MARGIN_ACCOUNT_DISCRIMINATOR,protocol.getMarginAccountDecoder());
  const [registryPda,safetyPda,membersPda,storagePda,bindingPda,path]=await Promise.all([
    deriveVenueComponent(venue,'registry'),deriveVenueComponent(venue,'safety'),deriveMemberPage(venue,discovered.id/64n),
    deriveRecoveryStorage(venue),deriveCapitalBinding(margin),deriveMemberPath(venue,discovered.id)]);
  const keys=[margin,discovered.portfolio,registryPda[0],safetyPda[0],membersPda[0],storagePda[0],bindingPda[0],...(financialPath?path.map(([key])=>key):[])];
  requireValue(new Set(keys).size===keys.length,'Aliased membership dependencies.');
  const response=await rpc.call('getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized',minContextSlot:Number(rpcInteger(discovery.context.slot))}]);
  requireValue(response.value?.length===keys.length&&rpcInteger(response.context.slot)>=rpcInteger(discovery.context.slot),'Incomplete membership snapshot.');
  const decode=<T>(index:number,tag:ReadonlyUint8Array,decoder:Decoder<T>&{fixedSize:number})=>decodeMembershipAccount(response.value[index],tag,decoder);
  const root=decode(0,protocol.MARGIN_ACCOUNT_DISCRIMINATOR,protocol.getMarginAccountDecoder());
  const portfolio=decode(1,protocol.PORTFOLIO_DISCRIMINATOR,protocol.getPortfolioDecoder());
  const registry=decode(2,protocol.VENUE_REGISTRY_DISCRIMINATOR,protocol.getVenueRegistryDecoder());
  const safety=decode(3,protocol.VENUE_SAFETY_DISCRIMINATOR,protocol.getVenueSafetyDecoder());
  const members=decode(4,protocol.MEMBER_PAGE_DISCRIMINATOR,protocol.getMemberPageDecoder());
  const storage=financialPath?decode(5,protocol.RECOVERY_STORAGE_DISCRIMINATOR,protocol.getRecoveryStorageDecoder()):null;
  const [canonical,rootBump]=await deriveMarginAccount(root.portfolio,root.subaccountIndex);
  const [portfolioKey,portfolioBump]=await deriveAccountPortfolio(venue,owner,portfolio.index);
  requireValue(canonical===margin&&root.bump===rootBump&&root.id===discovered.id&&root.portfolio===discovered.portfolio
    &&root.owner===owner&&portfolioKey===root.portfolio&&portfolio.owner===owner&&portfolio.bump===portfolioBump&&portfolio.activeChildren>0,
    'Wrong membership owner/root identity.');
  for(const state of [root,portfolio,registry,safety,members,...(storage?[storage]:[])])requireValue(state.schemaVersion===ACCOUNT_SCHEMA&&state.venue===venue&&state.revision>0n,'Membership domain mismatch.');
  requireValue(registry.bump===registryPda[1]&&registry.liveIndex===path[14][0]&&registry.membershipEpoch>0n
    &&registry.financialCount<=registry.registeredCount&&registry.registeredCount<=registry.nextId&&root.id<registry.nextId
    &&safety.bump===safetyPda[1]&&members.bump===membersPda[1]&&members.pageIndex===root.id/64n&&(!storage||storage.bump===storagePda[1]),
    'Invalid membership header.');
  const bit=1n<<(root.id%64n),entry=members.members.entries[Number(root.id%64n)];
  requireValue((members.allocatedMask&bit)!==0n&&entry.root===margin&&entry.lifecycle===root.lifecycle&&entry.activationGeneration===root.activationGeneration
    &&[MEMBER_REGISTERED,MEMBER_FINANCIAL].includes(root.lifecycle)&&((members.financialMask&bit)!==0n)===(root.lifecycle===MEMBER_FINANCIAL),
    'Membership slot mismatch.');
  const binding=response.value[6];
  requireValue(binding===null||(binding.owner==='11111111111111111111111111111111'&&!binding.executable&&binding.data?.[1]==='base64'
    &&fromBase64(binding.data[0]).length===0),'Maker binding must be retired before membership exit.');
  let expected=BigInt(Array.from({length:64},(_,slot)=>Number((members.financialMask>>BigInt(slot))&1n)).reduce((sum,value)=>sum+value,0));
  const nodes=(financialPath?path:[]).map(([key,bump],level)=>{
    const node=decode(7+level,protocol.MEMBER_INDEX_NODE_DISCRIMINATOR,protocol.getMemberIndexNodeDecoder());
    const prefix=(root.id/64n)>>BigInt(4*(level+1)),slot=Number(((root.id/64n)>>BigInt(4*level))&15n);
    const mask=node.counts.reduce((mask,count,index)=>count>0n?mask|(1<<index):mask,0);
    requireValue(node.schemaVersion===ACCOUNT_SCHEMA&&node.revision>0n&&node.venue===venue&&node.bump===bump&&node.level===level
      &&node.prefix===prefix&&node.populatedMask===mask&&node.counts[slot]===expected,'Invalid financial index path.');
    expected=node.counts.reduce((sum,count)=>sum+count,0n);return {key,state:node};
  });
  if(financialPath)requireValue(expected===registry.financialCount,'Incomplete financial index.');
  return {margin,root,portfolio:root.portfolio,registry:registryPda[0],registryState:registry,safety:safetyPda[0],safetyState:safety,
    members:membersPda[0],membersState:members,storage:storagePda[0],storageState:storage,binding:bindingPda[0],
    revision:root.revision,membershipEpoch:registry.membershipEpoch,safetyEpoch:safety.epoch,indexRevisions:nodes.map(node=>node.state.revision),
    remaining:nodes.map(node=>({address:node.key,role:AccountRole.WRITABLE})),contextSlot:rpcInteger(response.context.slot)};
}
