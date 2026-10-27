//! Resource-only SBF fixture for the actual financial-core wide functions.
//! Owns no venue/root/token account, grants no trading authority and establishes
//! no deposit/fill/default result. Complete clearing acceptance remains separate.
use anchor_lang::prelude::*;
use financial_core::{
    clearing::{
        atoms,
        row::{Row, MAX_CLAIM},
        wide,
    },
    MAX_CASH,
};
declare_id!("4BBtj9tUo1xeZFkrW3LBg9GrUTtTezGYGBKqjs7A7fAE");

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Register {
    pub limbs: Box<wide::Wide>,
}
impl Space for Register {
    const INIT_SPACE: usize = 768;
}
impl Default for Register {
    fn default() -> Self {
        Self {
            limbs: Box::new([0; 96]),
        }
    }
}

#[account]
#[derive(InitSpace, Default)]
pub struct ArithmeticProbe {
    pub factors: u16,
    pub common: Register,
    pub rate_denominator: Register,
    pub flow_denominator: Register,
    pub flows: [Register; 2],
    pub result: [u64; 3],
    pub fractional: [u8; 3],
    pub bump: u8,
}

#[derive(Accounts)]
#[instruction(factors:u16)]
pub struct Prepare<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init,payer=payer,space=8+ArithmeticProbe::INIT_SPACE,
        seeds=[b"math-probe".as_ref(),&factors.to_le_bytes()],bump)]
    pub probe: Box<Account<'info, ArithmeticProbe>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Measure<'info> {
    #[account(mut,seeds=[b"math-probe".as_ref(),&probe.factors.to_le_bytes()],bump=probe.bump)]
    pub probe: Box<Account<'info, ArithmeticProbe>>,
}

fn row() -> Row {
    Row {
        cash: MAX_CASH,
        claims: [-(MAX_CLAIM as i128), -((MAX_CLAIM - 1) as i128)],
    }
}
fn checked<T>(result: financial_core::Result<T>) -> Result<T> {
    result.map_err(|_| error!(ProbeError::Arithmetic))
}

#[program]
pub mod clearing_math_probe {
    use super::*;
    pub fn prepare(ctx: Context<Prepare>, factors: u16) -> Result<()> {
        require!((1..=64).contains(&factors), ProbeError::Arithmetic);
        let probe = &mut **ctx.accounts.probe;
        probe.factors = factors;
        probe.bump = ctx.bumps.probe;
        probe.common.limbs[0] = 1;
        for _ in 0..factors {
            checked(row().denominator(&mut probe.common.limbs))?;
        }
        checked(wide::multiply(
            &mut probe.rate_denominator.limbs,
            &probe.common.limbs,
            &[2],
        ))?;
        checked(wide::multiply(
            &mut probe.flow_denominator.limbs,
            &probe.rate_denominator.limbs,
            &[1_000_000_000],
        ))?;
        Ok(())
    }
    pub fn measure(ctx: Context<Measure>, kind: u8, rows: u8) -> Result<()> {
        require!(
            kind < 3 && (1..=2).contains(&rows) && (kind != 2 || rows == 1),
            ProbeError::Arithmetic
        );
        let probe = &mut **ctx.accounts.probe;
        let mut scratch: [Box<wide::Wide>; 4] = core::array::from_fn(|_| Box::new([0; 96]));
        for _ in 0..rows {
            if kind == 0 {
                for market in 0..2 {
                    checked(row().flow(
                        market,
                        &probe.common.limbs,
                        &[2, 0, 0],
                        [&probe.common.limbs, &probe.common.limbs],
                        &probe.rate_denominator.limbs,
                        &mut probe.flows[market].limbs,
                        &mut scratch[0],
                    ))?;
                }
            } else if kind == 1 {
                let [first, second, cash, remainder] = &mut scratch;
                let plan = checked(atoms::plan(
                    &row(),
                    [&probe.flows[0].limbs, &probe.flows[1].limbs],
                    &probe.flow_denominator.limbs,
                    [first, second, cash, remainder],
                ))?;
                probe.result = [plan.flows[0], plan.flows[1], plan.cash];
                probe.fractional = plan.fractional.map(u8::from);
            } else {
                // Worst individual market insurance floors. This deliberately
                // overbounds a cohort's shared vault; no cash is created here.
                let zero = Box::new([0; 96]);
                let [outgoing, capacity, remainder, _] = &mut scratch;
                checked(financial_core::clearing::row::greatest(
                    [&probe.rate_denominator.limbs, &probe.rate_denominator.limbs],
                    &probe.rate_denominator.limbs,
                    [0; 2],
                    [u128::from(MAX_CASH) * 1_000_000_000; 2],
                ))?;
                for market in 0..2 {
                    let (spent, fractional) =
                        checked(financial_core::clearing::row::verify_market(
                            u128::from(MAX_CASH) * 1_000_000_000,
                            0,
                            MAX_CASH,
                            &probe.rate_denominator.limbs,
                            &probe.rate_denominator.limbs,
                            &probe.flow_denominator.limbs,
                            &zero,
                            outgoing,
                            capacity,
                            remainder,
                        ))?;
                    probe.result[market] = spent;
                    probe.fractional[market] = u8::from(fractional);
                }
                probe.result[2] = 0;
                probe.fractional[2] = 0;
            }
        }
        Ok(())
    }
}

#[error_code]
pub enum ProbeError {
    #[msg("Arithmetic fixture input or operation rejected")]
    Arithmetic,
}
