//! Native comparison endpoint. Arguments are the venue hex, decimal epoch, and
//! two lists of id:atom pairs in ascending stable member order.
use default_plan_selection::single_lot::{assign, MemberAmount};
fn members(list: &str) -> Option<Vec<MemberAmount>> {
    if list.is_empty() {
        return Some(Vec::new());
    }
    list.split(',')
        .map(|entry| {
            let (id, atoms) = entry.split_once(':')?;
            Some(MemberAmount {
                id: id.parse().ok()?,
                atoms: atoms.parse().ok()?,
            })
        })
        .collect()
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let partial = args.first().is_some_and(|value| value == "--partial");
    let population = args.first().is_some_and(|value| value == "--population");
    let [venue, epoch, debtors, winners] = &args[usize::from(partial || population)..] else {
        panic!("expected four arguments")
    };
    assert!(venue.is_ascii() && venue.len() == 64);
    let venue = core::array::from_fn(|i| u8::from_str_radix(&venue[2 * i..2 * i + 2], 16).unwrap());
    if partial {
        let debtors: [MemberAmount; 2] = members(debtors).unwrap().try_into().expect("two debtors");
        let winners: [MemberAmount; 2] = members(winners)
            .unwrap()
            .try_into()
            .expect("two opposing lots");
        if let Some(plan) = default_plan_selection::two_debtors::assign(
            &venue,
            epoch.parse().unwrap(),
            debtors,
            winners,
        ) {
            for (index, debtor) in debtors.iter().enumerate() {
                if plan.charges[index] > 0 {
                    println!(
                        "{} {} {}",
                        debtor.id, winners[plan.winners[index]].id, plan.charges[index]
                    );
                }
            }
        } else {
            println!("unsupported");
        }
        return;
    }
    let select = if population {
        default_plan_selection::inventory_book::assign
    } else {
        assign
    };
    if let Some(pairs) = select(
        &venue,
        epoch.parse().unwrap(),
        &members(debtors).unwrap(),
        &members(winners).unwrap(),
    ) {
        for pair in pairs {
            println!("{} {} {}", pair.debtor, pair.winner, pair.charge);
        }
    } else {
        println!("unsupported");
    }
}
