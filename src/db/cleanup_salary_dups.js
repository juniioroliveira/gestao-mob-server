import { query } from './query.js';

function log(msg) { console.log(`[cleanup] ${msg}`); }

async function main() {
  // 1) Contabilizar candidatos: salaries (por salary_id/salary_run_at) com occurred_at NULL
  const rows = await query(
    `SELECT id, salary_id, salary_run_at, occurred_at, description
     FROM transactions
     WHERE occurred_at IS NULL AND (salary_id IS NOT NULL OR description LIKE 'Salário - %')`
  );
  log(`Encontradas ${rows.length} transações de salário com occurred_at NULL`);

  if (!rows.length) {
    log('Nada a remover');
    return;
  }

  // 2) Identificar duplicidades por (salary_id, salary_run_at) quando possível
  const toDelete = new Set();
  const byKey = new Map();
  for (const r of rows) {
    const key = r.salary_id && r.salary_run_at ? `${r.salary_id}|${r.salary_run_at}` : null;
    if (key) {
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(r);
    }
  }
  for (const arr of byKey.values()) {
    // manter uma (arbitrária) e remover o resto
    arr.slice(1).forEach((r) => toDelete.add(r.id));
  }

  // 3) Remover todos os restantes com occurred_at NULL (inclui lançamentos antigos sem salary_id)
  //    Mantemos somente um por chave; os sem chave (antigos) serão removidos todos por segurança.
  for (const r of rows) {
    if (r.salary_id && r.salary_run_at) {
      if (toDelete.has(r.id)) continue; // marcado pela etapa 2
    } else {
      toDelete.add(r.id);
    }
  }

  if (!toDelete.size) {
    log('Nenhum registro para exclusão após deduplicação');
    return;
  }
  const ids = Array.from(toDelete);
  log(`Removendo ${ids.length} transações...`);
  const batch = 100;
  for (let i = 0; i < ids.length; i += batch) {
    const part = ids.slice(i, i + batch);
    const placeholders = part.map(() => '?').join(',');
    await query(`DELETE FROM transactions WHERE id IN (${placeholders})`, part);
  }
  log('Finalizado');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
