import {AccountRole, getAddressEncoder, getProgramDerivedAddress, type Address, type Instruction,
  type TransactionSigner} from '@solana/kit';
import * as clearing from './generated/index.js';
import {deriveAccountMarket, deriveMarginAccount, deriveMarketLedger, deriveVenueComponent} from './account-addresses.js';
import {hasDirectCredit} from './account-deployment.js';
import {requiredAccountLiabilities} from './account-markets.js';
import {marketCheckpointsFor, venueMarketCheckpoints} from './market-checkpoints.js';
import {requireValue} from './wallet-client.js';

export async function deriveCoverageLane(venue: Address, index: number): Promise<Address> {
  requireValue(Number.isInteger(index) && index >= 0 && index < 8, 'Invalid coverage lane.');
  const [lane] = await getProgramDerivedAddress({programAddress:clearing.CLEARING_PROGRAM_ADDRESS,
    seeds:[new TextEncoder().encode('coverage-lane'),getAddressEncoder().encode(venue),Uint8Array.of(index)]});
  return lane;
}

export function deriveCoverageLanes(venue: Address): Promise<Address[]> {
  return Promise.all(Array.from({length:8}, (_,index) => deriveCoverageLane(venue,index)));
}

/** Permissionless local credit. Submit the complete returned instruction list in one transaction. */
export async function directClosedProfitCredit(input: {artifactSet: string; actor: TransactionSigner;
  margin: clearing.MarginAccount; marketIndex: 0|1; amount: bigint}): Promise<Instruction[]> {
  const {margin,actor,marketIndex,amount} = input, venue = margin.venue;
  requireValue(hasDirectCredit(input.artifactSet),'Direct credit requires its qualified local deployment.');
  requireValue(margin.lifecycle===2 && (marketIndex===0 || marketIndex===1) && amount>0n,'Invalid financial member, market or credit amount.');
  const [[recipient],[registry],[btc],[eth],lanes,checkpoints] = await Promise.all([
    deriveMarginAccount(margin.portfolio,margin.subaccountIndex),deriveVenueComponent(venue,'registry'),
    deriveAccountMarket(venue,0),deriveAccountMarket(venue,1),deriveCoverageLanes(venue),venueMarketCheckpoints(venue),
  ]);
  const required = requiredAccountLiabilities([margin],1<<marketIndex);
  const [[btcLedger],[ethLedger]] = await Promise.all([deriveMarketLedger(btc),deriveMarketLedger(eth)]);
  const credit = await clearing.getPayAccountGainInstructionAsync({venue,registry,btc,eth,
    btcLedger:required&1?btcLedger:undefined,ethLedger:required&2?ethLedger:undefined,actor,margin:recipient,
    program:clearing.CLEARING_PROGRAM_ADDRESS,marketIndex,amount});
  const writable = Number(margin.id%8n);
  const instruction = {...credit,accounts:[...credit.accounts,...lanes.map((address,index)=>({
    address,role:index===writable?AccountRole.WRITABLE:AccountRole.READONLY,
  }))]};
  return [...marketCheckpointsFor(checkpoints,instruction),instruction];
}
