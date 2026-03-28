import { transaction } from './query.js';

const USER_ID = Number(process.env.SEED_USER_ID || 1);

const planning = [
  {
    name: 'Essencial Fixo',
    budget: 1550,
    color: '#6366F1',
    icon: '🏠',
    subcategories: ['Aluguel', 'Água', 'Luz', 'Garagem', 'Internet', 'Plano de celular'],
  },
  {
    name: 'Essencial Variável',
    budget: 1500,
    color: '#22C55E',
    icon: '🛒',
    subcategories: ['Mercado', 'Farmácia', 'Combustível', 'Gás', 'Manutenção básica da casa'],
  },
  {
    name: 'Não Essencial (Lazer)',
    budget: 1800,
    color: '#F59E0B',
    icon: '🎉',
    subcategories: ['iFood', 'Restaurantes', 'Streaming', 'Compras (roupa, eletrônicos)', 'Viagens', 'Lazer'],
  },
  {
    name: 'Investimentos',
    budget: 2500,
    color: '#10B981',
    icon: '💹',
    subcategories: ['Ações', 'Fundos', 'Renda fixa', 'Cripto', 'Previdência privada'],
  },
  {
    name: 'Reserva',
    budget: 1650,
    color: '#64748B',
    icon: '💰',
    subcategories: ['Emergência', 'Caixa disponível', 'Fundo de oportunidade', 'Objetivos de curto prazo'],
  },
];

async function run() {
  const total = planning.reduce((sum, p) => sum + Number(p.budget || 0), 0);
  const withPercent = planning.map((p) => ({
    ...p,
    percent: total ? Number(((Number(p.budget) / total) * 100).toFixed(2)) : null,
  }));

  await transaction(async (conn) => {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL UNIQUE,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await conn.query('DELETE FROM categories');
    await conn.query('ALTER TABLE categories AUTO_INCREMENT = 1');
    for (const p of withPercent) {
      await conn.query(
        'INSERT INTO categories (user_id, name, color, icon, percent, subcategories) VALUES (?, ?, ?, ?, ?, ?)',
        [USER_ID, p.name, p.color || null, p.icon || null, p.percent, JSON.stringify(p.subcategories)]
      );
    }
  });
}

run().then(() => {
  console.log('Seeded categories for planning (user_id=' + USER_ID + ')');
  process.exit(0);
}).catch((e) => {
  console.error('Seed categories failed', e);
  process.exit(1);
});
