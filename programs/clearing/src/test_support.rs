//! Native-only backing memory for real Pinocchio account loaders.
use anchor_lang::{pinocchio::account::RuntimeAccount, prelude::*};

pub fn clock() -> Clock {
    Clock {
        slot: 0,
        epoch_start_timestamp: 0,
        epoch: 0,
        leader_schedule_epoch: 0,
        unix_timestamp: 0,
    }
}

pub struct TestAccount {
    storage: Vec<u64>,
}

impl TestAccount {
    pub fn new(
        address: Address,
        owner: Address,
        data: &[u8],
        writable: bool,
        executable: bool,
    ) -> Self {
        let header_size = core::mem::size_of::<RuntimeAccount>();
        assert!(core::mem::align_of::<RuntimeAccount>() <= core::mem::align_of::<u64>());
        let mut storage = vec![0u64; (header_size + data.len()).div_ceil(8)];
        // SAFETY: the allocation is aligned and contains a full initialized header
        // followed by exactly data_len initialized bytes. Storage stays alive until
        // after every view/loader in these tests is dropped; no test resizes it.
        unsafe {
            let pointer = storage.as_mut_ptr().cast::<RuntimeAccount>();
            pointer.write(RuntimeAccount {
                borrow_state: u8::MAX,
                is_signer: 0,
                is_writable: writable as u8,
                executable: executable as u8,
                padding: [0; 4],
                address,
                owner,
                lamports: 1,
                data_len: data.len() as u64,
            });
            core::ptr::copy_nonoverlapping(data.as_ptr(), pointer.add(1).cast::<u8>(), data.len());
        }
        Self { storage }
    }

    /// The returned view and every loader must be dropped before this backing store.
    pub fn view(&mut self) -> AccountView {
        // SAFETY: new establishes the runtime layout and the tests retain self.
        unsafe { AccountView::new_unchecked(self.storage.as_mut_ptr().cast()) }
    }
}
