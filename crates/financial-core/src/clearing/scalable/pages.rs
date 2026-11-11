//! Bounded page requests derived from the kernel's next word accesses.
//! This is address planning, not account/PDA authentication or write authority.
use super::wide::WordAccess;
use crate::{Error, Result};

/// Two KiB of words per I/O page. This bounds a single page's encoding/context;
/// the number of pages follows the count-derived width, never a venue cap.
pub const PAGE_WORDS: u64 = 256;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PageRequest {
    pub register: u32,
    pub index: u64,
    pub writable: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PagePlan {
    requests: [PageRequest; 3],
    count: u8,
    capacity: u64,
}
impl PagePlan {
    /// Merge aliases and order by (register,page). The account adapter must
    /// authenticate exactly these expected keys, ownership, epoch/attempt and
    /// revisions; arbitrary extra/writable accounts cannot substitute for them.
    pub fn next(accesses: [Option<WordAccess>; 3], capacity: u64) -> Result<Self> {
        if capacity == 0 {
            return Err(Error::Bounds);
        }
        let mut plan = Self {
            requests: [PageRequest::default(); 3],
            count: 0,
            capacity,
        };
        for access in accesses.into_iter().flatten() {
            if access.limb >= capacity {
                return Err(Error::Bounds);
            }
            let request = PageRequest {
                register: access.register,
                index: access.limb / PAGE_WORDS,
                writable: access.writable,
            };
            if let Some(previous) =
                plan.requests[..usize::from(plan.count)]
                    .iter_mut()
                    .find(|previous| {
                        previous.register == request.register && previous.index == request.index
                    })
            {
                previous.writable |= request.writable;
            } else {
                plan.requests[usize::from(plan.count)] = request;
                plan.count += 1;
            }
        }
        if plan.count == 0 {
            return Err(Error::Bounds);
        }
        // At most three descriptors; no allocation or population-sized sort.
        plan.requests[..usize::from(plan.count)]
            .sort_unstable_by_key(|request| (request.register, request.index));
        Ok(plan)
    }
    pub fn requests(&self) -> &[PageRequest] {
        &self.requests[..usize::from(self.count)]
    }
    pub fn permits(&self, register: u32, limb: u64, writable: bool) -> bool {
        limb < self.capacity
            && self.requests().iter().any(|request| {
                request.register == register
                    && request.index == limb / PAGE_WORDS
                    && (!writable || request.writable)
            })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn boundary_alias_and_readonly_requests_are_exact() {
        let plan = PagePlan::next(
            [
                Some(WordAccess {
                    register: 9,
                    limb: 256,
                    writable: true,
                }),
                Some(WordAccess {
                    register: 7,
                    limb: 255,
                    writable: false,
                }),
                Some(WordAccess {
                    register: 7,
                    limb: 255,
                    writable: false,
                }),
            ],
            257,
        )
        .unwrap();
        assert_eq!(
            plan.requests(),
            &[
                PageRequest {
                    register: 7,
                    index: 0,
                    writable: false
                },
                PageRequest {
                    register: 9,
                    index: 1,
                    writable: true
                },
            ]
        );
        assert!(plan.permits(7, 255, false));
        assert!(!plan.permits(7, 255, true));
        assert!(!plan.permits(7, 256, false));
        assert!(plan.permits(9, 256, true));
        assert!(!plan.permits(9, 257, true));
        assert!(!plan.permits(10, 256, true));
        let joined = PagePlan::next(
            [
                Some(WordAccess {
                    register: 2,
                    limb: 0,
                    writable: false,
                }),
                Some(WordAccess {
                    register: 2,
                    limb: 255,
                    writable: true,
                }),
                None,
            ],
            256,
        )
        .unwrap();
        assert_eq!(
            joined.requests(),
            &[PageRequest {
                register: 2,
                index: 0,
                writable: true
            }]
        );
        assert!(PagePlan::next([None; 3], 256).is_err());
        assert!(PagePlan::next(
            [
                Some(WordAccess {
                    register: 2,
                    limb: 256,
                    writable: true
                }),
                None,
                None
            ],
            256
        )
        .is_err());
    }
}
