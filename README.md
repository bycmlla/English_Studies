# 📚 My English Journey

Painel pessoal para acompanhar o progresso nos livros **Interchange Fifth Edition** (Cambridge): Intro (A1), 1 (A2), 2 (A2/B1) e 3 (B1), com 16 unidades cada.

- **Frontend:** HTML + CSS + JavaScript puro (sem build) → GitHub Pages (`docs/`)
- **Backend:** Node.js + Express (API REST) → Render (`backend/`)
- **Banco:** PostgreSQL (fonte oficial de todos os dados; nada de SQLite nem `localStorage` para dados)

## Estrutura

```
.
├── docs/                      # Frontend publicado no GitHub Pages
│   ├── index.html
│   ├── config.js              # URL pública da API (não contém segredos)
│   ├── css/styles.css         # Tema claro/escuro, estilo Notion
│   └── js/
│       ├── app.js             # Entrada: login x painel, carregamento, erros
│       ├── api.js             # Cliente REST, sessão (token), retries / servidor lento
│       ├── store.js           # Estado + marcar/desmarcar com rollback em falha
│       ├── progress.js        # Cálculo de progresso (espelha o backend)
│       ├── dashboard.js       # Cabeçalho, visão geral, cartões
│       ├── bookPanel.js       # Unidades e Study Materials
│       ├── settings.js        # Backup (exportar/importar) e sair
│       ├── login.js, ui.js, sync.js, dom.js, theme-init.js
├── backend/
│   ├── migrations/            # SQL versionado (001_init, 002_seed_books_units)
│   ├── src/
│   │   ├── server.js          # Boot: migrations → usuário inicial → listen
│   │   ├── app.js             # Express: helmet, CORS, rotas, erros
│   │   ├── config.js          # Variáveis de ambiente (validação)
│   │   ├── routes/            # Definição das rotas
│   │   ├── controllers/       # Camada HTTP (validação → serviço → resposta)
│   │   ├── services/          # Regras e acesso ao banco (progress, books, materials, notes, backup, auth, users)
│   │   ├── middleware/        # auth (JWT), erros centralizados, log de requisições
│   │   ├── db/                # pool pg e executor de migrations
│   │   └── validators.js
│   ├── tests/                 # node:test + supertest (+ pg-mem)
│   ├── scripts/dev-memory.js  # API de desenvolvimento sem PostgreSQL (dados em memória)
│   └── .env.example
├── render.yaml                # Blueprint opcional do Render
├── docker-compose.yml         # PostgreSQL local
└── README.md
```

> Observação sobre a estrutura: as rotas ficam em `routes/` e os handlers em `controllers/`; como os handlers são finos, existe um único controller de livros que cobre unidades, materiais, anotações, visão geral e backup.

## Funcionalidades

- Quatro cartões (Intro, 1, 2, 3) com indicador colorido, nível, **status** (Não iniciado / Estudando / Concluído), **barra de progresso larga**, porcentagem e "X de 32 atividades concluídas" (com o detalhe `Student's Book a/16 · Workbook b/16`).
- **Student's Book e Workbook acompanhados separadamente**: cada nível tem 16 unidades × 2 = **32 conclusões**; o percentual do nível soma as duas partes. Dentro do cartão há uma barra e uma porcentagem para cada material.
- Cada unidade tem um checkbox para o Student's Book e outro para o Workbook; só fica **"Completa"** quando os dois estão marcados.
- Progresso **calculado dinamicamente** `(concluídas / total) × 100` — 1 unidade de um material = 6,25 %.
- Marcar/desmarcar atualiza as barras na hora, **salva no backend** e, se falhar, **restaura o estado anterior** e oferece "Tentar novamente". O indicador do cabeçalho só diz "Salvo" após a API confirmar.
- **Study Materials** (grupo único "Important links"; internamente usa a chave `student_book`, e a API ainda aceita `workbook` e `audio`): adicionar, editar, abrir e remover links (apenas `http`/`https`).
- **Visão geral**: 64 unidades, unidades completas (Student's Book + Workbook), % geral sobre as 128 atividades e livro em estudo.
- **Backup**: exportar JSON (progresso e links); importar com validação prévia no servidor (dry-run) e confirmação antes de substituir.
- Modo claro/escuro (preferência salva), responsivo, navegação por teclado, `prefers-reduced-motion`.
- Aviso amigável quando o servidor gratuito do Render está "acordando".

## Executar localmente

Pré-requisitos: Node.js 20+ e (opcional) Docker.

### 1. PostgreSQL

```bash
docker compose up -d          # PostgreSQL 16 em localhost:5432 (user/senha/db: journey)
```

Sem Docker, instale o PostgreSQL e crie um banco (veja [Configurar o PostgreSQL](#configurar-o-postgresql)). O banco precisa ser **UTF8** (padrão na maioria dos provedores).

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env          # edite JWT_SECRET, ADMIN_EMAIL e ADMIN_PASSWORD
npm run migrate               # cria tabelas e os 4 livros / 64 unidades (idempotente)
npm run dev                   # http://localhost:3000  (ou: npm start)
```

Ao iniciar, a API também roda as migrations pendentes e cria/atualiza o usuário definido em `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

> Só quer ver a interface sem instalar PostgreSQL? `npm run dev:memory` sobe a API com um banco **em memória** (login `dev@example.com` / `dev-password-123`; dados somem ao parar). Não use em produção.

### 3. Frontend

Sirva a pasta `docs/` em `http://localhost:5500` (origem liberada por padrão no CORS de desenvolvimento):

```bash
npx serve docs -l 5500        # ou: python -m http.server 5500 --directory docs
```

Em `localhost` / `127.0.0.1`, o frontend usa `LOCAL_API_URL` (`http://localhost:3000`) automaticamente.

## Configurar o PostgreSQL

**Local sem Docker**

```sql
CREATE USER journey WITH PASSWORD 'sua-senha';
CREATE DATABASE journey OWNER journey ENCODING 'UTF8';
```

`DATABASE_URL=postgres://journey:sua-senha@localhost:5432/journey`

**Render (ou outro provedor, como Neon/Supabase)**: crie um PostgreSQL gerenciado e copie a *Internal Database URL* (serviço no mesmo Render) ou a *External Database URL* (acesso de fora). Use `DATABASE_SSL=true` para conexões externas; o padrão em `NODE_ENV=production` já é `true`.

**Migrations**: arquivos `backend/migrations/NNN_nome.sql`, executados em ordem, cada um em uma transação, registrados na tabela `schema_migrations`. Rodar de novo não duplica nada.

```bash
cd backend && npm run migrate     # usa DATABASE_URL do .env ou do ambiente
```

**Migration 003 (Workbook):** adiciona a coluna `unit_progress.book_type` (`student_book` | `workbook`) e a inclui na chave primária. Todo progresso já gravado vira `student_book` automaticamente, sem perder nada. Não exige nenhuma ação manual.

No Render isso já acontece sozinho a cada deploy (`RUN_MIGRATIONS_ON_START=true`). Para rodar manualmente: aba **Shell** do serviço → `npm run migrate`.

## Publicar o backend no Render

1. No [Render](https://render.com): **New → PostgreSQL** (plano Free serve para começar) e anote a *Internal Database URL*.
2. **New → Web Service** → conecte o repositório `bycmlla/English_Studies` e configure:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm ci --omit=dev`
   - **Start Command:** `npm start`
   - **Health Check Path:** `/health`
3. Em **Environment**, cadastre as variáveis abaixo (veja a tabela completa mais adiante).
4. **Create Web Service**. Quando estiver "Live", teste `https://SEU-SERVICO.onrender.com/health` → `{"status":"ok","database":"up"}`.

Alternativa: **New → Blueprint** usando o `render.yaml` da raiz (cria banco e serviço; o painel pedirá `ADMIN_EMAIL` e `ADMIN_PASSWORD`).

> Plano gratuito: o serviço hiberna após inatividade e a primeira requisição pode levar cerca de 1 minuto. O frontend avisa isso, tenta de novo automaticamente e "acorda" a API assim que a tela de login abre. Bancos gratuitos do Render podem expirar — confira as regras atuais do plano e mantenha backups (Exportar JSON).

## Publicar o frontend no GitHub Pages

1. Edite [`docs/config.js`](docs/config.js) e coloque a URL real da API em `API_URL` (sem barra no final).
2. Se a API usar um domínio que **não** seja `*.onrender.com`, inclua-o em `connect-src` na meta CSP de [`docs/index.html`](docs/index.html).
3. Uma única vez, no GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   Depois disso, todo push na `main` que altere `docs/` roda o workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml): ele executa os testes e publica a pasta `docs/`. Também dá para publicar manualmente em **Actions → Deploy frontend to GitHub Pages → Run workflow**.
4. O site fica em `https://bycmlla.github.io/English_Studies/`.
5. No Render, defina `CORS_ORIGINS=https://bycmlla.github.io` (apenas a origem, sem `/English_Studies`).

Todos os caminhos são relativos, então funcionam no subdiretório do Pages.

## Variáveis de ambiente (backend)

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `DATABASE_URL` | sim | URL de conexão do PostgreSQL |
| `JWT_SECRET` | sim | Segredo dos tokens, ≥ 32 caracteres (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`) |
| `ADMIN_EMAIL` | sim (1º acesso) | E-mail do usuário único |
| `ADMIN_PASSWORD` | sim (1º acesso) | Senha inicial (≥ 10 caracteres). Guardada só como hash bcrypt; alterar a variável e reiniciar troca a senha |
| `CORS_ORIGINS` | sim em produção | Origens permitidas, separadas por vírgula (ex.: `https://bycmlla.github.io`) |
| `NODE_ENV` | recomendada | `production` no Render |
| `PORT` | não | Render define automaticamente (padrão local 3000) |
| `DATABASE_SSL` | não | `true`/`false`. Padrão: `true` em produção |
| `JWT_EXPIRES_IN` | não | Validade do token (padrão `7d`) |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_WINDOW_MINUTES` | não | Limite de logins que falham por IP (padrão 10 / 15 min) |
| `BCRYPT_ROUNDS` | não | Custo do hash (padrão 12) |
| `RUN_MIGRATIONS_ON_START` | não | `false` desliga as migrations automáticas no boot |
| `TRUST_PROXY` | não | Nº de proxies confiáveis (padrão 1, correto no Render) |
| `LOG_LEVEL` | não | `debug`, `info`, `warn`, `error` |

Frontend: apenas `docs/config.js` (`API_URL`, `LOCAL_API_URL`) — **nenhum segredo**.

## API REST

Todas as rotas `/api/*` (exceto login) exigem `Authorization: Bearer <token>`. Erros seguem `{ "error": { "code", "message", "details?" } }`.

| Método | Rota | Descrição |
| --- | --- | --- |
| GET | `/health` | Saúde da API e do banco (público) |
| POST | `/api/auth/login` | `{ email, password }` → `{ token, expiresAt }` (limitado por IP) |
| GET | `/api/auth/me` | Usuário do token |
| GET | `/api/books` | Livros com progresso: `studentBook` e `workbook` (cada um com `completed`, `percent`, `completedUnitNumbers`), `fullyCompletedUnits`, `completedTasks`/`totalTasks` (32), `percent` e `status` do nível |
| GET | `/api/books/:slug` | Um livro (`intro`, `interchange-1`, `interchange-2`, `interchange-3`) |
| GET | `/api/books/:slug/units` | Unidades 01–16 com o estado de `studentBook` e `workbook` e `completed` (os dois) |
| PUT | `/api/books/:slug/units/:n` | `{ completed: true|false, bookType: "student_book"|"workbook" }` (n entre 1 e 16; `bookType` é opcional e o padrão é `student_book`) |
| GET/POST | `/api/books/:slug/materials` | Listar / criar link (`kind`: `student_book`, `workbook`, `audio`) |
| PUT/DELETE | `/api/books/:slug/materials/:id` | Editar / remover |
| GET/PUT | `/api/books/:slug/notes` | Anotações `{ content }` (até 20 000 caracteres) |
| GET | `/api/progress/overview` | 64 unidades, unidades completas, 128 atividades, % geral, livro atual |
| GET | `/api/backup/export` | Backup JSON (versão 2: `completedUnits` = Student's Book e `workbookCompletedUnits`) |
| POST | `/api/backup/import[?dryRun=true]` | Valida (e, sem `dryRun`, substitui os dados dos livros do arquivo). Aceita backups v1 (sem Workbook): o Workbook existente é preservado |

## Segurança

- Senha com **bcrypt**; sem cadastro público (usuário vem de variáveis de ambiente); respostas de login idênticas para e-mail inexistente/senha errada.
- **JWT HS256** com expiração; limite de tentativas de login (429).
- Queries 100 % parametrizadas; validação de entrada; CORS restrito às origens configuradas; `helmet`; erros 500 sem detalhes internos; logs sem senhas, tokens ou corpos de requisição.
- **Token no frontend:** como Pages e Render ficam em domínios diferentes e cookies de terceiros são bloqueados, o token vai no cabeçalho `Authorization` e fica em `localStorage` (permite usar a mesma conta em vários dispositivos e sobreviver ao fechar o navegador). Mitigações contra XSS: nenhum script de terceiros, CSP restritiva, DOM construído sem `innerHTML`, links externos com `noopener`, token com validade. Sair da conta apaga o token do aparelho.
- Dados (progresso, links, anotações) **não** ficam no `localStorage`; só a sessão e a preferência de tema.

## Testes

```bash
cd backend
npm test
```

57 testes (`node:test`) cobrindo: cálculo de progresso (0, 1, 4, 8, 12, 16 unidades de cada material nos 4 livros; nível com 32 conclusões; unidade completa só com Student's Book + Workbook), migração 003 sobre dados existentes, marcar/desmarcar, persistência e "outro dispositivo", validações e códigos HTTP, autenticação (sem token, expirado, forjado, `alg=none`, limite de tentativas), materiais, anotações, backup (ida e volta, dry-run, arquivos inválidos), CORS, migrations idempotentes, restrições do banco, paridade do cálculo frontend/backend e varredura de segredos no `docs/`.

Os testes de API usam `pg-mem` (PostgreSQL em memória). Além disso, o fluxo completo foi verificado manualmente contra um **PostgreSQL 16 real** e a interface em navegador (desktop, celular 390 px, teclado, modo escuro, falha de rede com rollback, exportar/importar backup).

## Limitações e pendências

- As anotações por livro foram removidas da interface; a API (`/notes`) e o backup ainda as suportam.
- Aplicação de usuário único; o frontend não tem tela para trocar a senha (altere `ADMIN_PASSWORD` e reinicie).
- Token em `localStorage` (trade-off descrito acima); não há revogação individual de tokens além de trocar `JWT_SECRET` (invalida todos).
- O limite de login é por IP e em memória: reinicia com o serviço.
- Importar backup substitui apenas os livros presentes no arquivo.
- A imagem de referência do design não estava disponível no workspace; o visual segue a descrição (estilo Notion). Ajustes finos de cor/espaçamento ficam em `docs/css/styles.css` (variáveis no topo).
- Não foi feito deploy: Render e GitHub Pages precisam ser configurados por você conforme acima.
