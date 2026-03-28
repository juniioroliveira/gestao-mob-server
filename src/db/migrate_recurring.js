import { transaction } from './query.js';
 
const MIGRATION_NAME = '0002_recurring_transactions';
 
async function run() {
  await transaction(async (conn) => {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
 
    const [rows] = await conn.query(`SELECT 1 FROM schema_migrations WHERE name = ?`, [MIGRATION_NAME]);
    if (rows.length) return;
 
    await conn.query(`
      CREATE TABLE IF NOT EXISTS recurrings (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        account_id BIGINT NULL,
        category_id BIGINT NULL,
        type ENUM('income','expense','transfer') NOT NULL,
        amount DECIMAL(18,2) NOT NULL,
        description VARCHAR(255) NULL,
        frequency ENUM('daily','weekly','monthly') NOT NULL,
        \`interval\` INT NOT NULL DEFAULT 1,
        day_of_month TINYINT NULL,
        day_of_week TINYINT NULL,
        start_date DATE NOT NULL,
        end_date DATE NULL,
        next_run_at DATETIME NOT NULL,
        last_run_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_recurring_user (user_id),
        INDEX idx_recurring_next (next_run_at),
        CONSTRAINT fk_recurring_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_recurring_account FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
        CONSTRAINT fk_recurring_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
 
    await conn.query(`INSERT INTO schema_migrations (name) VALUES (?)`, [MIGRATION_NAME]);
  });
}
 
run().then(() => {
  console.log('Recurring migration applied');
  process.exit(0);
}).catch((e) => {
  console.error('Recurring migration failed', e);
  process.exit(1);
});
