//! Fresh local coverage lanes. Only the direct-credit profile can use them for payment.
//! Recording is permissionless and can only copy the canonical clearing-owned financial root.
#[cfg(feature = "verified-coverage")]
mod backing;
#[cfg(feature = "grouped-credit")]
mod groups;
mod lane;
use lane::LaneHeader;
#[cfg(feature = "maintained-coverage")]
pub(crate) mod maintenance;
use crate::{engine, instructions::account_cash::Snapshot, state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use financial_core::backing::{
    coverage::{self, Bounds, Row},
    MarketRegion, Region,
};

const LANES: usize = 8;
// Fresh local deployments reserve all row space at genesis. The layout and
// admission limit belong to the binary that opened the lane.
const ROWS_PER_LANE: usize = if cfg!(feature = "thousand-member-credit") {
    125
} else {
    16
};

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy, PartialEq, Eq, IdlType)]
pub struct CoverageMember {
    pub id: u64,
    pub cash: u64,
    pub lots: [i64; 2],
    pub fixed: [i128; 2],
}

#[account(borsh)]
pub struct CoverageLane {
    pub venue: Address,
    pub lane: u8,
    pub bump: u8,
    pub membership_epoch: u64,
    pub anchor: [i128; 2],
    pub claim: [i128; 2],
    pub funded: [i128; 2],
    pub funded_both: i128,
    pub lots: [[i64; 2]; 2],
    pub radius: [[i128; 2]; 4],
    pub members: Vec<CoverageMember>,
}

impl CoverageLane {
    const ROW_SPACE: usize =
        8 + 32 + 2 + 8 + 32 + 80 + 32 + 128 + 4 + ROWS_PER_LANE * CoverageMember::INIT_SPACE;

    #[cfg(feature = "grouped-credit")]
    const SPACE: usize = Self::ROW_SPACE + backing::Totals::INIT_SPACE + groups::SPACE;
    #[cfg(all(feature = "verified-coverage", not(feature = "grouped-credit")))]
    const SPACE: usize = Self::ROW_SPACE + backing::Totals::INIT_SPACE;
    #[cfg(not(feature = "verified-coverage"))]
    const SPACE: usize = Self::ROW_SPACE;

    fn bounds(&self) -> Bounds {
        Bounds {
            claim: self.claim,
            funded: self.funded,
            funded_both: self.funded_both,
            lots: self.lots,
        }
    }
}

#[derive(Accounts)]
#[instruction(lane: u8)]
pub struct OpenCoverageLane {
    #[account(mut)]
    pub payer: Signer,
    #[account(seeds=[b"venue-v3", &venue.domain], bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"registry-v3",venue.address().as_ref()],bump=registry.bump,has_one=venue)]
    pub registry: Box<BorshAccount<VenueRegistry>>,
    #[account(address=venue.markets[0], has_one=venue)]
    pub btc: Box<BorshAccount<Market>>,
    #[account(address=venue.markets[1], has_one=venue)]
    pub eth: Box<BorshAccount<Market>>,
    #[account(init, payer=payer, space=CoverageLane::SPACE,
        seeds=[b"coverage-lane",venue.address().as_ref(), &[lane]], bump)]
    pub body: Box<BorshAccount<CoverageLane>>,
    pub system_program: Program<System>,
}

pub fn open(ctx: &mut Context<OpenCoverageLane>, lane: u8) -> Result<()> {
    require!(usize::from(lane) < LANES, ClearingError::Profile);
    let accounts = &mut ctx.accounts;
    let anchor = [accounts.btc.reference_price, accounts.eth.reference_price];
    #[cfg(feature = "maintained-coverage")]
    let anchor = {
        // Fresh genesis only. All lanes are opened before the first financial join.
        require!(
            accounts.registry.membership_epoch == 1 && accounts.registry.financial_count == 0,
            ClearingError::ExitCohort
        );
        // Markets can be unsampled during genesis. The anchor only affects the tightness of a bound.
        anchor.map(|price| price.max(1))
    };
    require!(
        anchor
            .iter()
            .all(|price| (1..=financial_core::MAX_PRICE).contains(price)),
        ClearingError::Profile
    );
    let body = &mut accounts.body;
    body.venue = *accounts.venue.address();
    body.lane = lane;
    body.membership_epoch = accounts.registry.membership_epoch;
    body.bump = ctx.bumps.body;
    body.anchor = [
        engine::checked(financial_core::scaled(anchor[0]))?,
        engine::checked(financial_core::scaled(anchor[1]))?,
    ];
    body.radius = [[i128::MAX; 2]; 4];
    Ok(())
}

#[derive(Accounts)]
pub struct RecordCoverageRow {
    #[account(seeds=[b"margin-v3",margin.portfolio.as_ref(),&margin.subaccount_index.to_le_bytes()],bump=margin.bump)]
    pub margin: Box<BorshAccount<MarginAccount>>,
    #[account(mut,seeds=[b"coverage-lane",margin.venue.as_ref(),&[(margin.id % 8) as u8]],bump=body.bump,
        constraint=body.venue==margin.venue && u64::from(body.lane)==margin.id%8 @ ClearingError::Profile)]
    pub body: Box<BorshAccount<CoverageLane>>,
}

pub fn record(ctx: &mut Context<RecordCoverageRow>) -> Result<()> {
    require!(
        !cfg!(feature = "maintained-coverage"),
        ClearingError::Profile
    );
    let image = CoverageMember::from_root(&ctx.accounts.margin)?;
    include(&mut ctx.accounts.body, image)
}

impl CoverageMember {
    pub(super) fn from_root(margin: &MarginAccount) -> Result<Self> {
        let row = engine::checked(Row::from_margin(&engine::account::model(margin)?))?;
        Ok(Self {
            id: margin.id,
            cash: row.cash,
            lots: row.lots,
            fixed: row.fixed,
        })
    }
}

fn include(body: &mut CoverageLane, image: CoverageMember) -> Result<()> {
    let row = Row {
        cash: image.cash,
        lots: image.lots,
        fixed: image.fixed,
    };
    let (sample, radius) = engine::checked(Bounds::at_anchor(row, body.anchor))?;
    let bounds = if body.members.is_empty() {
        sample
    } else {
        body.bounds().include(sample)
    };
    body.claim = bounds.claim;
    body.funded = bounds.funded;
    body.funded_both = bounds.funded_both;
    body.lots = bounds.lots;
    let class = usize::from(row.lots[0] != 0) | usize::from(row.lots[1] != 0) << 1;
    for (floor, sample) in body.radius[class].iter_mut().zip(radius) {
        *floor = (*floor).min(sample);
    }
    if let Some(existing) = body.members.iter_mut().find(|member| member.id == image.id) {
        *existing = image;
    } else {
        require!(body.members.len() < ROWS_PER_LANE, ClearingError::Profile);
        body.members.push(image);
    }
    Ok(())
}

#[derive(Accounts)]
pub struct ObserveCoverage {
    #[account(seeds=[b"venue-v3", &venue.domain], bump=venue.bump)]
    pub venue: Box<BorshAccount<Venue>>,
    #[account(seeds=[b"registry-v3",venue.address().as_ref()],bump=registry.bump,has_one=venue)]
    pub registry: Box<BorshAccount<VenueRegistry>>,
    #[account(address=venue.markets[0], has_one=venue)]
    pub btc: Box<BorshAccount<Market>>,
    #[account(address=venue.markets[1], has_one=venue)]
    pub eth: Box<BorshAccount<Market>>,
}

/// Return 1 for covered, 0 for underfunded. Missing inputs fail the observation.
/// This diagnostic's fixed cohort is additionally audited against the finalized journal.
pub fn observe(ctx: &mut Context<ObserveCoverage>, target: u8) -> Result<u64> {
    let target = usize::from(target);
    let remaining = ctx.remaining_accounts()?;
    let accounts = &ctx.accounts;
    require!(
        target < 2
            && remaining.len()
                == LANES
                    + if cfg!(feature = "verified-coverage") {
                        2
                    } else {
                        0
                    },
        ClearingError::ExitCohort
    );
    #[cfg(feature = "verified-coverage")]
    let (lanes, pool) = (
        &remaining[2..],
        backing::pool(accounts, &remaining[..2], target)?,
    );
    #[cfg(not(feature = "verified-coverage"))]
    let lanes = &remaining[..];
    let snapshot = Snapshot::new([&accounts.btc, &accounts.eth], &Clock::get()?)?;
    let covered = market_backed(
        accounts.venue.address(),
        &accounts.registry,
        &snapshot,
        target,
        lanes,
        #[cfg(feature = "verified-coverage")]
        pool,
    )?;
    Ok(u64::from(covered))
}

// Both the observer and the credit instruction authenticate the market and ledger accounts
// in their own context. This part authenticates every lane against the live venue registry.
#[inline(never)]
pub(crate) fn market_backed(
    venue: &Address,
    registry: &VenueRegistry,
    snapshot: &Snapshot,
    target: usize,
    lanes: &[AccountView],
    #[cfg(feature = "verified-coverage")] pool: u64,
) -> Result<bool> {
    require!(
        target < 2 && lanes.len() == LANES,
        ClearingError::ExitCohort
    );
    #[cfg(feature = "verified-coverage")]
    let mut check = backing::MarketCheck::default();
    let region = Region {
        markets: std::array::from_fn(|market| MarketRegion {
            price_low: snapshot.risks[market].lower,
            price_high: snapshot.risks[market].upper,
            funding_low: snapshot.bounds[market][0],
            funding_high: snapshot.bounds[market][1],
        }),
    };
    let prices = engine::checked(coverage::endpoints(region))?;
    let mut members = 0u64;
    let mut exact = 0u64;
    let mut covered = true;
    for (index, view) in lanes.iter().enumerate() {
        let bytes = view.try_borrow()?;
        let epoch = if cfg!(feature = "maintained-coverage") {
            1
        } else {
            registry.membership_epoch
        };
        let lane = LaneHeader::authenticate(view, &bytes, venue, epoch)?;
        require!(usize::from(lane.lane) == index, ClearingError::ExitCohort);
        members += lane.count() as u64;
        #[cfg(feature = "grouped-credit")]
        {
            let both_open = check.include_totals(backing::Totals::read(view)?, target)?;
            for start in (0..lane.count()).step_by(groups::WIDTH) {
                let end = (start + groups::WIDTH).min(lane.count());
                let group = groups::read(&bytes, start / groups::WIDTH, end - start)?;
                if both_open && !group.cross_credit[target].contains(prices[target]) {
                    check.require_sibling(target);
                }
                if group.covers(prices) {
                    continue;
                }
                for row in lane.rows(&bytes, start..end) {
                    let row = row?;
                    exact += 1;
                    covered &= engine::checked(financial_core::backing::projected::covers(
                        row.cash, row.lots, row.fixed, target, prices,
                    ))?;
                }
            }
        }
        #[cfg(not(feature = "grouped-credit"))]
        {
            #[cfg(feature = "verified-coverage")]
            check.add(
                backing::Totals::read(view)?,
                lane.members(&bytes),
                target,
                prices,
            )?;
            if lane.count() == 0 {
                continue;
            }
            let moves = engine::checked(coverage::displacements(prices, lane.anchor))?;
            if engine::checked(lane.bounds().proves(target, moves))?
                || coverage::radius_proves(lane.radius, target, moves)
            {
                continue;
            }
            for row in lane.members(&bytes) {
                let row = row?;
                exact += 1;
                covered &= engine::checked(financial_core::backing::projected::covers(
                    row.cash, row.lots, row.fixed, target, prices,
                ))?;
            }
        }
    }
    require!(
        members != 0 && members == registry.financial_count,
        ClearingError::ExitCohort
    );
    #[cfg(feature = "verified-coverage")]
    check.finish(snapshot, pool)?;
    msg!(
        "coverage target={} members={} exact={} covered={}",
        target,
        members,
        exact,
        u8::from(covered)
    );
    Ok(covered)
}
