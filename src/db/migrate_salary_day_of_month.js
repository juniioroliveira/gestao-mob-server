import { transaction } from './query.js';

const MIGRATION_NAME = '0011_member_salaries_day_of_month';

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

    try { await conn.query('ALTER TABLE member_salaries ADD COLUMN day_of_month INT NULL'); } catch {}
    await conn.query('UPDATE member_salaries SET day_of_month = DAY(start_date) WHERE day_of_month IS NULL AND start_date IS NOT NULL');

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run().then(() => {
  console.log('Member salaries day_of_month migration applied');
  process.exit(0);
}).catch((e) => {
  console.error('Member salaries day_of_month migration failed', e);
  process.exit(1);
});
