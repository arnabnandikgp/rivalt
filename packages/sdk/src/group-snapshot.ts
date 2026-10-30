import {address, type Address, type Decoder, type ReadonlyUint8Array} from '@solana/kit';
import {getMintDecoder, getTokenDecoder, TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import * as protocol from './generated/index.js';
import {findGroupMarketPda} from './group-addresses.js';
import {fromBase64, hex, requireValue, rpcInteger, type UserRpc} from './wallet-client.js';

export type GroupIdentity = {group:Address; mint:Address; domain:string};
export const GROUP_CLOCK = address('SysvarC1ock11111111111111111111111111111111');
const SYSVAR_OWNER = 'Sysvar1111111111111111111111111111111111111';

/** An account snapshot, separate from finalized journal history. Every additional
 * RPC chunk repeats the group bytes so concurrent group writes require a retry. */
export async function readGroupSnapshot(rpc: Pick<UserRpc,'call'>, identity:GroupIdentity,
  commitment:'confirmed'|'finalized'='finalized') {
  requireValue(['confirmed','finalized'].includes(commitment),'Unsupported group snapshot commitment.');
  requireValue(/^[0-9a-f]{64}$/.test(identity.domain),'Invalid group domain.');
  const group=identity.group;
  const [[canonicalGroup,groupBump],[registry,registryBump],[vault,vaultBump],[guard,guardBump],[resolution,resolutionBump],...marketPdas]=await Promise.all([
    protocol.findGroupPda({domain:Uint8Array.from(identity.domain.match(/../g)!, value=>parseInt(value,16))}),
    protocol.findInitializeGroupV2RegistryPda({group}),protocol.findClassifyGroupSurplusV2VaultPda({group}),
    protocol.findGroupExitGuardPda({group}),protocol.findGroupResolutionPda({group}),
    findGroupMarketPda(group,0),findGroupMarketPda(group,1),
  ]);
  requireValue(group===canonicalGroup,'Group PDA mismatch.');
  const accounts=new Map<Address,any>();
  let groupBytes:string|undefined, minSlot:bigint|undefined, maxSlot=0n;
  const read=async(keys:Address[])=>{
    for(let offset=0;offset<keys.length;offset+=99){
      const batch=[group,...keys.slice(offset,offset+99).filter(key=>key!==group)];
      const response=await rpc.call('getMultipleAccounts',[batch,{encoding:'base64',commitment}]);
      const slot=rpcInteger(response.context.slot);
      requireValue(Array.isArray(response.value)&&response.value.length===batch.length,'Invalid group RPC account count.');
      const current=response.value[0];
      requireValue(current?.owner===protocol.CLEARING_PROGRAM_ADDRESS&&current.data?.[1]==='base64','Missing or foreign group.');
      requireValue(groupBytes===undefined||groupBytes===current.data[0],'Group changed during snapshot; refresh.');
      groupBytes=current.data[0];minSlot=minSlot===undefined||slot<minSlot?slot:minSlot;maxSlot=slot>maxSlot?slot:maxSlot;
      batch.forEach((key,index)=>accounts.set(key,response.value[index]));
    }
  };
  const raw=(key:Address,owner:string=protocol.CLEARING_PROGRAM_ADDRESS)=>{
    const account=accounts.get(key);
    requireValue(account?.owner===owner&&account.data?.[1]==='base64','Missing or foreign group dependency.');
    return fromBase64(account.data[0]);
  };
  const decode=<Value>(key:Address,discriminator:ReadonlyUint8Array,decoder:Decoder<Value>):Value=>{
    const bytes=raw(key);
    requireValue(hex(bytes.slice(0,8))===hex(discriminator),'Wrong group account discriminator.');
    return decoder.decode(bytes);
  };
  await read([registry]);
  const initialRegistry=decode(registry,protocol.GROUP_REGISTRY_V2_DISCRIMINATOR,protocol.getGroupRegistryV2Decoder());
  requireValue(initialRegistry.schemaVersion===2&&initialRegistry.group===group&&initialRegistry.bump===registryBump&&
    initialRegistry.count===initialRegistry.members.length&&initialRegistry.count<=64&&new Set(initialRegistry.members).size===initialRegistry.count,'Invalid group registry.');
  const markets=marketPdas.map(([key])=>key);
  await read([GROUP_CLOCK,registry,vault,identity.mint,guard,resolution,...markets,...initialRegistry.members]);
  const state=decode(group,protocol.CLEARING_GROUP_V2_DISCRIMINATOR,protocol.getClearingGroupV2Decoder());
  requireValue(state.schemaVersion===2&&state.profileVersion===2&&state.marketCount===2&&[0,1,2,3].includes(state.mode)&&state.bump===groupBump&&state.vaultBump===vaultBump&&
    hex(state.domain)===identity.domain&&state.quoteMint===identity.mint&&state.vault===vault&&state.markets.every((key,index)=>key===markets[index]),'Group profile/identity mismatch.');
  const marketStates=markets.map((key,index)=>{
    const market=decode(key,protocol.GROUP_MARKET_V2_DISCRIMINATOR,protocol.getGroupMarketV2Decoder());
    requireValue(market.schemaVersion===2&&market.group===group&&market.index===index&&market.bump===marketPdas[index][1]&&
      market.lotsPerUnit===(index===0?1_000_000n:100_000n),'Invalid group market identity.');
    return market;
  });
  const members=initialRegistry.members, roots:Record<string,protocol.MarginAccountV2>={};
  for(const [index,key] of members.entries()){
    const root=decode(key,protocol.MARGIN_ACCOUNT_V2_DISCRIMINATOR,protocol.getMarginAccountV2Decoder());
    const [canonical,bump]=await protocol.findMarginPda({portfolio:root.portfolio,subaccountIndex:root.subaccountIndex});
    requireValue(root.schemaVersion===2&&root.group===group&&root.id===index&&key===canonical&&root.bump===bump&&
      root.subaccountIndex<=8&&[0,1,2].includes(root.role)&&
      (root.mode===0?root.subaccountIndex===0&&root.isolatedMarketIndex===255&&root.role!==1:
        root.mode===1&&root.subaccountIndex>0&&[0,1].includes(root.isolatedMarketIndex)),'Invalid margin identity.');
    if(root.mode===1){
      const unused=root.positions[1-root.isolatedMarketIndex];
      requireValue(unused.lots===0n&&unused.virtualScaled===0n&&unused.fundingCheckpointScaled===0n&&unused.generation===0n,'Foreign isolated position.');
    }
    roots[key]=root;
  }
  const portfolioKeys=[...new Set(Object.values(roots).map(root=>root.portfolio))];
  if(portfolioKeys.length)await read(portfolioKeys);
  const portfolios:Record<string,protocol.PortfolioV2>={};
  for(const key of portfolioKeys){
    const portfolio=decode(key,protocol.PORTFOLIO_V2_DISCRIMINATOR,protocol.getPortfolioV2Decoder());
    const [canonical,bump]=await protocol.findGroupPortfolioPda({group,owner:portfolio.owner,index:portfolio.index});
    requireValue(portfolio.schemaVersion===2&&portfolio.group===group&&portfolio.index<=3&&key===canonical&&portfolio.bump===bump,'Invalid portfolio identity.');
    const children=Object.values(roots).filter(root=>root.portfolio===key);
    requireValue(children.every(root=>root.owner===portfolio.owner)&&portfolio.children===children.reduce((bitmap,root)=>bitmap|(1<<root.subaccountIndex),0),'Portfolio membership mismatch.');
    portfolios[key]=portfolio;
  }
  const mint=getMintDecoder().decode(raw(identity.mint,TOKEN_PROGRAM_ADDRESS));
  requireValue(mint.isInitialized&&mint.decimals===6,'Unsupported group collateral mint.');
  const vaultBytes=raw(vault,TOKEN_PROGRAM_ADDRESS),token=getTokenDecoder().decode(vaultBytes);
  requireValue(vaultBytes.length===165&&vaultBytes[108]===1&&token.owner===group&&token.mint===identity.mint&&token.amount>=state.allocatedVault,'Group vault mismatch/deficit.');
  const certificate=accounts.get(guard)?decode(guard,protocol.GROUP_EXIT_GUARD_V2_DISCRIMINATOR,protocol.getGroupExitGuardV2Decoder()):null;
  const resolutionState=accounts.get(resolution)?decode(resolution,protocol.GROUP_RESOLUTION_V2_DISCRIMINATOR,protocol.getGroupResolutionV2Decoder()):null;
  if(certificate)requireValue(certificate.schemaVersion===2&&certificate.group===group&&certificate.bump===guardBump,'Invalid group certificate identity.');
  if(resolutionState)requireValue(resolutionState.schemaVersion===2&&resolutionState.group===group&&resolutionState.bump===resolutionBump,'Invalid resolution identity.');
  requireValue(state.mode===0||(certificate&&resolutionState),'Missing group safety accounts.');
  const clock=raw(GROUP_CLOCK,SYSVAR_OWNER);requireValue(clock.length===40,'Invalid group Clock.');
  const clockView=new DataView(clock.buffer,clock.byteOffset,clock.byteLength);
  return {commitment,group,registry,vault,guard,resolution,markets,btc:markets[0],eth:markets[1],state,marketStates,
    members,roots,portfolios,certificate,resolutionState,actualVault:token.amount,
    slot:clockView.getBigUint64(0,true),now:clockView.getBigInt64(32,true),context:{minSlot:minSlot!,maxSlot}};
}
export type GroupSnapshot=Awaited<ReturnType<typeof readGroupSnapshot>>;
