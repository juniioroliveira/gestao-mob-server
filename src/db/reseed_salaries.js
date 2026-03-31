import { query } from './query.js';
import { processDueSalaries } from '../routes/family.js';

async function main() {
  const userId = process.env.USER_ID ? Number(process.env.USER_ID) : null;
  let where = "type='income' AND description LIKE 'Salário - %'";
  const params = [];
  if (userId) {
    where += ' AND user_id = ?';
    params.push(userId);
  }
  const del = await query(`DELETE FROM transactions WHERE ${where}`, params);
  console.log('[reseed] removidas transações de salário:', del?.affectedRows ?? 0);

  const upd = await query(
    'UPDATE member_salaries SET next_run_at = COALESCE(next_run_at, start_date) WHERE next_run_at IS NULL AND start_date IS NOT NULL'
  );
  console.log('[reseed] backfill next_run_at:', upd?.affectedRows ?? 0);

  const result = await processDueSalaries();
  console.log('[reseed] processDueSalaries =>', result);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
