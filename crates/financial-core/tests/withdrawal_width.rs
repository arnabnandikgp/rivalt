//! Compare the native width candidate to an independently calculated whole-account
//! boundary, and to the existing financial engine on the deployed two-slot shape.
use clearing_accounting::{Error, Mode, Position, MAX_FUNDING, SCALE};
use financial_core::{margin::Margin, Participant};
use risk_engine::withdrawal::{cash_required, CashRequired, MarketWindow, OccupiedSlot};
use risk_engine::Risk;

#[derive(Clone, Copy)]
struct Market {
    id: u16,
    position: Position,
    current: Risk,
    low: i128,
    high: i128,
}

impl Market {
    fn new(id: u16, lots: i64, virtual_scaled: i128) -> Self {
        Self {
            id,
            position: Position {
                lots,
                virtual_scaled,
                ..Position::default()
            },
            current: Risk {
                lower: 100,
                upper: 100,
                funding: 0,
            },
            low: 0,
            high: 0,
        }
    }

    fn accrued_slot(self) -> OccupiedSlot {
        let participant = Participant {
            lots: self.position.lots,
            virtual_scaled: self.position.virtual_scaled,
            funding_checkpoint: self.position.funding_checkpoint,
            generation: self.position.generation,
            ..Default::default()
        };
        let accrued = participant.accrued(self.current.funding).unwrap();
        OccupiedSlot {
            market: self.id,
            position: Position {
                lots: accrued.lots,
                virtual_scaled: accrued.virtual_scaled,
                funding_checkpoint: accrued.funding_checkpoint,
                generation: accrued.generation,
            },
        }
    }

    fn window(self) -> MarketWindow {
        MarketWindow {
            market: self.id,
            current: self.current,
            funding_low: self.low,
            funding_high: self.high,
        }
    }
}

// Intentionally independent of Position::unpaid, Risk::adverse_price, margin_atoms
// and cash_required. Start from the stored, pre-accrual position, in scaled atoms.
fn loss_at(market: &Market, funding: i128) -> i128 {
    let position = market.position;
    let lots = i128::from(position.lots);
    let price = if lots < 0 {
        market.current.upper
    } else {
        market.current.lower
    };
    let claim = position.virtual_scaled
        + lots * (i128::from(price) * SCALE + position.funding_checkpoint - funding);
    (-claim).max(0)
}

fn reference(markets: &[Market], reserved: u64) -> (i128, i128) {
    let mut current = i128::from(reserved) * SCALE;
    for market in markets {
        let notional =
            i128::from(market.position.lots.unsigned_abs()) * i128::from(market.current.upper);
        current += (notional + 9) / 10 * SCALE + loss_at(market, market.current.funding);
    }
    let mut worst = 0;
    for mask in 0..1_usize << markets.len() {
        let mut losses = 0;
        for (index, market) in markets.iter().enumerate() {
            let funding = if mask & (1 << index) == 0 {
                market.low
            } else {
                market.high
            };
            losses += loss_at(market, funding);
        }
        worst = worst.max(losses);
    }
    (current, worst)
}

fn candidate(markets: &[Market], reserved: u64) -> CashRequired {
    let slots: Vec<_> = markets.iter().map(|market| market.accrued_slot()).collect();
    let windows: Vec<_> = markets
        .iter()
        .filter(|market| market.position.lots != 0)
        .map(|market| market.window())
        .collect();
    cash_required(&slots, &windows, reserved).unwrap()
}

fn existing_two_market_withdraw(markets: &[Market], cash: u64, amount: u64, reserved: u64) -> bool {
    let [first, second] = markets else {
        panic!("two markets required")
    };
    let account = Margin {
        id: 1,
        mode: Mode::Cross,
        cash,
        reserved,
        positions: [first.position, second.position],
    };
    let Ok(next) = account.withdraw(amount, [first.current, second.current]) else {
        return false;
    };
    for btc in [first.low, first.high] {
        for eth in [second.low, second.high] {
            let risks = [
                Risk {
                    funding: btc,
                    ..first.current
                },
                Risk {
                    funding: eth,
                    ..second.current
                },
            ];
            if next.risk_equity(risks).unwrap() < 0 {
                return false;
            }
        }
    }
    true
}

#[test]
fn mixed_long_short_corner_can_alone_block_a_withdrawal() {
    let mut long = Market::new(3, 1, -100 * SCALE);
    let mut short = Market::new(18, -1, 100 * SCALE);
    long.high = 60 * SCALE;
    short.low = -60 * SCALE;
    let markets = [long, short];
    // At either diagonal only one market loses 60. At (high,low) both lose 60.
    assert_eq!(reference(&markets, 0), (20 * SCALE, 120 * SCALE));
    assert_eq!(
        candidate(&markets, 0),
        CashRequired {
            current_scaled: 20 * SCALE,
            held_scaled: 120 * SCALE
        }
    );
    assert!(existing_two_market_withdraw(&markets, 121, 1, 0));
    assert!(!existing_two_market_withdraw(&markets, 121, 2, 0));
}

#[test]
fn flat_claims_order_reserve_and_fractional_losses_keep_their_own_rules() {
    let markets = [
        Market::new(1, 0, -SCALE - 1), // a flat debt of one atom plus one billionth
        Market::new(4, 0, 500 * SCALE),
        Market::new(10, 0, 0), // occupied by an order; its refreshed reserve is supplied below
        Market::new(21, 1, -100 * SCALE),
    ];
    let boundary = candidate(&markets, 7);
    assert_eq!(boundary.current_scaled, 18 * SCALE + 1);
    assert_eq!(boundary.held_scaled, SCALE + 1);
    assert_eq!(
        reference(&markets, 7),
        (boundary.current_scaled, boundary.held_scaled)
    );
    assert_eq!(
        candidate(&[], 0),
        CashRequired {
            current_scaled: 0,
            held_scaled: 0
        }
    );
}

#[test]
fn missing_duplicate_substituted_or_unaccrued_inputs_refuse() {
    let long = Market::new(3, 1, 0);
    let short = Market::new(18, -1, 0);
    let slots = [long.accrued_slot(), short.accrued_slot()];
    for windows in [
        vec![long.window()],
        vec![short.window(), long.window()],
        vec![long.window(), long.window()],
        vec![long.window(), short.window(), short.window()],
    ] {
        assert_eq!(cash_required(&slots, &windows, 0), Err(Error::Invariant));
    }
    assert_eq!(
        cash_required(
            &[long.accrued_slot(), long.accrued_slot()],
            &[long.window(), long.window()],
            0
        ),
        Err(Error::Invariant)
    );
    let mut stale = long.accrued_slot();
    stale.position.funding_checkpoint = 1;
    assert_eq!(
        cash_required(&[stale], &[long.window()], 0),
        Err(Error::Invariant)
    );
    for (low, high) in [(1, 0), (0, -1), (-MAX_FUNDING - 1, 0), (0, MAX_FUNDING + 1)] {
        let mut window = long.window();
        (window.funding_low, window.funding_high) = (low, high);
        assert_eq!(
            cash_required(&[long.accrued_slot()], &[window], 0),
            Err(Error::Bounds)
        );
    }
}

fn varied_book(width: usize, seed: u64) -> Vec<Market> {
    let mut state = seed + 1;
    let mut draw = |limit: u64| {
        state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (state >> 32) % limit
    };
    (0..width)
        .map(|index| {
            let mut lots = 1 + draw(30) as i64;
            if draw(2) == 0 {
                lots = -lots;
            }
            if seed % 3 == 0 && index % 3 == 0 {
                lots = 0;
            }
            let lower = 30 + draw(250);
            let upper = lower + draw(19);
            let checkpoint = i128::from(draw(500)) * SCALE / 31 - 8 * SCALE;
            let funding = i128::from(draw(400)) * SCALE / 29 - 6 * SCALE;
            let move_size = i128::from(draw(130)) * SCALE / 3;
            let end = if draw(2) == 0 {
                funding - move_size
            } else {
                funding + move_size
            };
            let entry = i128::from(lots) * i128::from((lower + upper) / 2);
            Market {
                id: 3 + 5 * index as u16,
                position: Position {
                    lots,
                    generation: 1,
                    funding_checkpoint: checkpoint,
                    virtual_scaled: (i128::from(draw(161)) - 80 - entry) * SCALE
                        + i128::from(draw(9))
                        - 4,
                },
                current: Risk {
                    lower,
                    upper,
                    funding,
                },
                low: funding.min(end),
                high: funding.max(end),
            }
        })
        .collect()
}

#[test]
fn withdrawal_boundaries_match_every_mixed_endpoint_at_two_four_and_eight_markets() {
    for width in [2, 4, 8] {
        let mut current_binding = 0;
        let mut held_binding = 0;
        let mut decisions = 0;
        for seed in 0..128 {
            let markets = varied_book(width, seed);
            let reserved = seed % 37;
            let (current, held) = reference(&markets, reserved);
            let result = candidate(&markets, reserved);
            assert_eq!(
                (result.current_scaled, result.held_scaled),
                (current, held),
                "width={width} seed={seed}"
            );
            let minimum = ((current.max(held) + SCALE - 1) / SCALE) as u64;
            if held > current {
                held_binding += 1;
            } else {
                current_binding += 1;
            }
            let cash = minimum + 5;
            // Five is the independent maximum withdrawable amount in this book.
            for amount in [4, 5, 6] {
                let remaining = i128::from(cash - amount) * SCALE;
                let permits = remaining >= result.current_scaled && remaining >= result.held_scaled;
                assert_eq!(permits, amount <= 5);
                if width == 2 {
                    assert_eq!(
                        existing_two_market_withdraw(&markets, cash, amount, reserved),
                        permits
                    );
                }
                decisions += 1;
            }
        }
        assert!(held_binding > 0 && current_binding > 0);
        println!("width={width} books=128 decisions={decisions} current_or_tie={current_binding} held={held_binding}");
    }
}
