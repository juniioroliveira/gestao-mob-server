# gestao-mob-server

Back-end REST para gestão financeira pessoal. API em Node.js + Express com MySQL.

## Sumário

- Visão geral
- Requisitos e configuração
- Executando localmente
- Autenticação
- Rotas de suporte (health e banco)
- CRUDs principais
  - Contas
  - Categorias
  - Transações
  - Sumários
- IA: Extração de transações (sincrono/assíncrono)
  - Fila de ingestão
  - Aprovação e reprocessamento
  - Métricas da fila
- Recorrências (regras e disparo)
- Família (membros e salários)
- Convenções e observações

---

## Visão geral

- Host (produção): `https://api-gestao.dephix.com.br`
- Base URL (produção): `https://api-gestao.dephix.com.br/api`
- Base URL (local): `http://localhost:3001/api`
- Respostas JSON.
- Autenticação via JWT (Bearer). Em algumas rotas é possível passar `?userId=` quando não autenticado (modo demo).
- Logs de requisição incluem método, URL, status, duração, tamanho da resposta, IP, `user-agent` e `uid` (quando autenticado).

## Requisitos e configuração

- Node.js 18+ (recomendado 20+)
- MySQL 8.x
- Variáveis `.env` (exemplos):
  - `PORT=3001`
  - `DB_HOST=localhost`
  - `DB_PORT=3306`
  - `DB_NAME=...`
  - `DB_USER=...`
  - `DB_PASSWORD=...`
  - `JWT_SECRET=...`
  - `GEMINI_API_KEY=...` (para extração via IA)
  - Ingestão (fila):
    - `INGEST_MAX_ATTEMPTS=3`
    - `INGEST_RETRY_BASE_SECONDS=30`
    - `INGEST_RETRY_MAX_SECONDS=3600`
    - `INGEST_STALE_MINUTES=10`
    - `INGEST_PUMP_INTERVAL_MS=3000`

## Executando localmente

```bash
npm install
npm run migrate           # cria as tabelas principais
npm run migrate:tx-null   # torna transactions.occurred_at aceitando NULL
npm run dev               # inicia a API em PORT (padrão 3001)
```

Health:
```bash
curl http://localhost:3001/api/health
# produção
curl https://api-gestao.dephix.com.br/api/health
```

## Autenticação

### Registro
POST `/api/auth/register`
```json
{ "name": "Seu Nome", "email": "email@exemplo.com", "password": "senha" }
```
Resposta:
```json
{ "token":"...", "user": { "id":1, "name":"Seu Nome", "email":"email@exemplo.com" } }
```

### Login
POST `/api/auth/login`
```json
{ "email":"email@exemplo.com", "password":"senha" }
```
Resposta igual ao registro.

### Eu (me)
GET `/api/auth/me` com `Authorization: Bearer <token>`

## Rotas de suporte

### Health
GET `/api/health` → snapshot de variáveis (sem segredos) e valores efetivos.

### Ping DB
GET `/api/db/ping` → `{ ok: 1 }` quando o banco responde; em erro retorna detalhes `{ error, message, code, ... }`.

## Contas

- GET `/api/accounts?userId=...` (quando sem token)
- POST `/api/accounts`
```json
{ "name":"Carteira", "type":"asset", "currency":"BRL", "balance":0 }
```
- PUT `/api/accounts/:id`
- DELETE `/api/accounts/:id`

Campos:
- `type`: `asset` | `liability`
- `currency` (padrão `BRL`), `balance` (padrão 0)

## Categorias

- GET `/api/categories?userId=...`
- POST `/api/categories`
```json
{ "name":"Essencial Fixo", "color":"#3366ff", "icon":"home" }
```
- PUT `/api/categories/:id`
- DELETE `/api/categories/:id`

`name` é único por usuário.

## Transações

### Listar
GET `/api/transactions?type=expense&categoryId=1&accountId=1&from=YYYY-MM-DD HH:mm:ss&to=...&limit=50&offset=0`

### Obter por id
GET `/api/transactions/:id`

### Criar
POST `/api/transactions`
```json
{
  "type":"expense",
  "amount":179.54,
  "occurred_at":"2026-03-28 17:32:00",
  "description":"Conta de Luz - Enel",
  "category_id": 1,
  "account_id": 2,
  "inscricao_federal": "12345678000199",
  "metadata": { "nota":"..." }
}
```
Observação: `occurred_at` pode ser `null` (se a data do documento não for identificada).

### Atualizar
PUT `/api/transactions/:id` (todos os campos opcionais)

### Excluir
DELETE `/api/transactions/:id`

## Sumários

### Patrimônio
GET `/api/summary/net-worth?userId=...`
Resposta: `{ assets, liabilities, netWorth }`

### Gasto por categoria (mês/ano)
GET `/api/summary/category-spend?month=3&year=2026&userId=...`
Resposta: `{ total, from, to, categories:[{ id, name, amount }] }`

### Receita x Despesa (intervalo ou mês/ano)
GET `/api/summary/monthly?from=YYYY-MM-DD HH:mm:ss&to=...`
ou
GET `/api/summary/monthly?month=3&year=2026`
Resposta: `{ from, to, income, expense, delta }`

## IA: Extração de transações

Endpoint: POST `/api/ai/extract-transaction`

Formas de envio:
1) `multipart/form-data` com `file` (imagem/PDF). Exemplos:
```bash
curl -X POST http://localhost:3001/api/ai/extract-transaction?async=1&create=1 \
  -H "Authorization: Bearer <token>" \
  -F file=@/caminho/para/foto.jpg
```
2) JSON com base64:
```json
{ "data":"<base64>", "mimeType":"image/jpeg" }
```

Parâmetros:
- `async=1` e `create=1` → enfileira processamento e cria transação no fim.
- Sem `async` → retorna o objeto inferido pela IA (pode criar transação se `create=1`).

Política de datas (`occurred_at`):
- Faturas/boletos/contas → usa `due_date`/`vencimento`.
- Comprovantes/notas/recibos/cupom → usa `occurred_at_original` (data do documento).
- Nunca usa “agora”; se não identificar, retorna `null`.

Descrição canônica:
- A IA deve padronizar o título (ex.: `Conta de Luz - Enel`) para facilitar categorização histórica.

Categoria:
- Se a IA não definir, o back-end tenta (1) histórico por título canônico, (2) heurísticas por tipo/descrição.

## Fila de ingestão

### Listar jobs
GET `/api/ingest-jobs?status=queued|processing|needs_review|done|failed&userId=...`

### Obter job
GET `/api/ingest-jobs/:id`

### Reprocessar job
POST `/api/ingest-jobs/:id/retry`

### Aprovar job (criar transação com dados revisados)
POST `/api/ingest-jobs/:id/approve`
```json
{
  "type":"expense",
  "amount":179.54,
  "description":"Conta de Luz - Enel",
  "occurred_at":"2026-03-28 17:32:00",
  "category_id":1,
  "inscricao_federal":"12345678000199",
  "metadata":{}
}
```
Se `occurred_at` não for informado e não houver no documento, a transação é criada com `null`.

### Métricas
GET `/api/ingest-jobs/metrics`
Resposta: contagem por status + o job mais antigo em fila/processing.

Resiliência:
- Jobs “processing” travados são refileados automaticamente (stale > `INGEST_STALE_MINUTES`).
- Ao reiniciar o servidor, todos os “processing” voltam para `queued`.
- Backoff exponencial com limite de tentativas (`attempts`/`next_attempt_at`).

## Recorrências

### Listar regras
GET `/api/recurrings?userId=...`

### Criar regra
POST `/api/recurrings`
```json
{
  "type":"expense",
  "amount":100,
  "description":"Assinatura",
  "frequency":"monthly",
  "interval":1,
  "day_of_month":10,
  "start_date":"2026-03-01",
  "end_date":null,
  "account_id":null,
  "category_id":1
}
```
Frequências: `daily`, `weekly` (usar `day_of_week` 0..6), `monthly` (usar `day_of_month` 1..31).

### Atualizar/Excluir
PUT `/api/recurrings/:id`
DELETE `/api/recurrings/:id`

### Rodar regras vencidas
POST `/api/recurrings/run-due?userId=...`
Cria transações conforme `next_run_at` e agenda o próximo disparo.

## Família

### Membros
- GET `/api/family/members?userId=...`
- POST `/api/family/members` `{ name, relation, email, birthdate }` (`relation`: `owner|spouse|child|other`)
- PUT `/api/family/members/:id`
- DELETE `/api/family/members/:id`

### Salários
- GET `/api/family/members/:id/salaries`
- POST `/api/family/members/:id/salaries` `{ amount, currency?, start_date, end_date?, frequency?, active? }`
- GET `/api/family/salaries/:id`
- PUT `/api/family/salaries/:id`
- DELETE `/api/family/salaries/:id`

## Convenções e observações

- Quando autenticado, informe `Authorization: Bearer <token>`.
- Em modo demo ou testes rápidos, muitas rotas aceitam `?userId=` para escopo do usuário.
- Campos `metadata` são sempre objetos serializados.
- `occurred_at` aceita `null` quando não identificável.
- Erros trazem detalhes `{ error, message, code, ... }` para facilitar diagnóstico.
