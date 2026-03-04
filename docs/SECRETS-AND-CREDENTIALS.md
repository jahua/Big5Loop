# Keys and Credentials

How CareLoop stores and uses keys and credentials (aligned with Technical Specification §17.4).

---

## Rule: No secrets in code or in Git

- **Never** hardcode API keys, passwords, or tokens in source code.
- **Never** commit `.env` or any file that contains real secrets.
- Only **`.env.example`** is committed: it lists variable names and placeholder values (e.g. `changeme`).

---

## Where to store credentials

### 1. Local development

| What | Where | Notes |
|------|--------|--------|
| App secrets (DB URL, API keys, N8N URL) | **`.env`** in CareLoop root | Copy from `.env.example`, set real values locally. `.env` is in `.gitignore`. |
| Docker Compose | Reads **`.env`** in current directory | Set `POSTGRES_PASSWORD` (and optionally `POSTGRES_USER`, `POSTGRES_DB`) so `docker compose` can start the DB. |
| N8N (e.g. Postgres) | **N8N’s credential store** | In N8N UI: Settings → Credentials → create “CareLoop PostgreSQL”. Stored encrypted by N8N; not in our repo. |

**Setup:**

```bash
cd CareLoop
cp .env.example .env
# Edit .env and set at least:
#   POSTGRES_PASSWORD=<strong-password>
#   N8N_WEBHOOK_URL=http://localhost:5678   # if different
#   N8N_WEBHOOK_URL or NEXT_PUBLIC_* only if you need to override
```

### 2. Next.js and env vars

- **Server-only** (API routes, server components): use `process.env.SOME_SECRET`. Do **not** prefix with `NEXT_PUBLIC_`.
- **Browser-exposed**: only use `NEXT_PUBLIC_*` for non-sensitive config (e.g. public webhook base URL). **Never** put API keys or passwords in `NEXT_PUBLIC_*`.

So: keep keys in vars like `POSTGRES_PASSWORD`, `N8N_WEBHOOK_URL`, `OPENAI_API_KEY` etc. without the `NEXT_PUBLIC_` prefix so they stay on the server.

### 3. Production / deployed environments

- Prefer a **secret manager** (e.g. Doppler, HashiCorp Vault, AWS Secrets Manager, GCP Secret Manager) and inject values into the process environment at runtime.
- Alternatively, set env vars in the host or container orchestrator (e.g. Kubernetes secrets, Docker env files that are not in the image or repo).
- Do **not** commit production `.env` files or paste production secrets into the repo or CI logs.

---

## What goes in `.env.example`

- **Variable names** and **non-secret defaults** or placeholders.
- Example: `POSTGRES_PASSWORD=changeme` (everyone replaces `changeme` locally).
- Document any required vars in the README or this file so new devs know what to set.

---

## N8N credentials

- Stored inside N8N’s data (e.g. Docker volume `n8n_data`).
- Configure in the N8N UI; do not put N8N credential values in `.env` unless you are passing them into N8N via its env (e.g. `N8N_ENCRYPTION_KEY` for encrypting credentials).
- For Postgres nodes: create a credential in N8N that uses host/user/password; the password can come from your local `.env` if you start N8N with those env vars, or you paste it once in the UI (then it is stored encrypted by N8N).

---

## Checklist

- [ ] `.env` exists locally, is in `.gitignore`, and is never committed.
- [ ] `.env.example` documents all variable names; real secrets are only in `.env` or a secret manager.
- [ ] No API keys or passwords in `NEXT_PUBLIC_*` or in frontend code.
- [ ] Production secrets are supplied via a secret manager or secure env injection, not from the repo.
