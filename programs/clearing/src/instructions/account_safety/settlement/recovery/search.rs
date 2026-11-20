//! Restartable verification of every schedule against an authenticated, one-page book.
//! Ties use the frozen-book financial priorities. Incomparable plans stay unsealed.
use super::priority::{episode_order, Priorities};
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
    pub movements: [[i64; 2]; MEMBERS],
    pub remaining_insurance: [u64; 2],
    pub retained_fees: [u64; 2],
    pub original: RateWitness,
    #[max_len(8)]
    pub rows: Vec<SearchMember>,
    // Two markets times eight possible debtors times seven other members.
    #[max_len(112)]
    pub edges: Vec<SearchEdge>,
    pub budgets: [[u64; 2]; MEMBERS],
    pub weights: [[u64; 2]; MEMBERS],
    pub priority: Priorities,
}
#[derive(Accounts)]
#[instruction(nonce:u64)]
pub struct OpenSearch {
    #[account(mut)]
    pub payer: Signer,
    #[account(init,payer=payer,space=8+RecoverySearch::INIT_SPACE,seeds=[b"search",payer.address().as_ref(),&nonce.to_le_bytes()],bump)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<RecoverySource>,
    pub system_program: Program<System>,
}
#[derive(Accounts)]
pub struct CaptureSearch {
    #[account(mut)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<RecoverySource>,
    pub page: Box<BorshAccount<FrozenMarginPage>>,
    pub margin: Box<BorshAccount<MarginAccount>>,
}
#[derive(Accounts)]
pub struct AdvanceSearch {
    #[account(mut)]
    pub search: Box<BorshAccount<RecoverySearch>>,
    pub source: Nested<RecoverySource>,
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
fn stage(source: &RecoverySource, search: &RecoverySearch, expected: u8) -> Result<()> {
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
        read_profit_history(&accounts.margin, market)?
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
    let (edges, count, budgets, weights) = with_book(search, &accounts.source.prepared, |book| {
        let budgets = search
            .original
            .with(|w| book.edge_budgets(w))
            .map_err(|_| ProofError::Accounting)?;
        let mut count = 1u128;
        let mut edges = Vec::new();
        let mut full_edges = Vec::new();
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
            full_edges.push(edge);
            Ok(true)
        })
        .map_err(|_| ProofError::Unsupported)?;
        let weights = default_plan_selection::joint_priority::weights(&book, &full_edges)
            .map_err(|_| ProofError::Accounting)?;
        Ok((
            edges,
            count,
            budgets.try_into().map_err(|_| ProofError::Accounting)?,
            weights.try_into().map_err(|_| ProofError::Accounting)?,
        ))
    })?;
    require!(search.proposed < count, ProofError::Charge);
    search.edges = edges;
    search.count = count;
    search.budgets = budgets;
    search.weights = weights;
    search.stage = 2;
    Ok(())
}
// Zero-based mixed radix with the last pair as the least significant digit.
pub(super) fn charges(edges: &[SearchEdge], mut rank: u128) -> Vec<Charge> {
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
    search.priority =
        Priorities::verified(search, &receipt, &charges(&search.edges, search.proposed))?;
    search.remaining_insurance = receipt.rounded.remaining_insurance;
    search.retained_fees = receipt.rounded.retained_fees;
    search.movements = receipt
        .rounded
        .movements
        .try_into()
        .map_err(|_| ProofError::Accounting)?;
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
            let order = (num * BigInt::from(search.score_den))
                .cmp(&(BigInt::from(search.score_num) * BigInt::from(den)));
            if order.is_eq() {
                let challenger = charges(&search.edges, rank);
                let priority = Priorities::verified(search, &contender, &challenger)?;
                match search.priority.financial_order(&priority) {
                    Some(core::cmp::Ordering::Greater) => (),
                    Some(core::cmp::Ordering::Equal) => {
                        let incumbent = charges(&search.edges, search.proposed);
                        require!(
                            episode_order(
                                search,
                                &accounts.source.prepared.venue,
                                &incumbent,
                                &challenger
                            )?
                            .is_gt(),
                            ProofError::Priority
                        );
                    }
                    _ => return Err(ProofError::Priority.into()),
                }
            } else {
                require!(order.is_lt(), ProofError::Priority);
            }
        }
    }
    search.cursor += 1;
    Ok(())
}
/// Sum of the largest digit in the interval for each pair. These maxima need
/// not occur together, so this can overestimate but never omit a recovery.
#[cfg(test)]
fn charge_upper_bound(edges: &[SearchEdge], first: u128, last: u128) -> Result<u128> {
    let mut upper = 0u128;
    visit_digits(edges, first, last, |_, _, maximum| {
        upper = upper.checked_add(maximum).ok_or(ProofError::Accounting)?;
        Ok(())
    })?;
    Ok(upper)
}
fn visit_digits(
    edges: &[SearchEdge],
    first: u128,
    last: u128,
    mut visit: impl FnMut(&SearchEdge, u128, u128) -> Result<()>,
) -> Result<()> {
    let mut stride = 1u128;
    for edge in edges.iter().rev() {
        let cycle = stride
            .checked_mul(u128::from(edge.maximum) + 1)
            .ok_or(ProofError::Accounting)?;
        let (minimum, maximum) = if first / cycle == last / cycle {
            ((first % cycle) / stride, (last % cycle) / stride)
        } else {
            (0, u128::from(edge.maximum))
        };
        visit(edge, minimum, maximum)?;
        stride = cycle;
    }
    Ok(())
}
fn bounded_recovery(search: &RecoverySearch, first: u128, last: u128) -> Result<Option<u128>> {
    let mut minimum = [[0u128; 2]; MEMBERS];
    let mut maximum = minimum;
    visit_digits(&search.edges, first, last, |edge, low, high| {
        let debtor = search
            .rows
            .binary_search_by_key(&edge.debtor, |row| row.id)
            .map_err(|_| ProofError::Source)?;
        minimum[debtor][edge.market as usize] += low;
        maximum[debtor][edge.market as usize] += high;
        Ok(())
    })?;
    let mut upper = 0u128;
    for (debtor, budgets) in search.budgets.iter().enumerate() {
        for (market, &budget) in budgets.iter().enumerate() {
            if minimum[debtor][market] > u128::from(budget) {
                return Ok(None);
            }
            upper += maximum[debtor][market].min(u128::from(budget));
        }
    }
    Ok(Some(upper))
}
pub fn skip(accounts: &mut AdvanceSearch, first: u128, last: u128) -> Result<()> {
    let search = &mut accounts.search;
    stage(&accounts.source, search, 3)?;
    require!(
        first == search.cursor && first <= last && last < search.count,
        ProofError::Cursor
    );
    let bound = bounded_recovery(search, first, last)?;
    // D120 caps the loss actually removed in each market by the atoms charged.
    // Strict inequality preserves all financial ties for subsequent verification.
    require!(
        bound.is_none_or(|upper| BigInt::from(upper) * BigInt::from(search.score_den)
            < BigInt::from(search.score_num)),
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
    fn budget_bounds_preserve_all_feasible_alternatives_even_across_digit_wraps() {
        let rows = (4..6)
            .map(|id| SearchMember {
                id,
                cash: 0,
                claims: [0; 2],
                lots: [0; 2],
                histories: [[0; 256]; 2],
            })
            .collect();
        let mut edge_list = edges(&[2, 2, 2]);
        for (edge, (debtor, market)) in edge_list.iter_mut().zip([(4, 0), (4, 0), (5, 1)]) {
            edge.debtor = debtor;
            edge.market = market;
        }
        let mut budgets = [[0; 2]; MEMBERS];
        budgets[0][0] = 2;
        budgets[1][1] = 1;
        let search = RecoverySearch {
            rows,
            edges: edge_list,
            budgets,
            prepared: Address::default(),
            epoch: 1,
            revision: 0,
            proposed: 0,
            count: 27,
            cursor: 0,
            stage: 3,
            score_num: 0,
            score_den: 1,
            cash: [0; 8],
            movements: [[0; 2]; 8],
            remaining_insurance: [0; 2],
            retained_fees: [0; 2],
            original: Default::default(),
            weights: [[0; 2]; MEMBERS],
            priority: Default::default(),
        };
        let mut possible = Vec::new();
        for first_btc in 0..=2 {
            for second_btc in 0..=2 {
                for eth in 0..=2 {
                    possible.push(
                        (first_btc + second_btc <= 2 && eth <= 1)
                            .then_some(first_btc + second_btc + eth),
                    );
                }
            }
        }
        for first in 0..possible.len() {
            for last in first..possible.len() {
                let actual = possible[first..=last].iter().copied().flatten().max();
                let bound = bounded_recovery(&search, first as u128, last as u128).unwrap();
                if let Some(achieved) = actual {
                    assert!(bound.is_some_and(|upper| upper >= achieved));
                }
                if first == last {
                    assert_eq!(bound, actual);
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
