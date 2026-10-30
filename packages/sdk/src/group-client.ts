import {AccountRole, address, createNoopSigner, getProgramDerivedAddress, type Address, type Instruction} from '@solana/kit';
import {getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import * as protocol from './generated/index.js';
import {testRpcUrl} from './test-deployment.js';
import {GroupArtifactVerifier} from './group-artifacts.js';
import {WalletClient, hex, requireValue, fromBase64} from './wallet-client.js';
import {walletComputeBudget, resolutionComputeBudget} from './route-budget.js';
import {readGroupSnapshot, type GroupSnapshot} from './group-snapshot.js';
import {readGroupMakers} from './group-makers.js';
import {buildGroupRoute} from './group-route.js';
import {effectiveGroupFunding, groupSourceMode, groupBalanceView} from './group-balance.js';

export type GroupUserConfig = {
  version:2; chain:'solana:localnet'; profile:'cross-safety-qualification';
  rpcUrl:string; wsUrl:string; genesis:string; anchor:string; anchorHash:string;
  group:Address; mint:Address; domain:string;
};
export function groupUserConfig(value:GroupUserConfig):GroupUserConfig {
  requireValue(value?.version===2&&value.chain==='solana:localnet'&&value.profile==='cross-safety-qualification','Explicit qualified local group deployment required.');
  for(const key of ['rpcUrl','wsUrl'] as const){
    testRpcUrl(value[key],value.chain,key==='wsUrl');
    const endpoint=new URL(value[key]);requireValue(!endpoint.search&&!endpoint.hash,'Public group RPC configuration cannot contain credentials.');
  }
  requireValue(/^[0-9a-f]{64}$/.test(value.domain)&&/^[0-9a-f]{64}$/.test(value.anchorHash),'Invalid group deployment identity.');
  requireValue(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value.anchor),'Missing group initialization identity.');
  return {...value,group:address(value.group),mint:address(value.mint),genesis:address(value.genesis)};
}

/** Select a previously measured envelope before preview and signing. */
export function groupWalletInstructions(instructions:Instruction[]) {
  const economic=instructions.filter(instruction=>instruction.programAddress!=='ComputeBudget111111111111111111111111111111');
  requireValue(economic.length>0&&economic.length<=2&&economic.every(instruction=>instruction.programAddress===protocol.CLEARING_PROGRAM_ADDRESS),'Unsupported group wallet envelope.');
  const is=(index:number,discriminator:ArrayLike<number>)=>hex(economic[index].data?.slice(0,8)??[])===hex(discriminator);
  let units:400_000|600_000|700_000|1_200_000=400_000;
  if(economic.length===2){
    requireValue(is(0,protocol.TRANSFER_TRADING_CASH_V2_DISCRIMINATOR)&&is(1,protocol.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR),'Only explicit transfer-and-route may be combined.');
    units=700_000;
  } else if(is(0,protocol.EXECUTE_MARGIN_ROUTE_V2_DISCRIMINATOR)||is(0,protocol.EXECUTE_GROUP_ROUTE_V2_DISCRIMINATOR))units=600_000;
  else if(is(0,protocol.CHECK_GROUP_EXIT_V2_DISCRIMINATOR))units=1_200_000;
  return walletComputeBudget(instructions,units);
}

export function groupExitProof(snapshot:GroupSnapshot):{complete:boolean;start:number} {
  const certificate=snapshot.certificate;
  requireValue(certificate&&[1,2].includes(snapshot.state.mode)&&!snapshot.state.paused,'Group exit certification unavailable.');
  const matching=certificate.sequence===snapshot.state.sequence&&certificate.count===snapshot.members.length&&
    certificate.observations.every((value,index)=>value===snapshot.marketStates[index].observationSequence);
  if(!matching)return {complete:false,start:0};
  requireValue(certificate.next<=snapshot.members.length,'Invalid group certificate cursor.');
  if(certificate.next<snapshot.members.length)return {complete:false,start:certificate.next};
  requireValue(snapshot.members.length>0,'Empty group certificate.');
  const exposed=certificate.grossLots.some(lots=>lots!==0n);
  snapshot.marketStates.forEach((market,index)=>{
    const funding=effectiveGroupFunding(snapshot.state,market,snapshot.now,snapshot.slot);
    requireValue(funding>=certificate.fundingBounds[index][0]&&funding<=certificate.fundingBounds[index][1],
      'Group certificate funding expired; a fresh market observation is required.');
    if(exposed)requireValue(snapshot.now<certificate.sourceDeadlines[index]&&
      ['Normal','Degraded'].includes(groupSourceMode(snapshot.state,market,snapshot.now,snapshot.slot)),
      'Group certificate price expired; a fresh market observation is required.');
  });
  return {complete:true,start:certificate.next};
}

/** Owner-controlled, direct RPC access. No venue API is required for cancellation,
 * certification, allocation or an admissible funded withdrawal. */
export class GroupUserClient extends WalletClient {
  readonly config:GroupUserConfig;
  private readonly artifacts:GroupArtifactVerifier;
  constructor(config:GroupUserConfig){super(groupUserConfig(config).rpcUrl);this.config=groupUserConfig(config);this.artifacts=new GroupArtifactVerifier(this.rpc);}
  protected override walletInstructions(instructions:Instruction[]){return groupWalletInstructions(instructions);}
  async environment():Promise<void>{
    const [genesis,anchor]=await Promise.all([this.rpc.call('getGenesisHash'),this.rpc.call('getTransaction',[
      this.config.anchor,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}])]);
    requireValue(genesis===this.config.genesis,'Wrong group cluster; deployment was reset.');
    requireValue(anchor?.meta?.err===null&&anchor.transaction?.signatures?.[0]===this.config.anchor,'Group initialization history unavailable.');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(anchor.transaction)));
    requireValue(hex(new Uint8Array(digest))===this.config.anchorHash,'Group initialization history mismatch.');
    const account=await this.rpc.call('getAccountInfo',[this.config.group,{encoding:'base64',commitment:'confirmed'}]);
    requireValue(account.value?.owner===protocol.CLEARING_PROGRAM_ADDRESS&&account.value.data?.[1]==='base64','Missing group deployment authority.');
    const bytes=fromBase64(account.value.data[0]);requireValue(hex(bytes.slice(0,8))===hex(protocol.CLEARING_GROUP_V2_DISCRIMINATOR),'Wrong group deployment schema.');
    const group=protocol.getClearingGroupV2Decoder().decode(bytes);
    requireValue(group.schemaVersion===2&&group.profileVersion===2&&hex(group.domain)===this.config.domain&&group.quoteMint===this.config.mint,'Group deployment identity mismatch.');
    await this.artifacts.verify(group.authority);
  }
  async snapshot(commitment:'confirmed'|'finalized'='finalized'){
    await this.environment();return readGroupSnapshot(this.rpc,this.config,commitment);
  }
  async walletTokens(owner:Address):Promise<{address:Address;amount:bigint}[]>{
    const response=await this.rpc.call('getTokenAccountsByOwner',[owner,{mint:this.config.mint},{encoding:'base64',commitment:'finalized'}]);
    requireValue(Array.isArray(response.value),'Incomplete wallet collateral response.');
    return response.value.map((entry:any)=>{
      requireValue(entry.account?.owner===TOKEN_PROGRAM_ADDRESS&&entry.account.data?.[1]==='base64','Foreign collateral account.');
      const bytes=fromBase64(entry.account.data[0]);requireValue(bytes.length===165,'Unsupported collateral account layout.');
      const token=getTokenDecoder().decode(bytes);
      requireValue(token.owner===owner&&token.mint===this.config.mint,'Collateral owner/mint mismatch.');
      return {address:address(entry.pubkey),amount:token.amount};
    });
  }
  async ownerPortfolio(owner:Address,index=0){
    requireValue(Number.isInteger(index)&&index>=0&&index<=3,'Portfolio index must be 0–3.');
    const [portfolio,bump]=await protocol.findGroupPortfolioPda({group:this.config.group,owner,index});
    const response=await this.rpc.call('getAccountInfo',[portfolio,{encoding:'base64',commitment:'finalized'}]);
    if(response.value===null)return {address:portfolio,account:null};
    requireValue(response.value?.owner===protocol.CLEARING_PROGRAM_ADDRESS&&response.value.data?.[1]==='base64','Foreign owner portfolio.');
    const bytes=fromBase64(response.value.data[0]);
    requireValue(hex(bytes.slice(0,8))===hex(protocol.PORTFOLIO_V2_DISCRIMINATOR),'Wrong portfolio discriminator.');
    const account=protocol.getPortfolioV2Decoder().decode(bytes);
    requireValue(account.schemaVersion===2&&account.group===this.config.group&&account.owner===owner&&account.index===index&&account.bump===bump,'Portfolio identity mismatch.');
    return {address:portfolio,account};
  }
  async common(){
    const [eventAuthority]=await getProgramDerivedAddress({programAddress:protocol.CLEARING_PROGRAM_ADDRESS,seeds:[new TextEncoder().encode('__event_authority')]});
    return {group:this.config.group,eventAuthority,program:protocol.CLEARING_PROGRAM_ADDRESS};
  }
  private bound(snapshot:GroupSnapshot){requireValue(snapshot.group===this.config.group&&snapshot.state.quoteMint===this.config.mint&&hex(snapshot.state.domain)===this.config.domain,'Foreign group snapshot.');}
  private owned(snapshot:GroupSnapshot,owner:Address,margin:Address){
    this.bound(snapshot);const root=snapshot.roots[margin];requireValue(root?.owner===owner,'Owner margin authority required.');return root;
  }
  private stamp(snapshot:GroupSnapshot){this.bound(snapshot);return {sequence:snapshot.state.sequence,observations:snapshot.marketStates.map(market=>market.observationSequence)};}
  balance(snapshot:GroupSnapshot,margin:Address){
    this.bound(snapshot);requireValue(snapshot.roots[margin],'Unknown margin account.');
    return groupBalanceView(snapshot.roots[margin],snapshot.state,snapshot.marketStates,snapshot.now,snapshot.slot);
  }
  async quote(actor:Address,margin:Address,marketIndex:0|1,side:0|1,lots:bigint,limits:{maxFee:bigint;allInLimit:bigint;reduceOnly?:boolean}){
    const snapshot=await this.snapshot('confirmed'),makers=await readGroupMakers(this.rpc,snapshot);
    return buildGroupRoute({snapshot,trader:margin,marketIndex,side,lots,makers,...limits},actor);
  }
  async createPortfolio(owner:Address,index=0){
    requireValue(Number.isInteger(index)&&index>=0&&index<=3,'Portfolio index must be 0–3.');
    return protocol.getCreatePortfolioV2InstructionAsync({...await this.common(),owner:createNoopSigner(owner),index});
  }
  async register(owner:Address,portfolioIndex:number,subaccountIndex:number,isolatedMarketIndex?:0|1,role:0|1|2=0){
    requireValue(Number.isInteger(portfolioIndex)&&portfolioIndex>=0&&portfolioIndex<=3&&Number.isInteger(subaccountIndex)&&subaccountIndex>=0&&subaccountIndex<=8,'Invalid account indexes.');
    requireValue([0,1,2].includes(role)&&(subaccountIndex===0?isolatedMarketIndex===undefined&&role!==1:isolatedMarketIndex===0||isolatedMarketIndex===1),'Invalid immutable margin mode/role.');
    const [portfolio]=await protocol.findGroupPortfolioPda({group:this.config.group,owner,index:portfolioIndex});
    return protocol.getRegisterMarginV2InstructionAsync({...await this.common(),owner:createNoopSigner(owner),portfolio,subaccountIndex,
      mode:subaccountIndex===0?0:1,isolatedMarketIndex:isolatedMarketIndex??255,role});
  }
  async deposit(snapshot:GroupSnapshot,owner:Address,margin:Address,userToken:Address,amount:bigint){
    this.owned(snapshot,owner,margin);requireValue(amount>0n&&snapshot.state.mode!==3,'Deposit unavailable.');
    const accounts={...await this.common(),owner:createNoopSigner(owner),margin,quoteMint:this.config.mint,userToken,amount};
    return snapshot.state.mode===0?protocol.getDepositGroupV2InstructionAsync(accounts):
      protocol.getGroupTradingCashV2InstructionAsync({...snapshot,...accounts,...this.stamp(snapshot),withdraw:false});
  }
  async manageOrder(snapshot:GroupSnapshot,actor:Address,margin:Address,marketIndex:0|1,operation:protocol.GroupOrderActionArgs){
    this.bound(snapshot);const root=snapshot.roots[margin];
    requireValue(root&&[0,1].includes(marketIndex)&&[1,2].includes(snapshot.state.mode)&&
      (root.mode===0?snapshot.state.mode===2:root.isolatedMarketIndex===marketIndex),'Account market is unavailable.');
    requireValue(root.owner===actor||(root.delegate===actor&&snapshot.slot<root.delegateExpirySlot),'Live account trading authority required.');
    // Cancellation needs no maker or fresh price. Clearing refreshes reservations
    // and checks the durable version/authority for both account modes.
    return protocol.getManageMarginOrderV2Instruction({...await this.common(),...this.stamp(snapshot),owner:createNoopSigner(actor),margin,
      market:snapshot.markets[marketIndex],otherMarket:snapshot.markets[1-marketIndex],operation});
  }
  async cancel(snapshot:GroupSnapshot,actor:Address,margin:Address,id:bigint,version:bigint,protectionGroup=false){
    this.bound(snapshot);const root=snapshot.roots[margin];requireValue(root,'Unknown margin account.');
    const order=root.book.orders.find(entry=>protectionGroup?entry.order.groupId===id:entry.order.id===id);
    requireValue(order&&[0,1].includes(order.marketIndex),'Unknown order/protection identity.');
    return this.manageOrder(snapshot,actor,margin,order.marketIndex as 0|1,protocol.groupOrderAction('Cancel',{id,version,protectionGroup}));
  }
  async setDelegate(snapshot:GroupSnapshot,owner:Address,margin:Address,delegate:Address,expirySlot:bigint){
    this.owned(snapshot,owner,margin);
    requireValue(delegate==='11111111111111111111111111111111'?expirySlot===0n:expirySlot>snapshot.slot&&expirySlot<=snapshot.slot+216_000n,'Invalid delegate expiry.');
    return protocol.getSetMarginDelegateV2Instruction({...await this.common(),owner:createNoopSigner(owner),margin,delegate,expirySlot});
  }
  async netClosedClaims(snapshot:GroupSnapshot,owner:Address,margin:Address){
    const root=this.owned(snapshot,owner,margin);
    requireValue(root.mode===0&&root.positions.every(position=>position.lots===0n)&&root.book.orders.every(entry=>![1,2].includes(entry.order.state)),'Netting requires a flat cross account without live orders.');
    return protocol.getNetMarginClaimsV2Instruction({...await this.common(),...this.stamp(snapshot),owner:createNoopSigner(owner),margin,btc:snapshot.btc,eth:snapshot.eth});
  }
  async certificatePage(snapshot:GroupSnapshot):Promise<Instruction|null>{
    this.bound(snapshot);const proof=groupExitProof(snapshot);if(proof.complete)return null;
    const page=snapshot.members.slice(proof.start,proof.start+8);
    requireValue(page.length>0,'No group members to certify.');
    const instruction=await protocol.getCheckGroupExitV2InstructionAsync({...snapshot,...this.stamp(snapshot),start:proof.start});
    return {...instruction,accounts:[...instruction.accounts,...page.map(account=>({address:account,role:AccountRole.READONLY}))]};
  }
  async exit(snapshot:GroupSnapshot,owner:Address,margin:Address,userToken:Address,amount:bigint){
    const root=this.owned(snapshot,owner,margin);requireValue(amount>0n&&amount<=root.cash&&!snapshot.state.paused&&snapshot.state.mode!==3,'Funded exit unavailable.');
    if(snapshot.state.mode===0)return {verificationOnly:false,instructions:[await protocol.getWithdrawGroupCustodyV2InstructionAsync({
      ...await this.common(),owner:createNoopSigner(owner),margin,quoteMint:this.config.mint,userToken,amount})]};
    const page=await this.certificatePage(snapshot);
    // Separate transactions preserve the proof page's read-only member contract.
    if(page)return {verificationOnly:true,instructions:[resolutionComputeBudget(),page]};
    return {verificationOnly:false,instructions:[await protocol.getGroupTradingCashV2InstructionAsync({...snapshot,...await this.common(),...this.stamp(snapshot),
      owner:createNoopSigner(owner),margin,quoteMint:this.config.mint,userToken,amount,withdraw:true})]};
  }
  async transfer(snapshot:GroupSnapshot,owner:Address,donor:Address,recipient:Address,amount:bigint){
    const source=this.owned(snapshot,owner,donor);this.owned(snapshot,owner,recipient);
    requireValue(donor!==recipient&&amount>0n&&amount<=source.cash,'Invalid funded allocation.');
    if(snapshot.state.mode===0)return {verificationOnly:false,instructions:[await protocol.getTransferGroupCustodyV2InstructionAsync({
      ...await this.common(),owner:createNoopSigner(owner),donor,recipient,amount})]};
    const page=await this.certificatePage(snapshot);if(page)return {verificationOnly:true,instructions:[resolutionComputeBudget(),page]};
    return {verificationOnly:false,instructions:[await protocol.getTransferTradingCashV2InstructionAsync({...snapshot,...await this.common(),...this.stamp(snapshot),
      owner:createNoopSigner(owner),donor,recipient,amount})]};
  }
}
