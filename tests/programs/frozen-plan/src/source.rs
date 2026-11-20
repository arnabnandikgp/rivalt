use super::*;
use clearing::state::accounts::{FrozenMargin, MEMBER_FINANCIAL, SCHEMA_VERSION};

fn canonical(account: &Address, seeds: &[&[u8]]) -> Result<()> {
    let key = create_program_address(seeds, &clearing::ID).map_err(|_| ProofError::Source)?;
    require_keys_eq!(key, *account, ProofError::Source);
    Ok(())
}
impl Source {
    pub fn check(&self, epoch: u64) -> Result<()> {
        let header = &self.prepared;
        let source = &self.resolution;
        canonical(
            header.address(),
            &[
                b"prepared-settlement",
                header.venue.as_ref(),
                &[header.bump],
            ],
        )?;
        canonical(
            source.address(),
            &[b"resolution-v3", header.venue.as_ref(), &[source.bump]],
        )?;
        require!(
            header.schema_version == SCHEMA_VERSION
                && source.schema_version == SCHEMA_VERSION
                && epoch != 0
                && header.epoch == epoch
                && source.epoch == epoch
                && source.venue == header.venue
                && header.source == *source.address()
                && header.source_revision == source.revision
                && header.stage == 4
                && source.stage == 2
                && header.count > 0
                && header.count == source.count
                && header.registry_hash == source.registry_hash
                && header.membership_epoch == source.membership_epoch
                && header.prices == source.prices
                && header.funding == source.funding
                && header.gross == source.remaining_gross
                && header.pools == source.pools_before
                && header.insurance == source.insurance_before
                && header.fees == source.fees_before
                && header.allocated == source.allocated_before,
            ProofError::Source
        );
        Ok(())
    }
    pub fn resume(&self, proof: &Comparison) -> Result<()> {
        self.check(proof.epoch)?;
        require!(
            !proof.sealed
                && proof.source == *self.prepared.address()
                && proof.revision == self.prepared.revision
                && proof.count == self.prepared.count,
            ProofError::Cursor
        );
        Ok(())
    }
}
pub fn row<'a>(
    header: &PreparedSettlement,
    page: &'a BorshAccount<FrozenMarginPage>,
    ordinal: u64,
) -> Result<&'a FrozenMargin> {
    let index = ordinal / 8;
    canonical(
        page.address(),
        &[
            b"frozen-margin-page",
            header.venue.as_ref(),
            &index.to_le_bytes(),
            &[page.bump],
        ],
    )?;
    require!(
        page.account().data_len() == 8 + FrozenMarginPage::INIT_SPACE
            && page.schema_version == SCHEMA_VERSION
            && page.venue == header.venue
            && page.epoch == header.epoch
            && page.page_index == index
            && ordinal < header.count
            && ordinal % 8 < u64::from(page.row_count),
        ProofError::Source
    );
    Ok(&page.rows[(ordinal % 8) as usize])
}
pub fn original(
    row: &FrozenMargin,
    header: &PreparedSettlement,
    root: &BorshAccount<MarginAccount>,
) -> Result<()> {
    require!(
        row.member == *root.address()
            && root.venue == header.venue
            && root.schema_version == SCHEMA_VERSION
            && root.lifecycle == MEMBER_FINANCIAL
            && root.id == row.id
            && root.revision == row.original_revision
            && root.cash == row.cash
            && row.activation_generation > 0
            && root.activation_generation == row.activation_generation
            && root.positions.map(|position| position.generation) == row.generations
            && root.positions.map(|position| position.lots) == row.lots,
        ProofError::Source
    );
    Ok(())
}
