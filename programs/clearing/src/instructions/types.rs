//! Shared instruction payloads. Field order is a pinned wire contract.
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy)]
pub struct OrderTerms {
    pub side: u8,
    pub lots: u64,
    pub limit: u64,
    pub fee_budget: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub trigger: u8,
    pub threshold: u64,
    pub reduce_only: bool,
    pub generation: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct OrderExecution {
    pub id: u64,
    pub version: u64,
    pub filled: u64,
    pub observation_sequence: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub lots: u64,
    pub legs: Vec<RouteLeg>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RouteLeg {
    pub lots: u64,
    pub quote_epoch: u64,
    pub authority_epoch: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RouteIntent {
    pub domain: [u8; 32],
    pub terms_epoch: u64,
    pub config_epoch: u64,
    pub observation_sequence: u64,
    pub nonce: u64,
    pub start_slot: u64,
    pub expiry_slot: u64,
    pub side: u8,
    pub lots: u64,
    /// Buy: maximum gross+fee. Sell: minimum gross-fee.
    pub all_in_limit: u64,
    pub max_fee: u64,
    pub reduce_only: bool,
    pub generation: Option<u64>,
    pub legs: Vec<RouteLeg>,
}
