import { transaction } from './query.js';

const MIGRATION_NAME = '0005_family_members_salaries';

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
      CREATE TABLE IF NOT EXISTS family_members (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        name VARCHAR(100) NOT NULL,
        relation ENUM('owner','spouse','child','other') NOT NULL DEFAULT 'other',
        email VARCHAR(255) NULL,
        birthdate DATE NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_family_members_user (user_id),
        CONSTRAINT fk_family_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS member_salaries (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        member_id BIGINT NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'BRL',
        start_date DATE NOT NULL,
        end_date DATE NULL,
        frequency ENUM('monthly','biweekly','weekly') NOT NULL DEFAULT 'monthly',
        active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_member_salaries_member (member_id),
        CONSTRAINT fk_member_salaries_member FOREIGN KEY (member_id) REFERENCES family_members(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run().then(() => {
  console.log('Family members & salaries migration applied');
  process.exit(0);
}).catch((e) => {
  console.error('Family migration failed', e);
  process.exit(1);
});
