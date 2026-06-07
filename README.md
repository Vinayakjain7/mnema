# Mnema ⚡

**GitHub stores code. Mnema stores context.**

```bash
npx mnemakit init
```

> Installs as the `mnemakit` package. Prefer a global install? Run `npm i -g mnemakit` and then use the `mnema` command directly.

---

## The problem

Every new AI coding session behaves like a new engineer joining your project.

It doesn't know why you chose PostgreSQL over MongoDB.  
It doesn't know that you tried Redux and moved to Zustand.  
It doesn't know your team only uses Prisma — never raw SQL.  
It suggests patterns you've already rejected.

You re-explain the same context, session after session.

**Mnema fixes this.** It creates a `.mnema/` folder in your repo — a portable Project Brain that any AI coding agent can read to instantly understand your stack, your decisions, and your conventions.

---

## Quick start

```bash
# Analyze your repo and generate a Project Brain
cd your-project
npx mnemakit init

# Record an architectural decision
npx mnemakit learn

# Generate a full project summary
npx mnemakit explain
```

---

## What it does

### `npx mnemakit init`

Scans your repository (`package.json`, `requirements.txt`, `Cargo.toml`, `Dockerfile`, and more), detects your stack, and generates:

```
.mnema/
├── project.json     — machine-readable stack profile
├── brain.md         — human-readable project summary
├── rules.md         — AI behavior rules for your stack
├── skills.md        — portable cross-agent context file
└── decisions/       — architectural decision records (ADRs)
    └── README.md
```

**Example output for a Next.js project:**

```
Detected stack:
  Language        TypeScript
  Framework       Next.js
  Database        PostgreSQL
  ORM             Prisma
  Testing         Vitest
  Deployment      Vercel
```

Auto-generated `rules.md`:
```
- Default all components to Server Components
- Use Prisma for all database operations — do not introduce another ORM
- Use Vitest for all tests — do not introduce Jest
- No `useEffect` + `fetch` for data loading — use Server Components instead
- TypeScript strict mode — no `any` types
```

---

### `npx mnemakit learn`

Record an architectural decision interactively:

```
Decision: Use PostgreSQL
Reason: Complex relational queries needed for reporting
Alternatives considered: MongoDB, PlanetScale
Why alternatives were rejected: MongoDB lacks JOIN support; PlanetScale has no free tier
```

Saves to `.mnema/decisions/001-use-postgresql.md` in ADR format.

Now when an AI agent suggests MongoDB, it can read this decision and understand why it was rejected.

---

### `npx mnemakit explain`

Generates a full project summary — useful for onboarding new developers and AI agents:

```
┌─ Project Brain ─────────────────────────────────────────

  Stack
    Language        TypeScript
    Framework       Next.js
    Database        PostgreSQL
    ORM             Prisma
    Testing         Vitest
    Deployment      Vercel

  Decisions  (3 recorded)
     1. Use PostgreSQL  → Complex relational queries
     2. Zustand over Redux  → Simpler API, less boilerplate
     3. Vitest over Jest  → Faster, native ESM support

  AI Rules  (from .mnema/rules.md)
    ✓ Default to Server Components
    ✓ Prisma for all DB operations
    ✓ Vitest for all tests
    ✓ No useEffect + fetch for data loading
    ✓ TypeScript strict mode — no any
```

---

## How AI agents use it

Point your AI tool at `.mnema/skills.md` — it's a portable context file designed to be read by any AI coding agent:

**In Cursor:** Add to your `.cursorrules`:
```
Read .mnema/skills.md for full project context before writing any code.
Also read .mnema/decisions/ to understand why architectural choices were made.
```

**In Claude Code:** Reference in your `CLAUDE.md`:
```
Project context: .mnema/brain.md
AI rules: .mnema/rules.md
Decisions: .mnema/decisions/
```

**In any agent:** The files are plain Markdown — any LLM can read them.

---

## Commit it

`.mnema/` belongs in your repo, not in `.gitignore`.

It's your team's shared project brain. Every developer, every AI agent, every new session starts with full context.

```bash
git add .mnema/
git commit -m "feat: add project brain"
```

---

## Detected stacks

Mnema currently detects:

**Languages:** TypeScript, JavaScript, Python, Rust  
**Frameworks:** Next.js, Remix, SvelteKit, Astro, Nuxt, Express, Fastify, Hono, FastAPI, Django, Flask, Actix-web, Axum  
**Databases:** PostgreSQL, MySQL, SQLite, MongoDB, Supabase  
**ORMs:** Prisma, Drizzle, SQLAlchemy, Diesel, SQLx, Mongoose  
**Testing:** Vitest, Jest, Pytest, Playwright, Mocha  
**Styling:** Tailwind CSS, Styled Components, Emotion  
**Auth:** NextAuth, Clerk, Lucia, Passport  
**Deployment:** Vercel, Netlify, Fly.io, Railway, Render, Heroku  
**Package managers:** pnpm, bun, yarn, npm  
**CI/CD:** GitHub Actions, GitLab CI  

Missing your stack? [Open a PR](#contributing) — the scanner is easy to extend.

---

## Roadmap

- `mnema sync` — push brain to a team registry
- `mnema diff` — show what changed since last init
- AI-powered brain updates using the Anthropic API
- VS Code extension
- Cursor extension (native `.mnema/` sidebar)
- GitHub Action to keep the brain in sync with the repo

---

## Contributing

The scanner lives in `src/utils/scanner.js`. Adding a new framework is ~5 lines:

```js
if (deps['your-framework']) profile.framework = 'your-framework';
```

Open a PR. We review fast.

---

## License

MIT

---

<p align="center">
  <b>GitHub = source of truth for code</b><br>
  <b>Mnema = source of truth for project context</b>
</p>
