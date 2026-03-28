import { transaction } from './query.js';

const MIGRATION_NAME = '0006_tx_member';

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

    await conn.query(`
      ALTER TABLE transactions
        ADD COLUMN member_id BIGINT NULL AFTER category_id,
        ADD INDEX idx_tx_member (member_id),
        ADD CONSTRAINT fk_tx_member FOREIGN KEY (member_id) REFERENCES family_members(id) ON DELETE SET NULL;
    `);

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run().then(() => {
  console.log('Transaction member_id migration applied');
  process.exit(0);
}).catch((e) => {
  console.error('Transaction member_id migration failed', e);
  process.exit(1);
});
