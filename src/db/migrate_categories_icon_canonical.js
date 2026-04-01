import { transaction } from './query.js';

const MIGRATION_NAME = '0011_categories_icon_canonical';

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

    const mappings = [
      ['🏠', 'home'],
      ['🛒', 'shopping'],
      ['🎉', 'entertainment'],
      ['💹', 'investments'],
      ['💰', 'savings'],
    ];

    for (const [emoji, canonical] of mappings) {
      await conn.query('UPDATE categories SET icon = ? WHERE icon = ?', [canonical, emoji]);
    }

    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [MIGRATION_NAME]);
  });
}

run()
  .then(() => {
    console.log('Categories icon canonical migration applied');
    process.exit(0);
  })
  .catch((e) => {
    console.error('Categories icon canonical migration failed', e);
    process.exit(1);
  });

