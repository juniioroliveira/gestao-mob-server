import { transaction } from './query.js';

async function run() {
  await transaction(async (conn) => {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await conn.query('TRUNCATE TABLE transactions');
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  });
}

run().then(() => {
  console.log('Transactions table cleared');
  process.exit(0);
}).catch((e) => {
  console.error('Clear transactions failed', e);
  process.exit(1);
});
