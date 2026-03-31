import { transaction } from './query.js';

const MIGRATION_NAME = '0009_ai_hints';

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
      CREATE TABLE IF NOT EXISTS ai_hints (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        issuer_federal_id VARCHAR(32) NULL,
        issuer_name VARCHAR(160) NULL,
        document_type VARCHAR(80) NULL,
        title VARCHAR(200) NULL,
        category_id BIGINT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_hints_user (user_id),
        INDEX idx_hints_issuer (issuer_federal_id),
        INDEX idx_hints_doc (document_type),
        UNIQUE KEY uniq_hint (user_id, issuer_federal_id, document_type, title)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run()
  .then(() => {
    console.log('AI hints migration applied');
    process.exit(0);
  })
  .catch((e) => {
    console.error('AI hints migration failed', e);
    process.exit(1);
  });
