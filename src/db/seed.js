import { transaction } from './query.js';
import { ensureDemoUser } from '../bootstrap/demo-user.js';

async function seed() {
  await transaction(async (conn) => {
    const userId = await ensureDemoUser();

    // Categories
    const categories = [
      { name: 'Essenciais', color: '#6366F1', icon: '🏠' },
      { name: 'Alimentação', color: '#F59E0B', icon: '☕' },
      { name: 'Investimentos', color: '#10B981', icon: '💰' },
      { name: 'Reserva', color: '#06B6D4', icon: '💼' },
    ];
    for (const c of categories) {
      const [rows] = await conn.query('SELECT id FROM categories WHERE user_id = ? AND name = ?', [userId, c.name]);
      if (!rows.length) {
        await conn.query('INSERT INTO categories (user_id, name, color, icon) VALUES (?, ?, ?, ?)', [userId, c.name, c.color, c.icon]);
      }
    }

    // Accounts
    const accounts = [
      { name: 'Carteira', type: 'asset', currency: 'BRL', balance: 5000 },
      { name: 'Conta Corrente', type: 'asset', currency: 'BRL', balance: 7500 },
      { name: 'Cartão de Crédito', type: 'liability', currency: 'BRL', balance: 1200 },
    ];
    for (const a of accounts) {
      const [rows] = await conn.query('SELECT id FROM accounts WHERE user_id = ? AND name = ?', [userId, a.name]);
      if (!rows.length) {
        await conn.query('INSERT INTO accounts (user_id, name, type, currency, balance) VALUES (?, ?, ?, ?, ?)', [userId, a.name, a.type, a.currency, a.balance]);
      }
    }

    // Fetch ids for relations
    const [catRows] = await conn.query('SELECT id, name FROM categories WHERE user_id = ?', [userId]);
    const catMap = Object.fromEntries(catRows.map((r) => [r.name, r.id]));
    const [accRows] = await conn.query('SELECT id, name FROM accounts WHERE user_id = ?', [userId]);
    const accMap = Object.fromEntries(accRows.map((r) => [r.name, r.id]));

    // Transactions for current month
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const dt = (d) => new Date(year, month, d, 12, 0, 0).toISOString().slice(0, 19).replace('T', ' ');

    const txs = [
      { type: 'income', amount: 8200, occurred_at: dt(1), description: 'Salário', account_id: accMap['Conta Corrente'] },
      { type: 'expense', amount: 3200, occurred_at: dt(3), description: 'Aluguel', category_id: catMap['Essenciais'], account_id: accMap['Conta Corrente'] },
      { type: 'expense', amount: 450, occurred_at: dt(5), description: 'Supermercado', category_id: catMap['Alimentação'], account_id: accMap['Carteira'] },
      { type: 'expense', amount: 120, occurred_at: dt(7), description: 'Café', category_id: catMap['Alimentação'], account_id: accMap['Carteira'] },
      { type: 'expense', amount: 2400, occurred_at: dt(10), description: 'Aporte', category_id: catMap['Investimentos'], account_id: accMap['Conta Corrente'] },
      { type: 'expense', amount: 350, occurred_at: dt(12), description: 'Reserva emergência', category_id: catMap['Reserva'], account_id: accMap['Conta Corrente'] },
      { type: 'expense', amount: 800, occurred_at: dt(15), description: 'Cartão crédito', category_id: catMap['Essenciais'], account_id: accMap['Cartão de Crédito'] },
    ];
    for (const t of txs) {
      await conn.query(
        'INSERT INTO transactions (user_id, account_id, category_id, type, amount, occurred_at, description) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [userId, t.account_id || null, t.category_id || null, t.type, t.amount, t.occurred_at, t.description]
      );
    }
  });
}

seed().then(() => {
  console.log('Seed completed');
  process.exit(0);
}).catch((e) => {
  console.error('Seed failed', e);
  process.exit(1);
});
