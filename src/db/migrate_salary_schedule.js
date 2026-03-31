import { transaction } from './query.js';

const MIGRATION_NAME = '0007_member_salaries_schedule';

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

    try { await conn.query('ALTER TABLE member_salaries ADD COLUMN next_run_at DATETIME NULL'); } catch {}
    try { await conn.query('ALTER TABLE member_salaries ADD COLUMN last_run_at DATETIME NULL'); } catch {}

    try {
      await conn.query('UPDATE member_salaries SET next_run_at = COALESCE(next_run_at, start_date)');
    } catch {}

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run().then(() => {
  console.log('Member salaries schedule migration applied');
  process.exit(0);
}).catch((e) => {
  console.error('Member salaries schedule migration failed', e);
  process.exit(1);
});
