"""NOC automation rule engine for proactive alerting."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List


class NocAutomationService:
    def __init__(self, rules_path: str | None = None):
        base_dir = Path(__file__).resolve().parent
        self.rules_path = Path(rules_path) if rules_path else base_dir / 'rules' / 'noc_alert_rules.json'
        self.rules = self._load_rules()

    def _load_rules(self) -> List[Dict[str, Any]]:
        if not self.rules_path.exists():
            return []
        try:
            return json.loads(self.rules_path.read_text(encoding='utf-8'))
        except Exception:
            return []

    @staticmethod
    def _compare(operator: str, current: float, threshold: float) -> bool:
        if operator == 'lt':
            return current < threshold
        if operator == 'lte':
            return current <= threshold
        if operator == 'gt':
            return current > threshold
        if operator == 'gte':
            return current >= threshold
        if operator == 'eq':
            return current == threshold
        return False

    @staticmethod
    def _extract_metrics(health_snapshot: Dict[str, Any]) -> Dict[str, float]:
        router = health_snapshot.get('router', {}) if isinstance(health_snapshot, dict) else {}
        issues = health_snapshot.get('issues', []) if isinstance(health_snapshot, dict) else []

        cpu_raw = str(router.get('cpu_load', '0')).replace('%', '').strip()
        try:
            cpu_load = float(cpu_raw)
        except (TypeError, ValueError):
            cpu_load = 0.0

        try:
            health_score = float(health_snapshot.get('health_score', 100))
        except (TypeError, ValueError):
            health_score = 100.0

        return {
            'health_score': health_score,
            'cpu_load': cpu_load,
            'issues_count': float(len(issues)),
        }

    def evaluate(self, router_id: int, health_snapshot: Dict[str, Any]) -> Dict[str, Any]:
        metrics = self._extract_metrics(health_snapshot)
        alerts: List[Dict[str, Any]] = []

        for rule in self.rules:
            metric_name = rule.get('metric')
            if metric_name not in metrics:
                continue

            current = float(metrics[metric_name])
            threshold = float(rule.get('threshold', 0))
            operator = str(rule.get('operator', 'gt')).lower()
            if self._compare(operator, current, threshold):
                alerts.append(
                    {
                        'rule_id': rule.get('id'),
                        'severity': rule.get('severity', 'medium'),
                        'metric': metric_name,
                        'current': current,
                        'threshold': threshold,
                        'message': rule.get('message', 'Threshold exceeded'),
                        'recommended_action': rule.get('recommended_action', ''),
                    }
                )

        return {
            'router_id': router_id,
            'alerts': alerts,
            'alert_count': len(alerts),
            'metrics': metrics,
        }


noc_automation_service = NocAutomationService()
