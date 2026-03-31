import { query } from './query.js';

async function run() {
  // 1) Tentar preencher occurred_at usando salary_run_at quando existir
  try {
    const res1 = await query(
      "UPDATE transactions SET occurred_at = COALESCE(salary_run_at, NOW()) WHERE occurred_at IS NULL AND type='income' AND description LIKE 'Salário - %'"
    );
    console.log('[fix] preenchidos usando salary_run_at/NOW():', res1?.affectedRows ?? 0);
  } catch (e) {
    console.log('[fix] salary_run_at não disponível, usando NOW() como fallback');
    const res2 = await query(
      "UPDATE transactions SET occurred_at = NOW() WHERE occurred_at IS NULL AND type='income' AND description LIKE 'Salário - %'"
    );
    console.log('[fix] preenchidos usando NOW():', res2?.affectedRows ?? 0);
  }
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
