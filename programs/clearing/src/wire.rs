//! Explicit RC2 Borsh-shaped encoding at raw account/CPI boundaries.
use anchor_lang::{prelude::*, BorshConfig, BORSH_CONFIG};

pub fn write<T: SchemaWrite<BorshConfig, Src = T>>(
    value: &T,
    writer: impl anchor_lang::wincode::io::Writer,
) -> Result<()> {
    T::write(writer, value).map_err(|_| ProgramError::InvalidInstructionData)
}

pub fn read<T: for<'de> SchemaRead<'de, BorshConfig, Dst = T>>(bytes: &[u8]) -> Result<T> {
    anchor_lang::wincode::config::deserialize(bytes, BORSH_CONFIG)
        .map_err(|_| ProgramError::InvalidAccountData)
}

pub fn write_account<T: Discriminator + SchemaWrite<BorshConfig, Src = T>>(
    value: &T,
    bytes: &mut [u8],
) -> Result<()> {
    let length = T::DISCRIMINATOR.len();
    require!(bytes.len() >= length, ProgramError::AccountDataTooSmall);
    bytes[..length].copy_from_slice(T::DISCRIMINATOR);
    write(value, &mut bytes[length..])
}

#[cfg(test)]
pub fn write_discriminated<T: Discriminator + SchemaWrite<BorshConfig, Src = T>>(
    value: &T,
    mut writer: impl anchor_lang::wincode::io::Writer,
) -> Result<()> {
    writer
        .write(T::DISCRIMINATOR)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    write(value, writer)
}
