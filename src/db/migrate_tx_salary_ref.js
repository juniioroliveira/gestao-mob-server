import { transaction } from './query.js';

const MIGRATION_NAME = '0008_transactions_salary_ref';

async function run() {
  await transaction(async (conn) => {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const [rows] = await conn.query('SELECT 1 FROM schema_migrations WHERE name = ?', [MIGRATION_NAME]);
    if (rows.length) return;

    try { await conn.query('ALTER TABLE transactions ADD COLUMN salary_id BIGINT NULL'); } catch {}
    try { await conn.query('ALTER TABLE transactions ADD COLUMN salary_run_at DATETIME NULL'); } catch {}
    try { await conn.query('CREATE UNIQUE INDEX uniq_salary_run ON transactions (salary_id, salary_run_at)'); } catch {}

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run().then(() => {
  console.log('Transactions salary_ref migration applied');
  process.exit(0);
}).catch((e) => {
  console.error('Transactions salary_ref migration failed', e);
  process.exit(1);
});
