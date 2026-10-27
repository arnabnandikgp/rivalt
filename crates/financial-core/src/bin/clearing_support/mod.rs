use financial_core::clearing::wide::{Wide, LIMBS};
use financial_core::{Error, Result};
pub fn parse(text: &str) -> Result<Wide> {
    if text.is_empty()
        || text.len() > LIMBS * 16
        || !text.bytes().all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(Error::Bounds);
    }
    let mut value = [0; LIMBS];
    for (index, chunk) in text.as_bytes().rchunks(16).enumerate() {
        value[index] =
            u64::from_str_radix(std::str::from_utf8(chunk).map_err(|_| Error::Bounds)?, 16)
                .map_err(|_| Error::Bounds)?;
    }
    Ok(value)
}
pub fn format(value: &Wide) -> String {
    let full: String = value
        .iter()
        .rev()
        .map(|word| format!("{word:016x}"))
        .collect();
    let trimmed = full.trim_start_matches('0');
    if trimmed.is_empty() {
        "0".into()
    } else {
        trimmed.into()
    }
}
pub fn small(text: &str) -> Result<u128> {
    u128::from_str_radix(text, 16).map_err(|_| Error::Bounds)
}
