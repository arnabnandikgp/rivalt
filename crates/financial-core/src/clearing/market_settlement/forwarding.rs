//! Divide incoming recoveries in the original debt proportions. When a
//! destination is fully paid, redistribute its share among the remaining debts.
use super::*;

pub(super) struct Band {
    pub start: Amount,
    pub length: Amount,
    pub paid: Amounts,
    pub shares: Amounts,
}

pub(super) struct Forwarding {
    width: usize,
    pub bands: Vec<Band>,
}

impl Forwarding {
    pub fn new(row: &Prepared) -> Self {
        let width = row.claims.len();
        let mut bands = Vec::new();
        let mut paid = zeros(width);
        let mut start = Amount::zero();
        if row.claims.iter().any(|claim| !claim.is_zero()) {
            loop {
                let open: Vec<_> = (0..width).filter(|&m| paid[m] < row.remaining[m]).collect();
                if open.is_empty() {
                    break;
                }
                let weight: Amount = open.iter().map(|&m| &row.weights[m]).sum();
                let mut shares = zeros(width);
                for &m in &open {
                    shares[m] = &row.weights[m] / &weight;
                }
                let length = open
                    .iter()
                    .map(|&m| (&row.remaining[m] - &paid[m]) / &shares[m])
                    .min()
                    .unwrap();
                let next = columns(width, |m| &paid[m] + &length * &shares[m]);
                bands.push(Band {
                    start: start.clone(),
                    length: length.clone(),
                    paid,
                    shares,
                });
                paid = next;
                start += length;
            }
        }
        Self { width, bands }
    }

    pub fn pay(&self, available: &Amount) -> Amounts {
        let band = self.bands.iter().rev().find(|b| &b.start <= available);
        match band {
            Some(band) => {
                let used = (available - &band.start).min(band.length.clone());
                columns(self.width, |m| &band.paid[m] + &used * &band.shares[m])
            }
            None => zeros(self.width),
        }
    }
}
