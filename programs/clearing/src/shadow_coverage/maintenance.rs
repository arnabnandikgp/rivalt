//! Compare both scoped visits. Financial membership controls row existence and the clearing
//! handler supplies the row values. Revision-only writes do not touch the coverage account.
use super::*;
use anchor_lang::AccountDeserialize;
use anchor_lang::Discriminator;

#[derive(Default)]
pub(crate) struct Changes(Vec<Change>);

struct Change {
    root: Address,
    id: u64,
    venue: Address,
    before: Option<CoverageMember>,
    after: Option<CoverageMember>,
}

impl Changes {
    pub(crate) fn capture(
        &mut self,
        key: Address,
        root: &MarginAccount,
        after: bool,
    ) -> Result<()> {
        if root.lifecycle != MEMBER_FINANCIAL {
            return Ok(());
        }
        let image = CoverageMember::from_root(root)?;
        if after {
            if let Some(existing) = self.0.iter_mut().find(|entry| entry.root == key) {
                require!(
                    existing.venue == root.venue
                        && existing.before.is_some_and(|old| old.id == image.id),
                    ClearingError::ExitCohort
                );
                existing.after = Some(image);
            } else {
                self.0.push(Change {
                    root: key,
                    id: image.id,
                    venue: root.venue,
                    before: None,
                    after: Some(image),
                });
            }
        } else {
            self.0.push(Change {
                root: key,
                id: image.id,
                venue: root.venue,
                before: Some(image),
                after: None,
            });
        }
        Ok(())
    }

    #[inline(never)]
    pub(crate) fn capture_raw(&mut self, account: &AccountView, after: bool) -> Result<()> {
        let root = Box::new(MarginAccount::try_deserialize(
            &mut &account.try_borrow()?[..],
        )?);
        self.capture(*account.address(), &root, after)
    }

    /// Apply every changed row or fail the entire financial instruction, including its CPIs.
    #[inline(never)]
    pub(crate) fn commit(&self, venue: Address, views: &[AccountView]) -> Result<()> {
        let mut present = [false; LANES];
        for view in views {
            require!(
                view.owner() == &crate::ID && view.data_len() == CoverageLane::SPACE,
                ClearingError::ExitCohort
            );
            let mut lane = CoverageLane::try_deserialize(&mut &view.try_borrow()?[..])?;
            let index = usize::from(lane.lane);
            require!(
                (cfg!(feature = "direct-closed-credit") || view.is_writable())
                    && !view.is_signer()
                    && !view.executable()
                    && lane.venue == venue
                    && index < LANES
                    && !present[index]
                    && lane.membership_epoch == 1,
                ClearingError::ExitCohort
            );
            let expected = create_program_address(
                &[b"coverage-lane", venue.as_ref(), &[lane.lane], &[lane.bump]],
                &crate::ID,
            )
            .map_err(|_| ClearingError::ExitCohort)?;
            require_keys_eq!(expected, *view.address(), ClearingError::ExitCohort);
            present[index] = true;
            #[cfg(feature = "verified-coverage")]
            let mut totals = backing::Totals::read(view)?;
            let mut modified = false;
            for change in self
                .0
                .iter()
                .filter(|change| change.before != change.after && change.lane() == index)
            {
                require!(
                    view.is_writable() && change.venue == venue,
                    ClearingError::ExitCohort
                );
                let old = lane
                    .members
                    .iter()
                    .position(|member| member.id == change.id);
                require!(
                    old.map(|pos| lane.members[pos]) == change.before,
                    ClearingError::ExitCohort
                );
                #[cfg(feature = "verified-coverage")]
                totals.replace(change.before, change.after)?;
                if let Some(image) = change.after {
                    include(&mut lane, image)?;
                } else {
                    lane.members
                        .swap_remove(old.ok_or(ClearingError::ExitCohort)?);
                    // Removal can only loosen the safe bound. Reset radii before the next first insert.
                    if lane.members.is_empty() {
                        lane.radius = [[i128::MAX; 2]; 4];
                    }
                }
                modified = true;
            }
            if modified {
                #[cfg(feature = "verified-coverage")]
                totals.write(view)?;
                crate::wire::write_account(&lane, &mut view.clone().try_borrow_mut()?[..])?;
            }
        }
        require!(
            self.0
                .iter()
                .all(|change| change.before == change.after || present[change.lane()]),
            ClearingError::ExitCohort
        );
        Ok(())
    }
}

impl Change {
    fn lane(&self) -> usize {
        (self.id % LANES as u64) as usize
    }
}

pub(crate) fn trailing_lanes(accounts: &[AccountView]) -> Result<usize> {
    let mut boundary = accounts.len();
    for account in accounts.iter().rev() {
        if account.owner() != &crate::ID
            || account.data_len() != CoverageLane::SPACE
            || !account
                .try_borrow()?
                .starts_with(CoverageLane::DISCRIMINATOR)
        {
            break;
        }
        boundary -= 1;
    }
    require!(
        accounts.len() - boundary <= LANES,
        ClearingError::ExitCohort
    );
    Ok(boundary)
}
