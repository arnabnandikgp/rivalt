//! One BTC debtor, one flat BTC creditor, and a BTC winner that owes the sole
//! ETH creditor. All amounts here are whole collateral atoms. Callers must bind
//! these sides and their executable lots to the complete original frozen book.
#[derive(Clone, Copy)]
pub struct ForeignCreditorBook {
    pub btc_debt: u64,
    pub flat_btc: u64,
    pub cross_btc: u64,
    pub eth_debt: u64,
    pub debtor_cash: u64,
    pub cross_cash: u64,
    pub insurance: [u64; 2],
}

impl ForeignCreditorBook {
    pub fn protected_charges(&self) -> Option<[u64; 2]> {
        let debt = self.btc_debt;
        let backing = self.debtor_cash.checked_add(self.insurance[0])?;
        let cross_backing = self.cross_cash.checked_add(self.insurance[1])?;
        let btc = debt.checked_sub(backing)?;
        if self.flat_btc == 0
            || self.flat_btc.checked_add(self.cross_btc)? != debt
            || backing == 0
            || btc == 0
            || self.cross_btc <= btc
        {
            return None;
        }

        // Before the reduction, the cross account collects G*A/D in BTC.
        // Whole ETH charges are bounded by floor(original exact ETH loss).
        let numerator = u128::from(self.cross_btc) * u128::from(backing);
        let original_cross_ceiling = u64::try_from(numerator.div_ceil(u128::from(debt))).ok()?;
        let original_eth_ceiling = cross_backing.checked_add(original_cross_ceiling)?;
        let eth = self.eth_debt.checked_sub(original_eth_ceiling)?;
        let final_eth = cross_backing.checked_add(self.cross_btc.checked_sub(btc)?)?;
        if eth == 0
            || final_eth > self.eth_debt.checked_sub(eth)?
            || final_eth.checked_add(eth)? < original_eth_ceiling
        {
            return None;
        }
        // Both BTC creditors receive their effective face. ETH's integer
        // receipt covers even the largest original rounded receipt less its own
        // charge. All original cash and both insurance budgets are consumed.
        //
        // For a BTC charge x, the cross receipt falls by A*F*x/[D*(D-x)].
        // One additional atom costs strictly less than one ETH atom because
        // F<A and D-x>=A. Total exact recovery increases strictly in x and
        // in the ETH charge throughout the bounded rectangle. Its upper corner
        // is therefore the unique optimum if both lot schedules can realize it.
        Some([btc, eth])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn signed_book_and_protected_boundaries() {
        let book = ForeignCreditorBook {
            btc_debt: 20_002,
            flat_btc: 5_004,
            cross_btc: 14_998,
            eth_debt: 35_004,
            debtor_cash: 19_987,
            cross_cash: 19_976,
            insurance: [6, 3],
        };
        assert_eq!(book.protected_charges(), Some([9, 33]));
        assert_eq!(
            ForeignCreditorBook {
                eth_debt: 34_972,
                ..book
            }
            .protected_charges(),
            None
        );
        assert_eq!(
            ForeignCreditorBook {
                flat_btc: 5_003,
                ..book
            }
            .protected_charges(),
            None
        );
        assert_eq!(
            ForeignCreditorBook {
                debtor_cash: 0,
                ..book
            }
            .protected_charges(),
            None
        );
        assert_eq!(
            ForeignCreditorBook {
                cross_cash: u64::MAX,
                ..book
            }
            .protected_charges(),
            None
        );
    }
    // Enumerate the entire charge rectangle with an independent rational comparison.
    // Exact ETH backing at each x is C + (G-x)*A/(D-x).
    #[test]
    fn admitted_corners_dominate_every_other_integer_pair() {
        let mut admitted = 0;
        for debt in 4..18 {
            for flat in 1..debt {
                for backing in 1..debt {
                    for eth_debt in 3..20 {
                        let gain = debt - flat;
                        let book = ForeignCreditorBook {
                            btc_debt: debt,
                            flat_btc: flat,
                            cross_btc: gain,
                            eth_debt,
                            debtor_cash: backing - 1,
                            cross_cash: 1,
                            insurance: [1, 1],
                        };
                        let Some([btc, eth]) = book.protected_charges() else {
                            continue;
                        };
                        let original = 2 * debt + gain * backing;
                        let cap = (eth_debt * debt - original) / debt;
                        assert_eq!([btc, eth], [debt - backing, cap]);
                        let final_backing = 2 + gain - btc;
                        assert!((final_backing + eth) * debt >= original);
                        for x in 0..=debt - backing {
                            for y in 0..=cap {
                                if [x, y] == [btc, eth] {
                                    continue;
                                }
                                let denominator = debt - x;
                                let received = 2 * denominator + (gain - x) * backing;
                                // Common baseline loss cancels from both exact scores.
                                assert!(
                                    (btc + eth + final_backing) * denominator
                                        > (x + y) * denominator + received
                                );
                            }
                        }
                        admitted += 1;
                    }
                }
            }
        }
        assert!(admitted > 1_000);
    }
}
