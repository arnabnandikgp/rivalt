//! Read the fixed Borsh prefix and borrow the occupied row bytes in a coverage PDA.
//! The account schema still owns the wire format; no native alignment is assumed.
use super::*;

#[derive(AnchorDeserialize, InitSpace)]
pub(super) struct LaneHeader {
    venue: Address,
    pub lane: u8,
    bump: u8,
    membership_epoch: u64,
    pub anchor: [i128; 2],
    claim: [i128; 2],
    funded: [i128; 2],
    funded_both: i128,
    lots: [[i64; 2]; 2],
    pub radius: [[i128; 2]; 4],
    // Borsh encodes the length of CoverageLane.members as a little-endian u32.
    member_count: u32,
}

impl LaneHeader {
    const ROWS_START: usize = CoverageLane::DISCRIMINATOR.len() + Self::INIT_SPACE;

    fn parse(bytes: &[u8]) -> Result<Self> {
        require!(
            bytes.len() == CoverageLane::SPACE && bytes.starts_with(CoverageLane::DISCRIMINATOR),
            ClearingError::ExitCohort
        );
        let header: Self =
            crate::wire::read(&bytes[CoverageLane::DISCRIMINATOR.len()..Self::ROWS_START])?;
        require!(header.count() <= ROWS_PER_LANE, ClearingError::ExitCohort);
        Ok(header)
    }

    pub fn authenticate(
        view: &AccountView,
        bytes: &[u8],
        venue: &Address,
        epoch: u64,
    ) -> Result<Self> {
        require!(
            view.owner() == &crate::ID && !view.executable(),
            ClearingError::ExitCohort
        );
        let header = Self::parse(bytes)?;
        require!(
            header.venue == *venue
                && header.membership_epoch == epoch
                && usize::from(header.lane) < LANES,
            ClearingError::ExitCohort
        );
        let expected = create_program_address(
            &[
                b"coverage-lane",
                venue.as_ref(),
                &[header.lane],
                &[header.bump],
            ],
            &crate::ID,
        )
        .map_err(|_| ClearingError::ExitCohort)?;
        require_keys_eq!(expected, *view.address(), ClearingError::ExitCohort);
        Ok(header)
    }

    pub fn count(&self) -> usize {
        self.member_count as usize
    }

    pub fn bounds(&self) -> Bounds {
        Bounds {
            claim: self.claim,
            funded: self.funded,
            funded_both: self.funded_both,
            lots: self.lots,
        }
    }

    pub fn members<'a>(
        &self,
        bytes: &'a [u8],
    ) -> impl Iterator<Item = Result<CoverageMember>> + 'a {
        self.rows(bytes, 0..self.count())
    }

    pub fn rows<'a>(
        &self,
        bytes: &'a [u8],
        range: std::ops::Range<usize>,
    ) -> impl Iterator<Item = Result<CoverageMember>> + 'a {
        let offset = |index| Self::ROWS_START + index * CoverageMember::INIT_SPACE;
        bytes[offset(range.start)..offset(range.end)]
            .chunks_exact(CoverageMember::INIT_SPACE)
            .map(crate::wire::read)
    }
}

const _: () = assert!(
    LaneHeader::ROWS_START + ROWS_PER_LANE * CoverageMember::INIT_SPACE == CoverageLane::ROW_SPACE
);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn streamed_prefix_and_rows_match_the_account_schema() {
        let lane = CoverageLane {
            venue: Address::new_from_array([17; 32]),
            lane: 5,
            bump: 217,
            membership_epoch: 23,
            anchor: [41, 52],
            claim: [-3, 4],
            funded: [5, 6],
            funded_both: -7,
            lots: [[-8, 9], [10, -11]],
            radius: [[-12, 13], [14, 15], [-16, 17], [18, -19]],
            members: (0..ROWS_PER_LANE)
                .map(|index| CoverageMember {
                    id: 5 + 8 * index as u64,
                    cash: 100 + index as u64,
                    lots: [-(index as i64), 9],
                    fixed: [i128::MIN + index as i128, i128::MAX - 1],
                })
                .collect(),
        };
        let mut bytes = vec![0xbb; CoverageLane::SPACE];
        crate::wire::write_account(&lane, &mut bytes).unwrap();
        let header = LaneHeader::parse(&bytes).unwrap();
        assert_eq!(
            (
                header.venue,
                header.lane,
                header.bump,
                header.membership_epoch
            ),
            (lane.venue, lane.lane, lane.bump, lane.membership_epoch)
        );
        assert_eq!(header.anchor, lane.anchor);
        let bounds = header.bounds();
        assert_eq!(
            (bounds.claim, bounds.funded, bounds.funded_both, bounds.lots),
            (lane.claim, lane.funded, lane.funded_both, lane.lots)
        );
        assert_eq!(header.radius, lane.radius);
        assert_eq!(header.count(), lane.members.len());
        assert!(header
            .members(&bytes)
            .map(Result::unwrap)
            .eq(lane.members.iter().copied()));
        assert!(LaneHeader::parse(&bytes[..bytes.len() - 1]).is_err());
        bytes[0] ^= 1;
        assert!(LaneHeader::parse(&bytes).is_err());
        bytes[0] ^= 1;
        bytes[LaneHeader::ROWS_START - 4..LaneHeader::ROWS_START]
            .copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(LaneHeader::parse(&bytes).is_err());
    }
}
