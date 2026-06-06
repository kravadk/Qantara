# Qantara — Infrastructure (Terraform)

Deploy-ready IaC scaffolding for the managed-hosting path: **Vercel** (static
frontend) + **Railway** (backend + persistent SQLite volume). This is **not**
applied by CI and requires real credentials.

## Files

- `main.tf` — providers + frontend/backend/volume/domain resources + DNS notes.
- `variables.tf` — inputs (tokens, domains, repo).
- `terraform.tfvars.example` — copy to `terraform.tfvars` and fill.

## Usage

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars   # fill real values
terraform init
terraform plan
terraform apply
```

## What it does NOT manage (on purpose)

- **Runtime secrets** — `API_KEY`, `WEBHOOK_SECRET`, `PAYMENT_INTENT_SECRET`,
  `SIWE_JWT_SECRET`, real `QUSDC_ADDRESS`, `BOT_TOKEN`, `ALERT_*`. Set these in the
  Railway/Vercel dashboards or a secrets manager. Never put them in `.tf`/`.tfvars`
  that could be committed.
- **DNS records** — point `frontend_domain` and `backend_domain` at the Vercel /
  Railway targets via your DNS provider (add a `dns` provider block here if you
  manage DNS in Terraform too).
- **GitHub Actions secrets** — `NPM_TOKEN`, `RAILWAY_TOKEN`, `VERCEL_TOKEN` for the
  `deploy.yml` / `publish.yml` workflows are set in repo settings.

## Self-hosting alternative

If not using Vercel/Railway, deploy the full stack with the Docker Compose path in
`DEPLOYMENT.md` (`docker-compose.production.yml`) on any VPS with a persistent
volume — no Terraform required.
