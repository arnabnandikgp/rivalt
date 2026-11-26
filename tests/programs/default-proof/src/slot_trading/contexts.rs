use super::*;
use anchor_spl::{
    mint::Mint,
    token::{Token, TokenAccount},
};

#[derive(Accounts)]
#[instruction(isolated:u16)]
pub struct OpenTradeRoot {
    #[account(mut)]
    pub owner: Signer,
    pub custody: BorshAccount<SlotCustody>,
    #[account(init,payer=owner,space=TradingMargin::space(isolated),
        seeds=[b"trade-root".as_ref(),custody.address().as_ref(),owner.address().as_ref(),&isolated.to_le_bytes()],bump)]
    pub margin: BorshAccount<TradingMargin>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
#[instruction(id:u16)]
pub struct OpenTradeMarket {
    #[account(mut)]
    pub owner: Signer,
    #[account(has_one=owner @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(init,payer=owner,space=8+TradingMarket::INIT_SPACE,
        seeds=[b"trade-market".as_ref(),custody.address().as_ref(),&id.to_le_bytes()],bump)]
    pub market: BorshAccount<TradingMarket>,
    pub system_program: Program<System>,
}

#[derive(Accounts)]
pub struct PublishTradeMarket {
    pub owner: Signer,
    #[account(has_one=owner @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(mut,has_one=custody @ ProofError::CustodyBinding)]
    pub market: BorshAccount<TradingMarket>,
}

#[derive(Accounts)]
pub struct TradeWallet {
    pub owner: Signer,
    #[account(has_one=mint @ ProofError::CustodyBinding)]
    pub custody: BorshAccount<SlotCustody>,
    #[account(mut,has_one=custody @ ProofError::CustodyBinding,has_one=owner @ ProofError::CustodyBinding)]
    pub margin: BorshAccount<TradingMargin>,
    pub mint: Account<Mint>,
    #[account(mut,seeds=[b"slot-vault".as_ref(),custody.address().as_ref()],bump,token::mint=mint,token::authority=custody)]
    pub vault: Account<TokenAccount>,
    #[account(mut,token::mint=mint,token::authority=owner,constraint=wallet.address()!=vault.address() @ ProofError::CustodyBinding)]
    pub wallet: Account<TokenAccount>,
    pub token_program: Program<Token>,
}

#[derive(Accounts)]
pub struct TraderOrder {
    pub owner: Signer,
    pub custody: BorshAccount<SlotCustody>,
    #[account(mut,has_one=custody @ ProofError::CustodyBinding,has_one=owner @ ProofError::CustodyBinding,
        constraint=margin.isolated==CROSS @ ProofError::TradeTerms)]
    pub margin: BorshAccount<TradingMargin>,
}

#[derive(Accounts)]
pub struct MatchTrade {
    pub maker_owner: Signer,
    pub custody: BorshAccount<SlotCustody>,
    #[account(mut,has_one=custody @ ProofError::CustodyBinding)]
    pub market: BorshAccount<TradingMarket>,
    #[account(mut,has_one=custody @ ProofError::CustodyBinding,constraint=trader.isolated==CROSS @ ProofError::TradeTerms)]
    pub trader: BorshAccount<TradingMargin>,
    #[account(mut,has_one=custody @ ProofError::CustodyBinding,
        constraint=maker.owner==*maker_owner.address() && maker.owner!=trader.owner @ ProofError::CustodyBinding,
        constraint=maker.isolated==market.id @ ProofError::TradeTerms)]
    pub maker: BorshAccount<TradingMargin>,
}
