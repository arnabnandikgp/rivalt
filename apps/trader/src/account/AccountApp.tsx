import { WalletMultiButton } from '@solana/wallet-adapter';
import { fixed, short } from '../amount.js';
import { terminal } from '../receipts.js';
import { Field, Metric, GroupReview, GroupReceipts } from '../group/Primitives.js';
import { GroupPositions, GroupTicket, GroupOrders, GroupAuthority, GroupFills } from '../group/GroupPanels.js';
import { GROUP_MARKETS } from '../group/model.js';
import { DemoPanel } from './DemoPanel.js';
import { accountLabel } from './model.js';
import { useAccountController, type AccountController } from './useAccountController.js';
import type { AccountTraderConfig } from './types.js';

function Selection({controller}: {controller: AccountController}) {
  const {portfolioIndex,setPortfolioIndex,subaccount,setSubaccount,marketIndex,setMarketIndex,accounts,root,portfolio,disabled,create}=controller;
  return <section className="panel group-selection">
    <Field label="Portfolio"><select value={portfolioIndex} onChange={event=>setPortfolioIndex(Number(event.target.value))}>
      {[0,1,2,3].map(index=><option key={index} value={index}>Portfolio {index}</option>)}
    </select></Field>
    <Field label="Margin account"><select value={subaccount} onChange={event=>setSubaccount(Number(event.target.value))}>
      {controller.offeredChoices.map(index=>{
        const account=accounts.find(([,value])=>value.subaccountIndex===index)?.[1];
        return <option key={index} value={index}>{account?accountLabel(account):index===0?'Cross · not registered':`Isolated ${index} · not registered`}</option>;
      })}
    </select></Field>
    <Field label="Market"><select value={marketIndex} disabled={root?.mode===1} onChange={event=>setMarketIndex(Number(event.target.value) as 0|1)}>
      {GROUP_MARKETS.map((market,index)=><option key={market.name} value={index}>{market.name}</option>)}
    </select></Field>
    {!root&&<button disabled={disabled} onClick={()=>void create()}>{portfolio?'Register account':'Create portfolio'}</button>}
    <p className="caption">Cross shares this account’s cash across BTC and ETH. Isolated uses only its selected market. Sibling accounts never supply collateral automatically. Account mode is fixed at creation.</p>
  </section>;
}
function Balances({controller}: {controller: AccountController}) {
  const {venue,view,root,snapshot,financialDisabled,collateral,setCollateral,amount,setAmount,recipient,setRecipient,accounts,margin,cash,allocate,net}=controller;
  return <section className="panel">
    <h2>Account collateral</h2>
    <dl className="account-metrics">
      <Metric label="Funded cash" value={fixed(root?.cash)} test="account-cash" hint="Test USD owned by this account" />
      <Metric label="Risk equity" value={fixed(view?.riskEquityScaled ?? undefined, 15)} test="account-equity" hint="Funded cash plus negative market claims" />
      <Metric label="Reserved for orders" value={fixed(root?.reserved)} test="account-reserved" />
      <Metric label="Indicative cash headroom" value={fixed(view?.indicativeCashHeadroom ?? undefined)} test="account-headroom" hint="Atomic funding, health and source checks still apply" />
    </dl>
    <p className="caption">Positive unpaid profit is not collateral or withdrawable cash. Withdrawal checks and the token transfer execute together; no venue-wide exit scan is needed.</p>
    {view&&<p className="caption">Balances and claims use finalized chain state. Transaction previews use current confirmed prices and account checks.</p>}
    <div className="form-grid">
      <Field label="Wallet collateral account"><select value={collateral} onChange={event=>setCollateral(event.target.value)}>
        <option value="">Choose token account</option>{venue.tokens.map(token=><option key={token.address} value={token.address}>{short(token.address)} · {fixed(token.amount)} test USD</option>)}
      </select></Field>
      <Field label="Collateral amount"><input value={amount} inputMode="decimal" onChange={event=>setAmount(event.target.value)}/></Field>
    </div>
    <div className="button-row">
      <button disabled={financialDisabled||!collateral||![0,1].includes(snapshot?.safetyState.mode??-1)} onClick={()=>void cash(false)}>Deposit</button>
      <button disabled={financialDisabled||!collateral} onClick={()=>void cash(true)}>Withdraw</button>
      <button disabled={financialDisabled||root?.mode!==0||snapshot?.safetyState.mode!==1} onClick={()=>void net()}>Net closed claims</button>
    </div>
    <p className="caption">Netting is explicit and flat-only. It uses the amount above and the selected market’s positive closed claim, subject to available certified backing.</p>
    <Field label="Allocate to account"><select value={recipient} onChange={event=>setRecipient(event.target.value)}>
      <option value="">Choose recipient</option>{accounts.filter(([key])=>key!==margin).map(([key,account])=><option key={key} value={key}>{accountLabel(account)}</option>)}
    </select></Field>
    <button disabled={financialDisabled||!recipient||![0,1].includes(snapshot?.safetyState.mode??-1)} onClick={()=>void allocate()}>Allocate collateral</button>
  </section>;
}
function Reserves({controller}: {controller: AccountController}) {
  return <section className="panel"><h2>Market reserves</h2>
    <p className="caption">25% of collected taker fees funds the originating market’s insurance; 75% remains protocol fees. Insurance is a market loss buffer, not your cash or a guarantee of profit payment. All makers and collateral in this environment are internal/test only.</p>
    <div className="table-scroll"><table><thead><tr><th>Market</th><th>Funded settlement pool</th><th>Insurance</th><th>Retained fees</th></tr></thead><tbody>
      {controller.snapshot?.ledgerStates.map((ledger,index)=><tr key={index}><td>{GROUP_MARKETS[index].name}</td><td>{fixed(ledger.settlement)}</td><td>{fixed(ledger.insurance)}</td><td>{fixed(ledger.fees)}</td></tr>)}
    </tbody></table></div>
  </section>;
}
export function AccountApp({config}: {config: AccountTraderConfig}) {
  const controller=useAccountController(config),{venue,snapshot}=controller;
  const mode=snapshot?.safetyState.mode;
  const status=snapshot?.safetyState.paused?'Venue paused':mode===2?'Resolution in progress':mode===3?'Resolution complete':mode===4?'Venue retired':mode===1?'Cross + isolated local test':'Local test venue';
  return <>
    <header className="topbar"><a className="wordmark" href="#">Rivalt<span className="brand-dot"/></a><span className="network">Local test venue · BTC + ETH · internal makers</span><div className="header-actions"><button onClick={()=>void venue.refresh()} disabled={Boolean(venue.busy)}>Refresh</button><WalletMultiButton/></div></header>
    <main onChange={venue.invalidate}>
      <div className="market-header"><div><span className="eyebrow">YOUR ACCOUNTS</span><h1>Manage your margin</h1><p>Fund each account. Trade its eligible markets. Withdraw available cash directly.</p></div><span className="status">{status}</span></div>
      {[venue.rpcError,venue.error].filter(Boolean).map((message,index)=><p key={index} className="banner error" role="alert">{message}</p>)}
      {venue.apiError&&<p className="banner warning" role="status">{venue.apiError}</p>}{venue.notice&&<p className="banner" role="status">{venue.notice}</p>}{venue.busy&&<p role="status">{venue.busy}</p>}
      {config.demo&&<DemoPanel controller={controller}/>}
      <Selection controller={controller}/><GroupReview venue={venue}/>
      <div className="trading-grid"><div className="market-column"><Balances controller={controller}/><GroupPositions controller={controller}/></div><GroupTicket controller={controller}/></div>
      <GroupOrders controller={controller}/><GroupAuthority controller={controller}/><GroupFills controller={controller}/><Reserves controller={controller}/><GroupReceipts venue={venue}/>
      <p className="caption">{venue.records.filter(record=>!terminal(record)).length} unresolved saved transaction(s). Test venue {short(config.venue)} · one collateral mint · no funded deployment.</p>
    </main>
  </>;
}
