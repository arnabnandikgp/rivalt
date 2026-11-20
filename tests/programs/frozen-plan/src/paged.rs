//! Measure a complete protected payout from the same frozen inputs as clearing.
//! This instruction has no writable accounts and produces only a return digest.
use super::*;
use default_plan_selection::joint::{Charge, FrozenBook, Member, Witness};
use financial_core::clearing::{row::Row, scalable::settlement::Proposal};

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct PagedWitness {
    pub rates: Vec<[u64; 3]>,
    pub orders: [Vec<u8>; 2],
}
impl PagedWitness {
    fn materialize(&self, count: usize) -> Result<(Vec<Proposal>, [Vec<u64>; 2])> {
        require!(
            (1..=3).contains(&self.rates.len())
                && self.orders.iter().all(|order| order.len() == count),
            ProofError::Source
        );
        let proposals = self
            .rates
            .iter()
            .map(|&[factor, btc, eth]| Proposal {
                factor: u128::from(factor).into(),
                rates: [u128::from(btc).into(), u128::from(eth).into()],
            })
            .collect();
        Ok((
            proposals,
            self.orders
                .each_ref()
                .map(|order| order.iter().copied().map(u64::from).collect()),
        ))
    }
}

struct FrozenInput {
    id: u64,
    lots: [i64; 2],
    row: Row,
    histories: [Vec<u8>; 2],
}

#[inline(never)]
fn capture(
    header: &PreparedSettlement,
    page: &BorshAccount<FrozenMarginPage>,
    account: &AccountView,
    ordinal: u64,
) -> Result<FrozenInput> {
    let row = source::row(header, page, ordinal)?;
    let root = Box::<BorshAccount<MarginAccount>>::load(account.clone())?;
    source::original(row, header, &root)?;
    let mut histories = [vec![0u8; 256], vec![0u8; 256]];
    for (market, bytes) in histories.iter_mut().enumerate() {
        read_profit_history(&root, market)?
            .write(bytes)
            .map_err(|_| ProofError::Source)?;
    }
    Ok(FrozenInput {
        id: row.id,
        lots: row.lots,
        row: Row {
            cash: row.cash,
            claims: row.claims,
        },
        histories,
    })
}

#[inline(never)]
pub fn measure(
    ctx: &mut Context<AuditSettlement>,
    epoch: u64,
    revision: u64,
    original: PagedWitness,
    effective: PagedWitness,
    legs: Vec<[u64; 4]>,
) -> Result<[u8; 32]> {
    let extra = ctx.remaining_accounts()?;
    let accounts = &ctx.accounts;
    accounts.source.check(epoch)?;
    let header = &accounts.source.prepared;
    let count = usize::try_from(header.count).map_err(|_| ProofError::Source)?;
    let pages = count.div_ceil(8);
    require!(
        revision == header.revision
            && pages > 0
            && pages <= extra.len() + 1
            && extra.len() - (pages - 1) == count,
        ProofError::Source
    );
    let (other_pages, roots) = extra.split_at(pages - 1);
    let mut rows = Vec::with_capacity(count);
    for (index, group) in roots.chunks(8).enumerate() {
        let next;
        let page = if index == 0 {
            &accounts.page
        } else {
            next = Box::<BorshAccount<FrozenMarginPage>>::load(other_pages[index - 1].clone())?;
            &next
        };
        require!(
            usize::from(page.row_count) == group.len(),
            ProofError::Source
        );
        for (offset, account) in group.iter().enumerate() {
            rows.push(capture(header, page, account, (8 * index + offset) as u64)?);
        }
    }
    let members: Vec<_> = rows
        .iter()
        .map(|row| Member {
            id: row.id,
            lots: row.lots,
            row: row.row,
            history: [&row.histories[0], &row.histories[1]],
        })
        .collect();
    let book = FrozenBook {
        members: &members,
        marks: header.prices,
        pools: header.pools,
        insurance: header.insurance,
        fees: header.fees,
    };
    let (before, before_orders) = original.materialize(count)?;
    let (after, after_orders) = effective.materialize(count)?;
    let charges = legs
        .into_iter()
        .map(|[market, debtor, winner, atoms]| Charge {
            market: market as usize,
            debtor,
            winner,
            atoms,
        })
        .collect::<Vec<_>>();
    let result = book
        .verify_proposal(
            Witness {
                rates: &before,
                orders: [&before_orders[0], &before_orders[1]],
            },
            Witness {
                rates: &after,
                orders: [&after_orders[0], &after_orders[1]],
            },
            &charges,
        )
        .map_err(|_| ProofError::Accounting)?;
    let mut digest = hashv(&[
        b"Rivalt/paged-recovery-measurement/v1",
        header.venue.as_ref(),
        &epoch.to_le_bytes(),
        &revision.to_le_bytes(),
        &header.count.to_le_bytes(),
        &result.rounded.remaining_insurance[0].to_le_bytes(),
        &result.rounded.remaining_insurance[1].to_le_bytes(),
    ])
    .to_bytes();
    for (index, member) in members.iter().enumerate() {
        let [btc, eth] = result.rounded.movements[index];
        digest = hashv(&[
            &digest,
            &member.id.to_le_bytes(),
            &result.rounded.cash[index].to_le_bytes(),
            &btc.to_le_bytes(),
            &eth.to_le_bytes(),
        ])
        .to_bytes();
    }
    Ok(digest)
}
