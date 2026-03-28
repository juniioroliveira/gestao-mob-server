import { transaction } from './query.js';

const MIGRATION_NAME = '0008_ingest_jobs';

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
      CREATE TABLE IF NOT EXISTS ingest_jobs (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        status ENUM('queued','processing','needs_review','done','failed') NOT NULL DEFAULT 'queued',
        mime_type VARCHAR(64) NULL,
        filename VARCHAR(255) NULL,
        data_base64 LONGTEXT NULL,
        ai_output JSON NULL,
        error TEXT NULL,
        transaction_id BIGINT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_ingest_user (user_id),
        INDEX idx_ingest_status (status),
        INDEX idx_ingest_tx (transaction_id),
        CONSTRAINT fk_ingest_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_ingest_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run().then(() => {
  console.log('Ingest jobs migration applied');
  process.exit(0);
}).catch((e) => {
  console.error('Ingest jobs migration failed', e);
  process.exit(1);
});
