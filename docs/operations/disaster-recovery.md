# Disaster Recovery Runbook

## Objectives
- Target RPO: 15 minutes
- Target RTO: 60 minutes

## Backup strategy
1. Database logical backup every 15 minutes (`pg_dump` custom format).
2. Nightly full backup retained for 30 days.
3. Weekly offsite copy (object storage).
4. Validate every backup using `pg_restore --list`.

## Execution script
- Linux/macOS: `scripts/ops/backup-and-verify.sh`
- Windows: `scripts/ops/backup-and-verify.ps1`

## Recovery procedure
1. Freeze writes: scale backend API to zero or enable maintenance mode.
2. Provision clean PostgreSQL instance.
3. Restore most recent valid dump:
   ```bash
   pg_restore --clean --if-exists --no-owner --dbname "$DATABASE_URL" <backup.dump>
   ```
4. Apply any pending schema migrations.
5. Validate health endpoints (`/health`) and critical API paths.
6. Scale backend/workers to normal capacity.
7. Run smoke test suite and monitor NOC alerts.

## Post-incident checklist
- Confirm no data divergence.
- Document timeline and root cause.
- Open action items for preventive controls.
