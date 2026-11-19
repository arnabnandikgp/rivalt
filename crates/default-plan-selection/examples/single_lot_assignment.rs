//! Native comparison endpoint. Arguments are the venue hex, decimal epoch, and
//! two lists of id:atom pairs in ascending stable member order.
use default_plan_selection::single_lot::{assign, MemberAmount};
fn members(list: &str) -> Option<Vec<MemberAmount>> {
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
    let [venue, epoch, debtors, winners] = args.as_slice() else {
        panic!("expected four arguments")
    };
    assert!(venue.is_ascii() && venue.len() == 64);
    let venue = core::array::from_fn(|i| u8::from_str_radix(&venue[2 * i..2 * i + 2], 16).unwrap());
    if let Some(pairs) = assign(
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
