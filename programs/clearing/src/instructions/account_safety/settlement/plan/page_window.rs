//! Bounded scratch prefetch and native untrusted descriptor planning.
use super::*;

/// Caller chooses bounded I/O only. Frozen binding and the actual work remain
/// program-owned; immutable denominator/rate registers can never be writable.
pub(crate) fn prepare_plan_window(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &SettlementPlan,
    pages: &[SettlementPageAccess],
) -> Result<Box<PlanContinuation>> {
    require!(pages.len() <= MAX_WINDOW_PAGES, ClearingError::Resolution);
    let mut continuation = prepare_plan_continuation(header, rates, plan)?;
    let requests: Vec<_> = pages
        .iter()
        .map(|page| PageRequest {
            register: page.register,
            index: page.page_index,
            writable: page.writable,
        })
        .collect();
    for request in &requests {
        require!(
            matches!(request.register, 0..=45 | 64..=70)
                && (!request.writable || request.register >= 25),
            ClearingError::Resolution
        );
        let capacity = exact(continuation.layout.capacity(request.register))?;
        require!(
            request.index < capacity.div_ceil(PAGE_WORDS),
            ClearingError::Resolution
        );
    }
    let proposed = exact(PagePlan::window(
        &requests,
        exact(continuation.layout.maximum_capacity())?,
    ))?;
    require!(
        continuation
            .work
            .accesses(continuation.layout)?
            .into_iter()
            .flatten()
            .all(|access| proposed.permits(access.register, access.limb, access.writable)),
        ClearingError::Resolution
    );
    continuation.pages = proposed;
    Ok(continuation)
}

/// Native operator preview only: replay at most 128 owned kernel steps over
/// copied scratch words to propose at most eight I/O pages. No result is saved
/// or uploaded as authority; the program repeats all steps against actual pages.
#[cfg(any(feature = "state-only", test))]
pub fn preview_plan_window(
    header: &PreparedSettlement,
    rates: &SettlementRates,
    plan: &SettlementPlan,
    mut pages: Vec<SettlementLimbPage>,
) -> Result<PagePlan> {
    require!(pages.len() <= MAX_WINDOW_PAGES, ClearingError::Resolution);
    let layout = exact(Layout::new(header.count))?;
    for (index, page) in pages.iter().enumerate() {
        let capacity = exact(layout.capacity(page.register))?;
        require!(
            page.schema_version == SETTLEMENT_SCHEMA
                && page.venue == header.venue
                && page.epoch == header.epoch
                && page.revision > 0
                && page.attempt
                    == if page.register <= 1 {
                        0
                    } else {
                        plan.rates_attempt
                    }
                && page.page_index < capacity.div_ceil(PAGE_WORDS)
                && u64::from(page.word_count)
                    == (capacity - page.page_index * PAGE_WORDS).min(PAGE_WORDS)
                && !pages[..index]
                    .iter()
                    .any(|other| other.register == page.register
                        && other.page_index == page.page_index),
            ClearingError::Resolution
        );
    }
    struct Preview<'a>(&'a mut [SettlementLimbPage]);
    impl LimbStorage for Preview<'_> {
        fn read(&self, register: u32, limb: u64) -> financial_core::Result<u64> {
            let page = self
                .0
                .iter()
                .find(|page| page.register == register && page.page_index == limb / PAGE_WORDS)
                .ok_or(financial_core::Error::Bounds)?;
            if limb % PAGE_WORDS >= u64::from(page.word_count) {
                return Err(financial_core::Error::Bounds);
            }
            Ok(page.payload.words[(limb % PAGE_WORDS) as usize])
        }
        fn write(&mut self, register: u32, limb: u64, value: u64) -> financial_core::Result<()> {
            let page = self
                .0
                .iter_mut()
                .find(|page| page.register == register && page.page_index == limb / PAGE_WORDS)
                .ok_or(financial_core::Error::Bounds)?;
            if limb % PAGE_WORDS >= u64::from(page.word_count) {
                return Err(financial_core::Error::Bounds);
            }
            page.payload.words[(limb % PAGE_WORDS) as usize] = value;
            Ok(())
        }
    }
    let mut requests: Vec<PageRequest> = Vec::new();
    let mut work = Work::restore(header, rates, plan)?;
    for _ in 0..128 {
        let Ok(accesses) = work.accesses(layout) else {
            break;
        };
        let mut proposed = requests.clone();
        for access in accesses.iter().flatten() {
            if let Some(old) = proposed.iter_mut().find(|old| {
                old.register == access.register && old.index == access.limb / PAGE_WORDS
            }) {
                old.writable |= access.writable;
            } else {
                proposed.push(PageRequest {
                    register: access.register,
                    index: access.limb / PAGE_WORDS,
                    writable: access.writable,
                });
            }
        }
        if proposed.len() > MAX_WINDOW_PAGES {
            break;
        }
        requests = proposed;
        // Return every missing descriptor together. A subsequent bounded preview
        // starts from the same checkpoint and includes the actual fetched words.
        if accesses.iter().flatten().any(|access| {
            !pages.iter().any(|page| {
                page.register == access.register && page.page_index == access.limb / PAGE_WORDS
            })
        }) {
            break;
        }
        work.step(layout, &mut Preview(&mut pages))?;
    }
    requests.sort_unstable_by_key(|request| (request.register, request.index));
    exact(PagePlan::window(
        &requests,
        exact(layout.maximum_capacity())?,
    ))
}
