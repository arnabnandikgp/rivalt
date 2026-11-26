//! Meter the exact fallback alone. The mask and prices are fixture inputs.
//! No clearance to pay, summary authentication, token accounts or venue state.
use super::*;
use financial_core::{backing::projected, SCALE};

const ROWS: usize = 125;
const WIDTH: usize = 64;
const PREFIX: usize = 8 + 32 + 1 + 4;

#[account(borsh)]
pub struct CoverageBody {
    pub namespace: Address,
    pub lane: u8,
    pub rows: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(lane: u8)]
pub struct PrepareCoverage {
    #[account(mut)]
    pub payer: Signer,
    #[account(init, payer=payer, space=PREFIX+ROWS*WIDTH,
        seeds=[b"coverage-body".as_ref(), payer.address().as_ref(), &[lane]], bump)]
    pub body: BorshAccount<CoverageBody>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct ChangeCoverage {
    pub payer: Signer,
    #[account(mut, seeds=[b"coverage-body".as_ref(), payer.address().as_ref(), &[7]], bump)]
    pub body: BorshAccount<CoverageBody>,
}

#[derive(Accounts)]
pub struct ReadCoverage {
    /// CHECK: Public fixture namespace. Every supplied program-owned body binds it.
    pub namespace: UncheckedAccount,
}

fn fixture_row(id: u64) -> ([i64; 2], u64) {
    let pair = id / 2;
    let sign = if (id % 2 == 0) ^ (pair / 8 % 2 == 0) {
        1
    } else {
        -1
    };
    let mut lots = [sign; 2];
    lots[(pair / 4 % 2) as usize] = sign * (pair as i64 + 1);
    let cash = 30 * lots[0].unsigned_abs() + 80 * lots[1].unsigned_abs();
    (lots, cash)
}

pub fn prepare(ctx: &mut Context<PrepareCoverage>, lane: u8) -> Result<()> {
    require!(lane < 8, ProofError::UnsupportedBook);
    let body = &mut ctx.accounts.body;
    body.namespace = *ctx.accounts.payer.address();
    body.lane = lane;
    let mut rows = Vec::with_capacity(ROWS * WIDTH);
    for ordinal in 0..ROWS {
        let id = ordinal as u64 * 8 + u64::from(lane);
        let (lots, cash) = fixture_row(id);
        rows.extend_from_slice(&id.to_le_bytes());
        rows.extend_from_slice(&cash.to_le_bytes());
        for quantity in lots {
            rows.extend_from_slice(&quantity.to_le_bytes());
        }
        for (quantity, price) in lots.into_iter().zip([100, 200]) {
            rows.extend_from_slice(&(-i128::from(quantity) * price * SCALE).to_le_bytes());
        }
    }
    body.rows = rows;
    Ok(())
}

pub fn change(ctx: &mut Context<ChangeCoverage>, reduce: bool) -> Result<()> {
    let body = &mut ctx.accounts.body;
    require!(body.rows.len() == ROWS * WIDTH, ProofError::UnsupportedBook);
    let (_, initial) = fixture_row(999);
    let offset = (ROWS - 1) * WIDTH + 8;
    body.rows[offset..offset + 8].copy_from_slice(&(initial - u64::from(reduce)).to_le_bytes());
    Ok(())
}

pub fn measure(ctx: &mut Context<ReadCoverage>, mask: u8) -> Result<u32> {
    let bodies = ctx.remaining_accounts()?;
    require!(
        bodies.len() == mask.count_ones() as usize,
        ProofError::Incomplete
    );
    let mut count = 0;
    let lanes = (0..8u8).filter(|lane| mask & (1 << lane) != 0);
    for (body, lane) in bodies.iter().zip(lanes) {
        require!(
            body.owner() == &crate::ID
                && !body.is_writable()
                && !body.executable()
                && body.data_len() == PREFIX + ROWS * WIDTH,
            ProofError::UnsupportedBook
        );
        let bytes = body.try_borrow()?;
        require!(
            &bytes[..8] == CoverageBody::DISCRIMINATOR
                && &bytes[8..40] == ctx.accounts.namespace.address().as_ref()
                && bytes[40] == lane
                && bytes[41..45] == ((WIDTH * ROWS) as u32).to_le_bytes(),
            ProofError::UnsupportedBook
        );
        for (ordinal, row) in bytes[PREFIX..].chunks_exact(WIDTH).enumerate() {
            let id = u64::from_le_bytes(row[..8].try_into().unwrap());
            require!(
                id == ordinal as u64 * 8 + u64::from(lane),
                ProofError::UnsupportedBook
            );
            let cash = u64::from_le_bytes(row[8..16].try_into().unwrap());
            let lots = [
                i64::from_le_bytes(row[16..24].try_into().unwrap()),
                i64::from_le_bytes(row[24..32].try_into().unwrap()),
            ];
            let fixed = [
                i128::from_le_bytes(row[32..48].try_into().unwrap()),
                i128::from_le_bytes(row[48..64].try_into().unwrap()),
            ];
            let covered =
                projected::covers(cash, lots, fixed, 1, [[70 * SCALE; 2], [120 * SCALE; 2]])
                    .map_err(|_| ProofError::UnsupportedBook)?;
            require!(covered, ProofError::CoverageDebt);
            count += 1;
        }
    }
    Ok(count)
}
