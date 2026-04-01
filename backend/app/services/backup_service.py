import os
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Any

from flask import current_app

from app.models import MikroTikRouter
from app.services.mikrotik_service import MikroTikService
from app.services.olt_script_service import OLTScriptService


def _normalized_retention_days(raw_value, default_days: int = 14) -> int:
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        parsed = default_days
    return max(1, min(parsed, 365))


def _prune_backup_dir(backup_dir: str, retention_days: int) -> Dict[str, Any]:
    base = Path(backup_dir)
    if not base.exists():
        return {"scanned": 0, "removed": 0, "failed": 0, "retention_days": retention_days}

    cutoff = datetime.utcnow() - timedelta(days=retention_days)
    scanned = 0
    removed = 0
    failed = 0
    for file_path in base.iterdir():
        if not file_path.is_file() or file_path.is_symlink():
            continue
        scanned += 1
        try:
            modified = datetime.utcfromtimestamp(file_path.stat().st_mtime)
            if modified < cutoff:
                file_path.unlink()
                removed += 1
        except Exception:
            failed += 1
    return {
        "scanned": scanned,
        "removed": removed,
        "failed": failed,
        "retention_days": retention_days,
        "cutoff": cutoff.isoformat(),
    }


def run_backups() -> Dict[str, Any]:
    results: Dict[str, Any] = {"pg_dump": None, "mikrotik": [], "olt": []}
    backup_dir = current_app.config.get('BACKUP_DIR') or os.environ.get('BACKUP_DIR', '/app/backups')
    os.makedirs(backup_dir, exist_ok=True)

    # DB backup
    try:
        db_url = current_app.config.get('SQLALCHEMY_DATABASE_URI') or os.environ.get('DATABASE_URL')
        pg_dump_path = current_app.config.get('PG_DUMP_PATH', 'pg_dump')
        if db_url and db_url.startswith('postgres'):
            outfile = os.path.join(backup_dir, f"db_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.sql")
            subprocess.check_call([pg_dump_path, db_url, '-f', outfile])
            results["pg_dump"] = outfile
        else:
            results["pg_dump"] = "SKIPPED (no Postgres DATABASE_URL)"
    except Exception as exc:
        current_app.logger.error("Backup DB failed: %s", exc, exc_info=True)
        results["pg_dump"] = f"ERROR: {exc}"

    # MikroTik config backup
    try:
        routers = MikroTikRouter.query.filter_by(is_active=True).all()
        for r in routers:
            with MikroTikService(r.id) as mk:
                res = mk.backup_configuration(name=f"auto_{r.name}_{datetime.utcnow().strftime('%Y%m%d')}")
                results["mikrotik"].append({"router": r.name, "success": bool(res.get('success')), "detail": res})
    except Exception as exc:
        current_app.logger.error("Backup MikroTik failed: %s", exc, exc_info=True)
        results["mikrotik"].append({"error": str(exc)})

    # OLT backup (transcript saved; run_mode simulate by default)
    try:
        olt_service = OLTScriptService()
        devices = olt_service.list_devices()
        for d in devices:
            device_id = d.get("id")
            if not device_id:
                continue
            run_mode = os.environ.get("OLT_BACKUP_MODE", "simulate").lower()
            script = olt_service.generate_script(device_id=device_id, action="backup_running_config", payload={})

            fname = os.path.join(backup_dir, f"olt_{device_id}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}.txt")
            with open(fname, "w", encoding="utf-8") as fh:
                fh.write(script.get("script", ""))
                fh.write("\n\nQuick connect:\n")
                quick = script.get("quick_connect", {}) or {}
                for k, v in quick.items():
                    fh.write(f"[{k}] {v}\n")

            live_attempt = None
            if run_mode == "live":
                try:
                    commands = script.get("commands") or script.get("script", "").splitlines()
                    if commands:
                        live_result = olt_service.execute_script(
                            device_id=device_id,
                            commands=commands,
                            run_mode="live",
                            actor="backup_task",
                            source_ip="127.0.0.1",
                        )
                        live_attempt = {"success": live_result.get("success"), "status": live_result.get("status")}
                except Exception as exc2:
                    live_attempt = {"error": str(exc2)}

            results["olt"].append({"olt_device": device_id, "file": fname, "run_mode": run_mode, "live": live_attempt})
    except Exception as exc:
        current_app.logger.error("Backup OLT failed: %s", exc, exc_info=True)
        results.setdefault("olt", []).append({"error": str(exc)})

    retention_days = _normalized_retention_days(current_app.config.get('BACKUP_RETENTION_DAYS', 14))
    results["prune"] = _prune_backup_dir(backup_dir, retention_days)

    return results
