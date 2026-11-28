#[path = "market_settlement/driver.rs"]
mod driver;

fn main() -> std::io::Result<()> {
    driver::run(Some(3))
}
