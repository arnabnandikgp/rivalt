import {address,createNoopSigner,getProgramDerivedAddress,type Address,type Instruction,type Blockhash} from '@solana/kit';
import {PublicKey} from '@solana/web3.js';
import {getTokenDecoder,TOKEN_PROGRAM_ADDRESS} from '@solana-program/token';
import * as protocol from './generated/index.js';
import {testRpcUrl} from './test-deployment.js';
import {ACCOUNT_PROFILE,readMembershipRegistry,readMarginMembership} from './account-membership.js';
import {deriveMemberPage,deriveMemberIndex,deriveStorageFunding} from './account-addresses.js';
import {ArtifactVerifier} from './artifacts.js';
import {accountDeployment,type AccountDeployment} from './account-deployment.js';
import {readOwnerAccounts} from './account-owner-discovery.js';
import {validateActivationDeposit} from './account-wallet-envelope.js';
import {compileCanonicalTransaction} from './canonical-transport.js';
import {buildLiquidityRoute} from './liquidity-route.js';
import {deriveAccountPortfolio,deriveMarginAccount,deriveSettlementCertificate,deriveVenueComponent} from './account-addresses.js';
import {WalletClient,hex,requireValue,fromBase64} from './wallet-client.js';
import {walletComputeBudget} from './route-budget.js';
import {readAccountSnapshot,readAccountTradeSnapshot,accountGuard,type AccountSnapshot} from './account-snapshot.js';
import {accountBalanceView} from './account-balance.js';
import {accountMarketMetas,accountLiabilityMetas} from './account-markets.js';
import type {LiquidityRouteInput} from './liquidity-route.js';

export type AccountUserConfig={version:4;accountSchema:10;deployment:AccountDeployment;chain:'solana:localnet';profile:'liquidity-execution-qualification';rpcUrl:string;wsUrl:string;
  genesis:string;anchor:string;anchorHash:string;venue:Address;mint:Address;domain:string};
export function accountUserConfig(value:AccountUserConfig):AccountUserConfig {
  requireValue(value?.version===4&&value.accountSchema===10&&(value.deployment==='selected'||value.deployment==='account-scale-candidate')&&value.chain==='solana:localnet'&&value.profile==='liquidity-execution-qualification','Explicit qualified local liquidity deployment required.');
  return validateAccountConfig(value);
}
function validateAccountConfig<Config extends AccountUserConfig>(value:Config):Config {
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
  if(economic.length===2){validateActivationDeposit(economic);return walletComputeBudget(instructions,400_000);}
  requireValue(economic.length===1&&economic[0].programAddress===protocol.CLEARING_PROGRAM_ADDRESS,'Unsupported account wallet envelope.');
  const discriminator=hex(economic[0].data?.slice(0,8)??[]);
  const route=discriminator===hex(protocol.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR);
  const supported=[protocol.CREATE_PORTFOLIO_DISCRIMINATOR,protocol.REGISTER_MARGIN_DISCRIMINATOR,protocol.DEPOSIT_ACCOUNT_DISCRIMINATOR,
    protocol.WITHDRAW_ACCOUNT_CUSTODY_DISCRIMINATOR,protocol.WITHDRAW_FUNDED_ACCOUNT_DISCRIMINATOR,protocol.TRANSFER_ACCOUNT_CUSTODY_DISCRIMINATOR,
    protocol.TRANSFER_FUNDED_ACCOUNT_DISCRIMINATOR,protocol.MANAGE_ACCOUNT_ORDER_DISCRIMINATOR,protocol.SET_ACCOUNT_DELEGATE_DISCRIMINATOR,
    protocol.NET_ACCOUNT_CLAIMS_DISCRIMINATOR,protocol.ACTIVATE_MARGIN_DISCRIMINATOR,protocol.DEACTIVATE_MARGIN_DISCRIMINATOR,
    protocol.RETIRE_MARGIN_DISCRIMINATOR,protocol.FUND_MEMBER_PAGE_DISCRIMINATOR,protocol.FUND_MEMBER_INDEX_DISCRIMINATOR];
  requireValue(route||supported.some(value=>hex(value)===discriminator),'Unsupported account wallet action.');
  return walletComputeBudget(instructions,route?800_000:400_000);
}

/** Owner/delegate operations over direct RPC. Saved signed originals use the
 * shared immutable wallet transport; the venue API is not an exit dependency. */
export class AccountUserClient extends WalletClient {
  readonly config:AccountUserConfig;
  private readonly artifacts:ArtifactVerifier;
  constructor(config:AccountUserConfig) {
    const checked=accountUserConfig(config);
    super(checked.rpcUrl);this.config=checked;
    this.artifacts=new ArtifactVerifier(this.rpc,accountDeployment(checked.deployment).artifacts);
  }
  protected override get maxTransactionVersion():0|1{return 1;}
  protected override compile(owner:Address,recentBlockhash:Blockhash,instructions:Instruction[]) {
    const economic=instructions.filter(instruction=>instruction.programAddress!=='ComputeBudget111111111111111111111111111111');
    accountWalletInstructions(economic); // Also validates the narrowly bounded two-action envelope.
    const route=hex(economic[0].data?.slice(0,8)??[])===hex(protocol.EXECUTE_LIQUIDITY_ROUTE_DISCRIMINATOR);
    if(!route)accountWalletInstructions(economic); // Shared financial action allowlist.
    return compileCanonicalTransaction({payerKey:new PublicKey(owner),recentBlockhash},economic,
      {computeUnitLimit:route?800_000:400_000,loadedAccountsDataSizeLimit:8*1024*1024}).transaction;
  }
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
    requireValue(bytes.length===protocol.getVenueSize()&&hex(bytes.slice(0,8))===hex(protocol.VENUE_DISCRIMINATOR),'Wrong venue schema.');
    const venue=protocol.getVenueDecoder().decode(bytes);
    requireValue(venue.schemaVersion===10&&venue.profileVersion===ACCOUNT_PROFILE&&hex(venue.domain)===this.config.domain&&venue.quoteMint===this.config.mint,'Venue deployment identity mismatch.');
    await this.artifacts.verify(venue.authority);
  }
  async snapshot(margins:Address[],commitment:'confirmed'|'finalized'='finalized') {
    await this.environment();return readAccountSnapshot(this.rpc,this.config,margins,commitment);
  }
  async tradeSnapshot(trader:Address,marketIndex:0|1) {
    await this.environment();return readAccountTradeSnapshot(this.rpc,this.config,trader,marketIndex,'confirmed');
  }
  balance(snapshot:AccountSnapshot,margin:Address) {
    this.bound(snapshot);requireValue(snapshot.roots[margin],'Margin absent from snapshot.');
    return accountBalanceView(snapshot.roots[margin],snapshot.safetyState,snapshot.marketStates,snapshot.now,snapshot.slot);
  }
  async route(input:LiquidityRouteInput,actor:Address):Promise<Awaited<ReturnType<typeof buildLiquidityRoute>>> {
    this.bound(input.snapshot);return await buildLiquidityRoute(input,actor);
  }
  async common() {
    const [eventAuthority]=await getProgramDerivedAddress({programAddress:protocol.CLEARING_PROGRAM_ADDRESS,seeds:[new TextEncoder().encode('__event_authority')]});
    return {venue:this.config.venue,eventAuthority,program:protocol.CLEARING_PROGRAM_ADDRESS};
  }
  private bound(snapshot:AccountSnapshot) {
    requireValue(snapshot.venue===this.config.venue&&snapshot.venueState.profileVersion===ACCOUNT_PROFILE&&snapshot.venueState.quoteMint===this.config.mint&&hex(snapshot.venueState.domain)===this.config.domain,'Foreign account snapshot.');
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
    const bytes=fromBase64(response.value.data[0]);requireValue(bytes.length===protocol.getPortfolioSize()&&hex(bytes.slice(0,8))===hex(protocol.PORTFOLIO_DISCRIMINATOR),'Wrong portfolio schema.');
    const account=protocol.getPortfolioDecoder().decode(bytes);
    requireValue(account.schemaVersion===10&&account.venue===this.config.venue&&account.owner===owner&&account.index===index&&account.bump===bump,'Portfolio identity mismatch.');
    return {address:portfolio,account};
  }
  async createPortfolio(owner:Address,index=0) {
    const [portfolio]=await deriveAccountPortfolio(this.config.venue,owner,index);
    return protocol.getCreatePortfolioInstructionAsync({...await this.common(),owner:createNoopSigner(owner),portfolio,index});
  }
  /** Includes retired namespaces; one coherent portfolio/children RPC batch. */
  async ownerAccounts(owner:Address,index=0) {
    return readOwnerAccounts(this.rpc,this.config.venue,owner,index);
  }
  async register(owner:Address,portfolioIndex:number,subaccountIndex:number,isolatedMarketIndex?:0|1,role:0|1|2=0) {
    requireValue([0,1,2].includes(role)&&(subaccountIndex===0?isolatedMarketIndex===undefined&&role!==1:isolatedMarketIndex===0||isolatedMarketIndex===1),'Invalid immutable margin mode/role.');
    const [portfolio]=await deriveAccountPortfolio(this.config.venue,owner,portfolioIndex),[margin]=await deriveMarginAccount(portfolio,subaccountIndex);
    const registry=await readMembershipRegistry(this.rpc,this.config.venue);
    const [members]=await deriveMemberPage(this.config.venue,registry.state.nextId/64n);
    return protocol.getRegisterMarginInstructionAsync({...await this.common(),members,owner:createNoopSigner(owner),portfolio,margin,subaccountIndex,
      mode:subaccountIndex===0?0:1,isolatedMarketIndex:isolatedMarketIndex??255,role});
  }
  async fundMemberPage(payer:Address,pageIndex:bigint) {
    const [allocation]=await deriveMemberPage(this.config.venue,pageIndex),[receipt]=await deriveStorageFunding(this.config.venue,allocation);
    return protocol.getFundMemberPageInstructionAsync({...await this.common(),payer:createNoopSigner(payer),allocation,receipt,pageIndex});
  }
  async fundMemberIndex(payer:Address,level:number,prefix:bigint) {
    const [allocation]=await deriveMemberIndex(this.config.venue,level,prefix),[receipt]=await deriveStorageFunding(this.config.venue,allocation);
    return protocol.getFundMemberIndexInstructionAsync({...await this.common(),payer:createNoopSigner(payer),allocation,receipt,level,prefix});
  }
  async changeMembership(owner:Address,margin:Address,activate:boolean) {
    const state=await readMarginMembership(this.rpc,this.config.venue,owner,margin);
    requireValue(state.root.lifecycle===(activate?1:2),'Wrong account lifecycle for membership transition.');
    const input={...state,...await this.common(),owner:createNoopSigner(owner)};
    const instruction=activate?protocol.getActivateMarginInstruction(input):protocol.getDeactivateMarginInstruction(input);
    return {...instruction,accounts:[...instruction.accounts,...state.remaining]};
  }
  /** Atomically makes one empty Registered root Financial and deposits collateral.
   * Recovery and membership storage must already be provisioned with SOL by its
   * explicit payer; this action never silently funds operator storage. */
  async activateAndDeposit(owner:Address,margin:Address,userToken:Address,amount:bigint) {
    requireValue(amount>0n&&amount<(1n<<64n),'Invalid deposit amount.');
    const state=await readMarginMembership(this.rpc,this.config.venue,owner,margin);
    requireValue(state.root.lifecycle===1,'Activation requires a Registered account.');
    requireValue([0,1].includes(state.safetyState.mode)&&!state.safetyState.paused,'Activation unavailable.');
    requireValue(state.storageState&&state.storageState.lockedEpoch===0n
      &&state.storageState.readyCapacity>state.registryState.financialCount,'Venue recovery capacity must be provisioned before activation.');
    const common=await this.common(),input={...state,...common,owner:createNoopSigner(owner)};
    const activation=protocol.getActivateMarginInstruction(input);
    const deposit=await protocol.getDepositAccountInstructionAsync({...common,owner:createNoopSigner(owner),margin,
      quoteMint:this.config.mint,userToken,amount});
    return {instructions:[{...activation,accounts:[...activation.accounts,...state.remaining]},deposit]};
  }
  async retire(owner:Address,margin:Address) {
    const state=await readMarginMembership(this.rpc,this.config.venue,owner,margin,false);
    requireValue(state.root.lifecycle===1,'Deactivate an empty account before retirement.');
    return protocol.getRetireMarginInstruction({...state,...await this.common(),owner:createNoopSigner(owner)});
  }
  async deposit(snapshot:AccountSnapshot,owner:Address,margin:Address,userToken:Address,amount:bigint) {
    this.owned(snapshot,owner,margin);requireValue(amount>0n&&[0,1].includes(snapshot.safetyState.mode)&&!snapshot.safetyState.paused,'Deposit unavailable.');
    return protocol.getDepositAccountInstructionAsync({...snapshot,...await this.common(),...accountLiabilityMetas(snapshot.ledgers,[snapshot.roots[margin]]),owner:createNoopSigner(owner),margin,
      quoteMint:this.config.mint,userToken,amount});
  }
  async exit(snapshot:AccountSnapshot,owner:Address,margin:Address,userToken:Address,amount:bigint) {
    const root=this.owned(snapshot,owner,margin),safety=snapshot.safetyState;
    requireValue(amount>0n&&amount<=root.cash&&!safety.paused&&safety.mode!==2,'Funded exit unavailable.');
    const accounts={...snapshot,...await this.common(),...accountLiabilityMetas(snapshot.ledgers,[root]),owner:createNoopSigner(owner),margin,quoteMint:this.config.mint,userToken,amount};
    const instruction=safety.mode===0&&safety.resolutionEpoch===0n?
      await protocol.getWithdrawAccountCustodyInstructionAsync(accounts):
      protocol.getWithdrawFundedAccountInstruction({...accounts,...accountMarketMetas(snapshot.markets,[root]),guard:accountGuard(snapshot,margin)});
    // No verification-only page, certificate, sibling account or global sequence.
    return {instructions:[instruction]};
  }
  async transfer(snapshot:AccountSnapshot,owner:Address,donor:Address,recipient:Address,amount:bigint) {
    const source=this.owned(snapshot,owner,donor);this.owned(snapshot,owner,recipient);
    requireValue(donor!==recipient&&amount>0n&&amount<=source.cash&&!snapshot.safetyState.paused&&[0,1].includes(snapshot.safetyState.mode),'Funded transfer unavailable.');
    const accounts={...snapshot,...await this.common(),owner:createNoopSigner(owner),donor,recipient,amount};
    return snapshot.safetyState.mode===0?protocol.getTransferAccountCustodyInstructionAsync(accounts):
      protocol.getTransferFundedAccountInstruction({...accounts,...accountMarketMetas(snapshot.markets,[source,snapshot.roots[recipient]]),...accountLiabilityMetas(snapshot.ledgers,[source,snapshot.roots[recipient]]),guard:accountGuard(snapshot,donor)});
  }
  async manageOrder(snapshot:AccountSnapshot,actor:Address,margin:Address,marketIndex:0|1,operation:protocol.OrderActionArgs) {
    this.bound(snapshot);const root=snapshot.roots[margin];
    requireValue(root&&[0,1].includes(marketIndex)&&snapshot.safetyState.mode===1&&(root.mode===0||root.isolatedMarketIndex===marketIndex),'Account market unavailable.');
    requireValue(root.owner===actor||(root.delegate===actor&&snapshot.slot<root.delegateExpirySlot),'Live account trading authority required.');
    return protocol.getManageAccountOrderInstruction({...snapshot,...await this.common(),actor:createNoopSigner(actor),margin,
      ...accountMarketMetas(snapshot.markets,[root],1<<marketIndex),
      guard:accountGuard(snapshot,margin),marketIndex,operation});
  }
  async cancel(snapshot:AccountSnapshot,actor:Address,margin:Address,id:bigint,version:bigint,protectionGroup=false) {
    this.bound(snapshot);const root=snapshot.roots[margin];requireValue(root,'Unknown margin account.');
    const stored=root.book.orders.find(entry=>protectionGroup?entry.order.groupId===id:entry.order.id===id);
    requireValue(stored&&[0,1].includes(stored.marketIndex),'Unknown order/protection identity.');
    return this.manageOrder(snapshot,actor,margin,stored.marketIndex as 0|1,protocol.orderAction('Cancel',{id,version,protectionGroup}));
  }
  async setDelegate(snapshot:AccountSnapshot,owner:Address,margin:Address,delegate:Address,expirySlot:bigint) {
    this.owned(snapshot,owner,margin);requireValue([0,1].includes(snapshot.safetyState.mode),'Account authority unavailable.');
    requireValue(delegate==='11111111111111111111111111111111'?expirySlot===0n:expirySlot>snapshot.slot&&expirySlot<=snapshot.slot+216_000n,'Invalid delegate expiry.');
    return protocol.getSetAccountDelegateInstruction({...snapshot,...await this.common(),owner:createNoopSigner(owner),margin,
      guard:accountGuard(snapshot,margin),delegate,expirySlot});
  }
  async netClosedClaims(snapshot:AccountSnapshot,owner:Address,margin:Address,sourceMarketIndex:0|1,amount:bigint) {
    const root=this.owned(snapshot,owner,margin);
    requireValue(root.mode===0&&amount>0n&&[0,1].includes(sourceMarketIndex)&&root.positions.every(position=>position.lots===0n),'Netting requires a flat cross account and explicit amount.');
    const [[certificate],[registry]]=await Promise.all([deriveSettlementCertificate(snapshot.venue,sourceMarketIndex),deriveVenueComponent(snapshot.venue,'registry')]);
    return protocol.getNetAccountClaimsInstructionAsync({...snapshot,...await this.common(),owner:createNoopSigner(owner),margin,
      guard:accountGuard(snapshot,margin),sourceMarket:sourceMarketIndex,certificate,registry,amount});
  }
}
