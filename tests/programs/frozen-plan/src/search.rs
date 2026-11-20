//! A diagnostic covering every schedule against an authenticated, one-page book.
//! A tie on total recovery requires the later financial priorities and stays uncertified.
use super::*;
use default_plan_selection::joint::{Charge, FrozenBook, Member, Receipt, Witness};
use financial_core::clearing::row::Row;
use num_bigint::{BigInt, BigUint};
use num_integer::Integer;
use num_traits::ToPrimitive;

const MEMBERS: usize = 8;
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType)]
pub struct SearchMember {
    pub id: u64,
    pub cash: u64,
    pub claims: [i128; 2],
    pub lots: [i64; 2],
    pub histories: [[u8; 256]; 2],
}
#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, IdlType, Clone, Copy)]
pub struct SearchEdge {
    pub market: u8,
    pub debtor: u64,
    pub winner: u64,
    pub maximum: u64,
}
#[account(borsh)]
#[derive(InitSpace)]
pub struct RecoverySearch {
    pub prepared: Address,
    pub epoch: u64,
    pub revision: u64,
    pub proposed: u128,
    pub count: u128,
    pub cursor: u128,
    pub stage: u8,
    pub score_num: i128,
    pub score_den: u128,
    pub cash: [u64; 8],
    pub original: RateWitness,
    #[max_len(8)]
    pub rows: Vec<SearchMember>,
    // Two markets times eight possible debtors times seven other members.
    #[max_len(112)]
    pub edges: Vec<SearchEdge>,
}
#[derive(Accounts)]
#[instruction(nonce:u64)]
pub struct OpenSearch {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=8+RecoverySearch::INIT_SPACE,seeds=[b"search",payer.address().as_ref(),&nonce.to_le_bytes()],bump)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<Source>,
    pub system_program: Program<System>,
}
#[derive(Accounts)]
pub struct CaptureSearch {
    #[account(mut)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<Source>,
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub margin: Box<BorshAccount<MarginAccount>>,
}
#[derive(Accounts)]
pub struct AdvanceSearch {
    #[account(mut)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<Source>,
}

pub fn open(
    accounts: &mut OpenSearch,
    epoch: u64,
    proposed: u128,
    original: RateWitness,
) -> Result<()> {
    accounts.source.check(epoch)?;
    let header = &accounts.source.prepared;
    require!(header.count == MEMBERS as u64, ProofError::Unsupported);
    let search = &mut accounts.search;
    search.prepared = *header.address();
    search.epoch = epoch;
    search.revision = header.revision;
    search.proposed = proposed;
    search.original = original;
    Ok(())
}
fn stage(source: &Source, search: &RecoverySearch, expected: u8) -> Result<()> {
    source.check(search.epoch)?;
    require!(
        search.prepared == *source.prepared.address()
            && search.revision == source.prepared.revision
            && search.stage == expected,
        ProofError::Cursor
    );
    Ok(())
}
pub fn capture(accounts: &mut CaptureSearch, ordinal: u64) -> Result<()> {
    let search = &mut accounts.search;
    stage(&accounts.source, search, 0)?;
    require!(ordinal == search.rows.len() as u64, ProofError::Cursor);
    let header = &accounts.source.prepared;
    let row = source::row(header, &accounts.page, ordinal)?;
    source::original(row, header, &accounts.margin)?;
    let mut member = SearchMember {
        id: row.id,
        cash: row.cash,
        lots: row.lots,
        claims: row.claims,
        histories: [[0; 256]; 2],
    };
    for (market, history) in member.histories.iter_mut().enumerate() {
        clearing::frozen_history(&accounts.margin, market)?
            .write(history)
            .map_err(|_| ProofError::Source)?;
    }
    search.rows.push(member);
    if search.rows.len() == MEMBERS {
        search.stage = 1;
    }
    Ok(())
}
fn with_book<T>(
    search: &RecoverySearch,
    header: &PreparedSettlement,
    op: impl FnOnce(FrozenBook<'_>) -> Result<T>,
) -> Result<T> {
    let members: Vec<_> = search
        .rows
        .iter()
        .map(|row| Member {
            id: row.id,
            row: Row {
                cash: row.cash,
                claims: row.claims,
            },
            lots: row.lots,
            history: [&row.histories[0], &row.histories[1]],
        })
        .collect();
    op(FrozenBook {
        members: &members,
        marks: header.prices,
        pools: header.pools,
        insurance: header.insurance,
        fees: header.fees,
    })
}
impl RateWitness {
    fn with<T>(&self, op: impl FnOnce(Witness<'_>) -> T) -> T {
        let rates = self.proposal();
        let orders = self.orders();
        op(Witness {
            rates: &rates,
            orders: [&orders[0], &orders[1]],
        })
    }
}

pub fn dimensions(accounts: &mut AdvanceSearch) -> Result<()> {
    let search = &mut accounts.search;
    stage(&accounts.source, search, 1)?;
    let (edges, count) = with_book(search, &accounts.source.prepared, |book| {
        let budgets = search
            .original
            .with(|w| book.edge_budgets(w))
            .map_err(|_| ProofError::Accounting)?;
        let mut count = 1u128;
        let mut edges = Vec::new();
        book.visit_edges(&budgets, |edge| {
            count = count
                .checked_mul(u128::from(edge.maximum) + 1)
                .ok_or(financial_core::Error::Bounds)?;
            edges.push(SearchEdge {
                market: edge.market as u8,
                debtor: book.members[edge.debtor].id,
                winner: book.members[edge.winner].id,
                maximum: edge.maximum,
            });
            Ok(true)
        })
        .map_err(|_| ProofError::Unsupported)?;
        Ok((edges, count))
    })?;
    require!(search.proposed < count, ProofError::Charge);
    search.edges = edges;
    search.count = count;
    search.stage = 2;
    Ok(())
}
// Zero-based mixed radix with the last pair as the least significant digit.
fn charges(edges: &[SearchEdge], mut rank: u128) -> Vec<Charge> {
    let mut charges = Vec::new();
    for edge in edges.iter().rev() {
        let radix = u128::from(edge.maximum) + 1;
        let atoms = (rank % radix) as u64;
        rank /= radix;
        if atoms > 0 {
            charges.push(Charge {
                market: usize::from(edge.market),
                debtor: edge.debtor,
                winner: edge.winner,
                atoms,
            });
        }
    }
    charges.reverse();
    charges
}
fn evaluate(
    search: &RecoverySearch,
    header: &PreparedSettlement,
    rank: u128,
    after: &RateWitness,
) -> Result<Option<Receipt>> {
    let charges = charges(&search.edges, rank);
    with_book(search, header, |book| {
        match search.original.with(|before| {
            after.with(|effective| book.verify_proposal(before, effective, &charges))
        }) {
            Ok(receipt) => Ok(Some(receipt)),
            Err(financial_core::Error::Entitlement) => Ok(None),
            Err(_) => Err(ProofError::Accounting.into()),
        }
    })
}
fn total(receipt: &Receipt) -> (BigInt, BigUint) {
    let [(btc_numerator, btc_denominator), (eth_numerator, eth_denominator)] = &receipt.recovered;
    let num = btc_numerator * BigInt::from(eth_denominator.clone())
        + eth_numerator * BigInt::from(btc_denominator.clone());
    let den = btc_denominator * eth_denominator;
    let gcd = num.magnitude().gcd(&den);
    (num / BigInt::from(gcd.clone()), den / gcd)
}
pub fn propose(accounts: &mut AdvanceSearch, after: RateWitness) -> Result<()> {
    let search = &mut accounts.search;
    stage(&accounts.source, search, 2)?;
    let receipt = evaluate(search, &accounts.source.prepared, search.proposed, &after)?
        .ok_or(ProofError::Charge)?;
    let (num, den) = total(&receipt);
    search.score_num = num.to_i128().ok_or(ProofError::Unsupported)?;
    search.score_den = den.to_u128().ok_or(ProofError::Unsupported)?;
    search.cash = receipt
        .rounded
        .cash
        .try_into()
        .map_err(|_| ProofError::Accounting)?;
    search.stage = 3;
    Ok(())
}
pub fn leaf(accounts: &mut AdvanceSearch, rank: u128, after: RateWitness) -> Result<()> {
    let search = &mut accounts.search;
    stage(&accounts.source, search, 3)?;
    require!(
        rank == search.cursor && rank < search.count,
        ProofError::Cursor
    );
    if rank != search.proposed {
        if let Some(contender) = evaluate(search, &accounts.source.prepared, rank, &after)? {
            let (num, den) = total(&contender);
            require!(
                num * BigInt::from(search.score_den)
                    < BigInt::from(search.score_num) * BigInt::from(den),
                ProofError::Priority
            );
        }
    }
    search.cursor += 1;
    Ok(())
}
/// Sum of the largest digit in the interval for each pair. These maxima need
/// not occur together, so this can overestimate but never omit a recovery.
fn charge_upper_bound(edges: &[SearchEdge], first: u128, last: u128) -> Result<u128> {
    let mut stride = 1u128;
    let mut upper = 0u128;
    for edge in edges.iter().rev() {
        let cycle = stride
            .checked_mul(u128::from(edge.maximum) + 1)
            .ok_or(ProofError::Accounting)?;
        let maximum = if first / cycle == last / cycle {
            (last % cycle) / stride
        } else {
            u128::from(edge.maximum)
        };
        upper = upper.checked_add(maximum).ok_or(ProofError::Accounting)?;
        stride = cycle;
    }
    Ok(upper)
}
pub fn skip(accounts: &mut AdvanceSearch, first: u128, last: u128) -> Result<()> {
    let search = &mut accounts.search;
    stage(&accounts.source, search, 3)?;
    require!(
        first == search.cursor && first <= last && last < search.count,
        ProofError::Cursor
    );
    let upper = charge_upper_bound(&search.edges, first, last)?;
    // D120 caps the loss actually removed in each market by the atoms charged.
    // Strict inequality preserves all financial ties for subsequent verification.
    require!(
        BigInt::from(upper) * BigInt::from(search.score_den) < BigInt::from(search.score_num),
        ProofError::Priority
    );
    search.cursor = last + 1;
    Ok(())
}
pub fn close(accounts: &mut AdvanceSearch) -> Result<()> {
    let search = &mut accounts.search;
    stage(&accounts.source, search, 3)?;
    require!(search.cursor == search.count, ProofError::Incomplete);
    search.stage = 4;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edges(maxima: &[u64]) -> Vec<SearchEdge> {
        maxima
            .iter()
            .map(|&maximum| SearchEdge {
                market: 0,
                debtor: 1,
                winner: 2,
                maximum,
            })
            .collect()
    }

    #[test]
    fn interval_charge_bound_covers_every_rank_and_is_exact_for_singletons() {
        for maxima in [&[][..], &[0][..], &[1, 2, 3][..], &[3, 0, 1, 2][..]] {
            let edges = edges(maxima);
            // Build the book in lexicographic order without using rank/stride arithmetic.
            let mut sums = vec![0u128];
            for &maximum in maxima {
                sums = sums
                    .iter()
                    .flat_map(|&prefix| (0..=maximum).map(move |digit| prefix + u128::from(digit)))
                    .collect();
            }
            for first in 0..sums.len() {
                let mut highest = sums[first];
                for (last, &value) in sums.iter().enumerate().skip(first) {
                    highest = highest.max(value);
                    let bound = charge_upper_bound(&edges, first as u128, last as u128).unwrap();
                    assert!(bound >= highest);
                    if last == first {
                        assert_eq!(bound, value);
                    }
                }
            }
        }
    }

    #[test]
    fn two_full_u64_digits_exceed_the_representable_domain() {
        assert!(charge_upper_bound(&edges(&[u64::MAX, u64::MAX]), 0, u128::MAX).is_err());
        assert_eq!(
            charge_upper_bound(&edges(&[u64::MAX]), 7, u64::MAX.into()).unwrap(),
            u128::from(u64::MAX)
        );
    }
}
