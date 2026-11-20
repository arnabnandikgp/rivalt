import type {PoolClient} from 'pg';

/** Each maker records only its local fee. Include the finalized history before
 * the requested page when reconstructing the 25% carry for a market. */
export function ledgerTradeReceipts(client:Pick<PoolClient,'query'>,runId:string,after:string,limit:number,through:string,latest=false){
  return client.query(`SELECT sequence::text,signature,slot::text,block_time::text,kind,payload,prior::text FROM (
    SELECT e.*,COALESCE(SUM((e.payload->>'fee')::numeric) OVER (PARTITION BY e.payload->>'market'
      ORDER BY e.slot,t.transaction_index,e.outer_index,e.inner_index,e.ordinal ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS prior
    FROM events e JOIN transactions t USING (run_id,signature) WHERE e.run_id=$1 AND e.sequence<=$4
    AND e.kind IN ('LedgerLaneFilled','MarketLaneFilled','LiquidityRouteFeeRecorded')
    ) ordered WHERE sequence>$2 ORDER BY ordered.sequence ${latest?'DESC':'ASC'} LIMIT $3`,
    [runId,after,limit,through]);
}
