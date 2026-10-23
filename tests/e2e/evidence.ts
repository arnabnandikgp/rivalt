import { createHash } from 'node:crypto';

type JournalReader = {
  query(text: string, values: string[]): Promise<{ rows: Array<{ wire: string; [field: string]: unknown }> }>;
};

// Public journal evidence only: never export credentials or private keys.
export async function publicIntents(pool: JournalReader, runId: string) {
  const { rows } = await pool.query(
    `SELECT request_id,signature,budget,status,attempts,result,wire
       FROM service_intents WHERE run_id=$1 ORDER BY request_id`, [runId],
  );
  return rows.map(({ wire, ...row }) => ({
    ...row,
    wireSha256: createHash('sha256').update(Buffer.from(wire, 'base64')).digest('hex'),
  }));
}
