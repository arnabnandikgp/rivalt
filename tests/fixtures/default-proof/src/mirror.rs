//! Meter D127 on a committed synthetic snapshot. This probe has no authority
//! over clearing accounts. Digests stand for previously checked exact values.
use super::*;
use default_plan_selection::mirror::{compare, Markets, Member, Pair};

const MAX_INPUT: usize = 2600;

#[account(borsh)]
#[derive(InitSpace, Default)]
pub struct MirrorProbe {
    pub venue: Address,
    pub episode: u64,
    pub commitment: [u8; 32],
    pub result: u8,
    #[max_len(2600)]
    pub input: Vec<u8>,
}

#[derive(Accounts)]
#[instruction(episode:u64)]
pub struct StartMirror {
    #[account(mut)]
    pub payer: Signer,
    #[account(init, payer=payer, space=8+MirrorProbe::INIT_SPACE,
        seeds=[b"mirror-probe".as_ref(),payer.address().as_ref(),&episode.to_le_bytes()],bump)]
    pub probe: BorshAccount<MirrorProbe>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct WriteMirror {
    pub writer: Signer,
    #[account(mut, constraint=probe.venue==*writer.address() @ ProofError::WrongCursor)]
    pub probe: BorshAccount<MirrorProbe>,
}

#[derive(Accounts)]
pub struct DecideMirror {
    #[account(mut)]
    pub probe: BorshAccount<MirrorProbe>,
}

pub fn append(probe: &mut MirrorProbe, offset: u16, bytes: &[u8]) -> Result<()> {
    require!(
        probe.result == 0 && usize::from(offset) == probe.input.len(),
        ProofError::WrongCursor
    );
    require!(
        !bytes.is_empty() && bytes.len() <= 512 && probe.input.len() + bytes.len() <= MAX_INPUT,
        ProofError::InvalidCount
    );
    probe.input.extend_from_slice(bytes);
    Ok(())
}

type Digest = [u8; 32];

#[derive(AnchorDeserialize)]
struct MarketInputs {
    frozen: [Digest; 2],
    outcomes: [[Digest; 2]; 2],
    recovery_and_insurance: [[[u64; 2]; 2]; 2],
}

#[derive(AnchorDeserialize)]
struct MemberInputs {
    id: u64,
    frozen: [Digest; 2],
    outcomes: [[Digest; 2]; 2],
    charges: [[u64; 2]; 2],
}

#[derive(AnchorDeserialize)]
struct PairInputs {
    winner: u8,
    market: u8,
    debtor: u8,
    charge: u64,
    fills: Digest,
}

fn read<T: for<'de> SchemaRead<'de, anchor_lang::BorshConfig, Dst = T>>(
    data: &mut &[u8],
) -> Result<T> {
    anchor_lang::wincode::config::deserialize_from(data, anchor_lang::BORSH_CONFIG)
        .map_err(|_| ProgramError::InvalidInstructionData)
}

#[inline(never)]
pub fn decide(probe: &mut MirrorProbe, permutation: [u8; 8], proposed: u8) -> Result<()> {
    require!(probe.result == 0, ProofError::WrongCursor);
    require!(
        solana_sha256_hasher::hash(&probe.input).to_bytes() == probe.commitment,
        ProofError::Incomplete
    );
    let mut data = probe.input.as_slice();
    let market: MarketInputs = read(&mut data)?;
    let markets = Markets {
        frozen: market.frozen,
        outcomes: market.outcomes,
        recovery_and_insurance: market.recovery_and_insurance,
    };
    let mut members = Vec::with_capacity(8);
    for _ in 0..8 {
        let row: MemberInputs = read(&mut data)?;
        members.push(Member {
            id: row.id,
            frozen: row.frozen,
            outcomes: row.outcomes,
            charges: row.charges,
        });
    }
    let mut pairs = [Vec::new(), Vec::new()];
    for side in &mut pairs {
        let count: u8 = read(&mut data)?;
        require!(count <= 8, ProofError::InvalidCount);
        for _ in 0..count {
            let edge: PairInputs = read(&mut data)?;
            side.push(Pair {
                winner: usize::from(edge.winner),
                market: edge.market,
                debtor: usize::from(edge.debtor),
                charge: edge.charge,
                fills: edge.fills,
            });
        }
    }
    require!(data.is_empty(), ProofError::UnsupportedBook);
    let order = compare(
        probe.venue.as_array(),
        probe.episode,
        &markets,
        &members,
        &permutation.map(usize::from),
        [&pairs[0], &pairs[1]],
    )
    .ok_or(ProofError::UnsupportedBook)?;
    let selected = match order {
        core::cmp::Ordering::Greater => 1,
        core::cmp::Ordering::Less => 2,
        core::cmp::Ordering::Equal => return Err(ProofError::UnsupportedBook.into()),
    };
    require!(proposed == selected, ProofError::WrongMirrorWinner);
    probe.result = selected;
    Ok(())
}
