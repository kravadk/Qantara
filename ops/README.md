# Qantara — Operations & Observability

Drop-in monitoring assets for the backend. The backend already exposes everything
needed; these wire it into standard tooling.

## Metrics (Prometheus + Grafana)

The backend serves Prometheus text at `GET /v1/metrics` (operational gauges +
HTTP request counters/histograms — see `backend/src/lib/operations.ts` and the
request metrics middleware).

- `prometheus.yml` — scrape config (edit `targets` to your backend host:port).
- `alerts.rules.yml` — alerting rules (backend down, RPC down, indexer lag/stale,
  webhook failures, 5xx ratio, p95 latency).
- `grafana-dashboard.json` — import into Grafana (Dashboards → Import) and pick
  your Prometheus datasource.

Quick local stack:

```bash
docker run -d --name prom -p 9090:9090 \
  -v "$PWD/ops/prometheus.yml:/etc/prometheus/prometheus.yml" \
  -v "$PWD/ops/alerts.rules.yml:/etc/prometheus/alerts.rules.yml" \
  prom/prometheus
docker run -d --name grafana -p 3001:3000 grafana/grafana
```

## Logs (structured, ship-ready)

The backend emits newline-delimited JSON logs (one object per line) via
`backend/src/lib/logger.ts`, with a `requestId` on every request log. Set
`LOG_LEVEL` (debug|info|warn|error) and `LOG_PRETTY=true` for local dev.

Because logs are already JSON on stdout/stderr, ship them as-is:

- **Loki**: run promtail/grafana-agent tailing the container stdout; no parser needed.
- **Datadog/CloudWatch**: the platform log driver ingests JSON natively; `requestId`,
  `level`, `time`, and `msg` become first-class fields.
- Correlate a user report to logs by the `X-Request-Id` response header.

## Status page

Expose liveness/readiness for a public or internal status page:

- `GET /v1/health` — full health JSON (db, migrations, RPC, indexer, operational alerts).
- `GET /v1/ready` — 200 when ready, 503 otherwise (DB + migrations + RPC).
- `status-page.html` — static status page that reads the live API. Host it on any static
  origin and pass the backend URL with `?api=https://api.example.com`.

Wire either into a hosted status provider (Betterstack, Statuspage, UptimeRobot)
as an HTTP(S) monitor on `/v1/ready`, or scrape `qantara_backend_up` /
`qantara_operational_healthy` from Prometheus for a Grafana status panel.

## Off-site database backups

`scripts/sqlite-backup.mjs` writes a consistent `VACUUM INTO` snapshot + a SHA-256
manifest. It can upload directly with `aws` or `gsutil` when configured:

```bash
# S3
node scripts/sqlite-backup.mjs \
  --db backend/data/qantara.sqlite \
  --out backups \
  --s3-uri s3://my-bucket/qantara

# GCS
node scripts/sqlite-backup.mjs \
  --db backend/data/qantara.sqlite \
  --out backups \
  --gcs-uri gs://my-bucket/qantara
```

`ops/backup-to-cloud.sh` remains available for Linux cron and wraps the same script.

Schedule it (cron / systemd timer / platform scheduler) daily. Restore with
`scripts/sqlite-restore.mjs` after stopping the backend — see `DEPLOYMENT.md` and
`OPERATIONS_RUNBOOK.md`. Always verify the manifest SHA-256 before restoring.
