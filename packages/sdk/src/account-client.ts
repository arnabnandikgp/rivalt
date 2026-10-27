import {address,createNoopSigner,getProgramDerivedAddress,type Address,type Instruction} from '@solana/kit';
import {getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import * as protocol from './generated/index.js';
import {testRpcUrl} from './test-deployment.js';
import {AccountArtifactVerifier} from './account-artifacts.js';
import {deriveAccountPortfolio,findMarginV3Pda,findBackingV3Pda,findVenueComponentV3Pda} from './account-addresses.js';
import {WalletClient,hex,requireValue,fromBase64} from './wallet-client.js';
import {walletComputeBudget} from './route-budget.js';
import {readAccountSnapshot,accountGuard,type AccountSnapshot} from './account-snapshot.js';

export type AccountUserConfig={version:3;chain:'solana:localnet';profile:'account-safety-qualification';rpcUrl:string;wsUrl:string;
  genesis:string;anchor:string;anchorHash:string;venue:Address;mint:Address;domain:string};
export function accountUserConfig(value:AccountUserConfig):AccountUserConfig {
  requireValue(value?.version===3&&value.chain==='solana:localnet'&&value.profile==='account-safety-qualification','Explicit qualified local account deployment required.');
  for(const key of ['rpcUrl','wsUrl'] as const) {
    testRpcUrl(value[key],value.chain,key==='wsUrl');const endpoint=new URL(value[key]);
    requireValue(!endpoint.search&&!endpoint.hash&&!endpoint.username&&!endpoint.password,'Public account RPC configuration cannot contain credentials.');
  }
  requireValue(/^[0-9a-f]{64}$/.test(value.domain)&&/^[0-9a-f]{64}$/.test(value.anchorHash),'Invalid account deployment identity.');
  requireValue(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value.anchor),'Missing venue initialization identity.');
  return {...value,venue:address(value.venue),mint:address(value.mint),genesis:address(value.genesis)};
}
export function accountWalletInstructions(instructions:Instruction[]) {
  const economic=instructions.filter(instruction=>instruction.programAddress!=='ComputeBudget111111111111111111111111111111');
  requireValue(economic.length===1&&economic[0].programAddress===protocol.CLEARING_PROGRAM_ADDRESS,'Unsupported account wallet envelope.');
  const discriminator=hex(economic[0].data?.slice(0,8)??[]);
  const route=discriminator===hex(protocol.EXECUTE_ACCOUNT_ROUTE_V3_DISCRIMINATOR);
  const supported=[protocol.CREATE_PORTFOLIO_V3_DISCRIMINATOR,protocol.REGISTER_MARGIN_V3_DISCRIMINATOR,protocol.DEPOSIT_ACCOUNT_V3_DISCRIMINATOR,
    protocol.WITHDRAW_ACCOUNT_CUSTODY_V3_DISCRIMINATOR,protocol.WITHDRAW_FUNDED_ACCOUNT_V3_DISCRIMINATOR,protocol.TRANSFER_ACCOUNT_CUSTODY_V3_DISCRIMINATOR,
    protocol.TRANSFER_FUNDED_ACCOUNT_V3_DISCRIMINATOR,protocol.MANAGE_ACCOUNT_ORDER_V3_DISCRIMINATOR,protocol.SET_ACCOUNT_DELEGATE_V3_DISCRIMINATOR,
    protocol.NET_ACCOUNT_CLAIMS_V3_DISCRIMINATOR];
  requireValue(route||supported.some(value=>hex(value)===discriminator),'Unsupported account wallet action.');
  return walletComputeBudget(instructions,route?600_000:400_000);
}

/** Owner/delegate operations over direct RPC. Saved signed originals use the
 * shared immutable wallet transport; the venue API is not an exit dependency. */
export class AccountUserClient extends WalletClient {
  readonly config:AccountUserConfig;
  private readonly artifacts:AccountArtifactVerifier;
  constructor(config:AccountUserConfig) {super(accountUserConfig(config).rpcUrl);this.config=accountUserConfig(config);this.artifacts=new AccountArtifactVerifier(this.rpc);}
  protected override walletInstructions(instructions:Instruction[]){return accountWalletInstructions(instructions);}
  async environment() {
    const [genesis,anchor,observed]=await Promise.all([this.rpc.call('getGenesisHash'),this.rpc.call('getTransaction',[
      this.config.anchor,{commitment:'finalized',encoding:'json',maxSupportedTransactionVersion:0}]),
      this.rpc.call('getAccountInfo',[this.config.venue,{encoding:'base64',commitment:'confirmed'}])]);
    requireValue(genesis===this.config.genesis,'Wrong account cluster; deployment was reset.');
    requireValue(anchor?.meta?.err===null&&anchor.transaction?.signatures?.[0]===this.config.anchor,'Venue initialization history unavailable.');
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(anchor.transaction)));
    requireValue(hex(new Uint8Array(digest))===this.config.anchorHash,'Venue initialization history mismatch.');
    requireValue(observed.value?.owner===protocol.CLEARING_PROGRAM_ADDRESS&&observed.value.data?.[1]==='base64','Missing venue authority.');
    const bytes=fromBase64(observed.value.data[0]);
    requireValue(bytes.length===protocol.getVenueV3Size()&&hex(bytes.slice(0,8))===hex(protocol.VENUE_V3_DISCRIMINATOR),'Wrong venue schema.');
    const venue=protocol.getVenueV3Decoder().decode(bytes);
    requireValue(venue.schemaVersion===3&&venue.profileVersion===3&&hex(venue.domain)===this.config.domain&&venue.quoteMint===this.config.mint,'Venue deployment identity mismatch.');
    await this.artifacts.verify(venue.authority);
  }
  async snapshot(margins:Address[],commitment:'confirmed'|'finalized'='finalized') {
    await this.environment();return readAccountSnapshot(this.rpc,this.config,margins,commitment);
  }
  async common() {
    const [eventAuthority]=await getProgramDerivedAddress({programAddress:protocol.CLEARING_PROGRAM_ADDRESS,seeds:[new TextEncoder().encode('__event_authority')]});
    return {venue:this.config.venue,eventAuthority,program:protocol.CLEARING_PROGRAM_ADDRESS};
  }
  private bound(snapshot:AccountSnapshot) {
    requireValue(snapshot.venue===this.config.venue&&snapshot.venueState.quoteMint===this.config.mint&&hex(snapshot.venueState.domain)===this.config.domain,'Foreign account snapshot.');
  }
  private owned(snapshot:AccountSnapshot,owner:Address,margin:Address) {
    this.bound(snapshot);const root=snapshot.roots[margin];requireValue(root?.owner===owner,'Owner margin authority required.');return root;
  }
  async walletTokens(owner:Address) {
    const response=await this.rpc.call('getTokenAccountsByOwner',[owner,{mint:this.config.mint},{encoding:'base64',commitment:'finalized'}]);
    requireValue(Array.isArray(response.value),'Incomplete wallet collateral response.');
    return response.value.map((entry:any)=>{
      requireValue(entry.account?.owner===TOKEN_PROGRAM_ADDRESS&&entry.account.data?.[1]==='base64','Foreign collateral account.');
      const bytes=fromBase64(entry.account.data[0]);requireValue(bytes.length===165&&bytes[108]===1,'Unsupported collateral account layout.');
      const token=getTokenDecoder().decode(bytes);requireValue(token.owner===owner&&token.mint===this.config.mint,'Collateral owner/mint mismatch.');
      return {address:address(entry.pubkey),amount:token.amount};
    }) as {address:Address;amount:bigint}[];
  }
  async ownerPortfolio(owner:Address,index=0) {
    const [portfolio,bump]=await deriveAccountPortfolio(this.config.venue,owner,index);
    const response=await this.rpc.call('getAccountInfo',[portfolio,{encoding:'base64',commitment:'finalized'}]);
    if(response.value===null)return {address:portfolio,account:null};
    requireValue(response.value?.owner===protocol.CLEARING_PROGRAM_ADDRESS&&response.value.data?.[1]==='base64','Foreign portfolio.');
    const bytes=fromBase64(response.value.data[0]);requireValue(bytes.length===protocol.getPortfolioV3Size()&&hex(bytes.slice(0,8))===hex(protocol.PORTFOLIO_V3_DISCRIMINATOR),'Wrong portfolio schema.');
    const account=protocol.getPortfolioV3Decoder().decode(bytes);
    requireValue(account.schemaVersion===3&&account.venue===this.config.venue&&account.owner===owner&&account.index===index&&account.bump===bump,'Portfolio identity mismatch.');
    return {address:portfolio,account};
  }
  async createPortfolio(owner:Address,index=0) {
    const [portfolio]=await deriveAccountPortfolio(this.config.venue,owner,index);
    return protocol.getCreatePortfolioV3InstructionAsync({...await this.common(),owner:createNoopSigner(owner),portfolio,index});
  }
  async register(owner:Address,portfolioIndex:number,subaccountIndex:number,isolatedMarketIndex?:0|1,role:0|1|2=0) {
    requireValue([0,1,2].includes(role)&&(subaccountIndex===0?isolatedMarketIndex===undefined&&role!==1:isolatedMarketIndex===0||isolatedMarketIndex===1),'Invalid immutable margin mode/role.');
    const [portfolio]=await deriveAccountPortfolio(this.config.venue,owner,portfolioIndex),[margin]=await findMarginV3Pda(portfolio,subaccountIndex);
    return protocol.getRegisterMarginV3InstructionAsync({...await this.common(),owner:createNoopSigner(owner),portfolio,margin,subaccountIndex,
      mode:subaccountIndex===0?0:1,isolatedMarketIndex:isolatedMarketIndex??255,role});
  }
  async deposit(snapshot:AccountSnapshot,owner:Address,margin:Address,userToken:Address,amount:bigint) {
    this.owned(snapshot,owner,margin);requireValue(amount>0n&&[0,1].includes(snapshot.safetyState.mode)&&!snapshot.safetyState.paused,'Deposit unavailable.');
    return protocol.getDepositAccountV3InstructionAsync({...snapshot,...await this.common(),owner:createNoopSigner(owner),margin,
      quoteMint:this.config.mint,userToken,amount});
  }
  async exit(snapshot:AccountSnapshot,owner:Address,margin:Address,userToken:Address,amount:bigint) {
    const root=this.owned(snapshot,owner,margin),safety=snapshot.safetyState;
    requireValue(amount>0n&&amount<=root.cash&&!safety.paused&&safety.mode!==2,'Funded exit unavailable.');
    const accounts={...snapshot,...await this.common(),owner:createNoopSigner(owner),margin,quoteMint:this.config.mint,userToken,amount};
    const instruction=safety.mode===0&&safety.resolutionEpoch===0n?
      await protocol.getWithdrawAccountCustodyV3InstructionAsync(accounts):
      protocol.getWithdrawFundedAccountV3Instruction({...accounts,guard:accountGuard(snapshot,margin)});
    // No verification-only page, certificate, sibling account or global sequence.
    return {instructions:[instruction]};
  }
  async transfer(snapshot:AccountSnapshot,owner:Address,donor:Address,recipient:Address,amount:bigint) {
    const source=this.owned(snapshot,owner,donor);this.owned(snapshot,owner,recipient);
    requireValue(donor!==recipient&&amount>0n&&amount<=source.cash&&!snapshot.safetyState.paused&&[0,1].includes(snapshot.safetyState.mode),'Funded transfer unavailable.');
    const accounts={...snapshot,...await this.common(),owner:createNoopSigner(owner),donor,recipient,amount};
    return snapshot.safetyState.mode===0?protocol.getTransferAccountCustodyV3InstructionAsync(accounts):
      protocol.getTransferFundedAccountV3Instruction({...accounts,guard:accountGuard(snapshot,donor)});
  }
  async manageOrder(snapshot:AccountSnapshot,actor:Address,margin:Address,marketIndex:0|1,operation:protocol.GroupOrderActionArgs) {
    this.bound(snapshot);const root=snapshot.roots[margin];
    requireValue(root&&[0,1].includes(marketIndex)&&snapshot.safetyState.mode===1&&(root.mode===0||root.isolatedMarketIndex===marketIndex),'Account market unavailable.');
    requireValue(root.owner===actor||(root.delegate===actor&&snapshot.slot<root.delegateExpirySlot),'Live account trading authority required.');
    return protocol.getManageAccountOrderV3Instruction({...snapshot,...await this.common(),actor:createNoopSigner(actor),margin,
      guard:accountGuard(snapshot,margin),marketIndex,operation});
  }
  async cancel(snapshot:AccountSnapshot,actor:Address,margin:Address,id:bigint,version:bigint,protectionGroup=false) {
    this.bound(snapshot);const root=snapshot.roots[margin];requireValue(root,'Unknown margin account.');
    const stored=root.book.orders.find(entry=>protectionGroup?entry.order.groupId===id:entry.order.id===id);
    requireValue(stored&&[0,1].includes(stored.marketIndex),'Unknown order/protection identity.');
    return this.manageOrder(snapshot,actor,margin,stored.marketIndex as 0|1,protocol.groupOrderAction('Cancel',{id,version,protectionGroup}));
  }
  async setDelegate(snapshot:AccountSnapshot,owner:Address,margin:Address,delegate:Address,expirySlot:bigint) {
    this.owned(snapshot,owner,margin);requireValue([0,1].includes(snapshot.safetyState.mode),'Account authority unavailable.');
    requireValue(delegate==='11111111111111111111111111111111'?expirySlot===0n:expirySlot>snapshot.slot&&expirySlot<=snapshot.slot+216_000n,'Invalid delegate expiry.');
    return protocol.getSetAccountDelegateV3Instruction({...snapshot,...await this.common(),owner:createNoopSigner(owner),margin,
      guard:accountGuard(snapshot,margin),delegate,expirySlot});
  }
  async netClosedClaims(snapshot:AccountSnapshot,owner:Address,margin:Address,sourceMarketIndex:0|1,amount:bigint) {
    const root=this.owned(snapshot,owner,margin);
    requireValue(root.mode===0&&amount>0n&&[0,1].includes(sourceMarketIndex)&&root.positions.every(position=>position.lots===0n),'Netting requires a flat cross account and explicit amount.');
    const [[certificate],[registry]]=await Promise.all([findBackingV3Pda(snapshot.venue,sourceMarketIndex),findVenueComponentV3Pda(snapshot.venue,'registry')]);
    return protocol.getNetAccountClaimsV3InstructionAsync({...snapshot,...await this.common(),owner:createNoopSigner(owner),margin,
      guard:accountGuard(snapshot,margin),sourceMarket:sourceMarketIndex,certificate,registry,amount});
  }
}
