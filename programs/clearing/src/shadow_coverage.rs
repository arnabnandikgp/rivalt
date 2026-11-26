//! Observation only on a fresh local venue. The payment handler never reads these PDAs.
//! Recording is permissionless and can only copy the canonical clearing-owned financial root.
use crate::{engine, instructions::account_cash::Snapshot, state::accounts::*, ClearingError};
use anchor_lang::prelude::*;
use financial_core::backing::{
    coverage::{self, Bounds, Row},
    MarketRegion, Region,
};

const LANES: usize = 8;
// Rent and serialization bound for this twelve-member experiment, not an admission limit.
const ROWS_PER_LANE: usize = 16;

#[derive(AnchorSerialize, AnchorDeserialize, InitSpace, Clone, Copy)]
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
    const SPACE: usize =
        8 + 32 + 2 + 8 + 32 + 80 + 32 + 128 + 4 + ROWS_PER_LANE * CoverageMember::INIT_SPACE;

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
    let margin = &ctx.accounts.margin;
    let row = engine::checked(Row::from_margin(&engine::account::model(margin)?))?;
    let body = &mut ctx.accounts.body;
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
    let image = CoverageMember {
        id: margin.id,
        cash: row.cash,
        lots: row.lots,
        fixed: row.fixed,
    };
    if let Some(existing) = body
        .members
        .iter_mut()
        .find(|member| member.id == margin.id)
    {
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
    let lanes = ctx.remaining_accounts()?;
    let accounts = &ctx.accounts;
    require!(
        target < 2 && lanes.len() == LANES,
        ClearingError::ExitCohort
    );
    let snapshot = Snapshot::new([&accounts.btc, &accounts.eth], &Clock::get()?)?;
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
        let lane = BorshAccount::<CoverageLane>::load(view.clone())?;
        let expected = create_program_address(
            &[
                b"coverage-lane",
                accounts.venue.address().as_ref(),
                &[index as u8],
                &[lane.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ClearingError::ExitCohort)?;
        require!(
            lane.address() == &expected
                && lane.venue == *accounts.venue.address()
                && lane.membership_epoch == accounts.registry.membership_epoch
                && usize::from(lane.lane) == index
                && lane.members.len() <= ROWS_PER_LANE,
            ClearingError::ExitCohort
        );
        members += lane.members.len() as u64;
        if lane.members.is_empty() {
            continue;
        }
        let moves = engine::checked(coverage::displacements(prices, lane.anchor))?;
        if engine::checked(lane.bounds().proves(target, moves))?
            || coverage::radius_proves(lane.radius, target, moves)
        {
            continue;
        }
        for row in &lane.members {
            exact += 1;
            covered &= engine::checked(financial_core::backing::projected::covers(
                row.cash, row.lots, row.fixed, target, prices,
            ))?;
        }
    }
    require!(
        members != 0 && members == accounts.registry.financial_count,
        ClearingError::ExitCohort
    );
    msg!(
        "coverage target={} members={} exact={} covered={}",
        target,
        members,
        exact,
        u8::from(covered)
    );
    Ok(u64::from(covered))
}
