import { query } from './query.js';

async function main() {
  const userId = process.env.USER_ID ? Number(process.env.USER_ID) : null;
  let where = 'salary_id IS NOT NULL OR description LIKE "Salário - %"';
  const params = [];
  if (userId) {
    where = `(salary_id IS NOT NULL OR description LIKE "Salário - %") AND user_id = ?`;
    params.push(userId);
  }
  const countRows = await query(`SELECT COUNT(*) AS c FROM transactions WHERE ${where}`, params);
  const total = Number(countRows?.[0]?.c || 0);
  console.log(`[delete-salaries] Encontradas ${total} transações de salário para remover${userId ? ' (user_id=' + userId + ')' : ''}`);
  if (total > 0) {
    const res = await query(`DELETE FROM transactions WHERE ${where}`, params);
    console.log(`[delete-salaries] Removidas ${res?.affectedRows ?? 0}`);
  } else {
    console.log('[delete-salaries] Nada a remover');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
