from __future__ import annotations

from datetime import datetime
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple

import redis
from flask import current_app
import os
import subprocess

from app import celery, db, socketio
from app.models import MikroTikRouter, Subscription, Client, AuditLog
from app.services.ai_diagnostic_service import AIDiagnosticService
from app.services.analytics_service import analytics_service
from app.services.mikrotik_service import MikroTikService
from app.services.monitoring_service import MonitoringService
from app.services.noc_automation_service import noc_automation_service
from app.services.olt_script_service import OLTScriptService
from app.services.snmp_service import SNMPRuntimeUnavailable, snmp_service
from app.services.backup_service import run_backups


def _get_redis_client() -> Optional[redis.Redis]:
    redis_url = current_app.config.get('REDIS_URL')
    if not redis_url:
        return None
    try:
        return redis.from_url(redis_url, decode_responses=True)
    except Exception:
        current_app.logger.warning('Redis unavailable for task locking; continuing without lock.')
        return None


def _try_acquire_lock(lock_key: str, ttl_seconds: int) -> Tuple[Optional[redis.Redis], Optional[str], bool]:
    client = _get_redis_client()
    if client is None:
        return None, None, True

    token = hashlib.sha256(f"{lock_key}:{datetime.utcnow().isoformat()}".encode('utf-8')).hexdigest()
    try:
        acquired = bool(client.set(lock_key, token, nx=True, ex=ttl_seconds))
        return client, token, acquired
    except Exception:
        current_app.logger.warning('Failed to acquire Redis lock; continuing task execution.')
        return None, None, True


def _release_lock(client: Optional[redis.Redis], lock_key: str, token: Optional[str]) -> None:
    if client is None or token is None:
        return
    try:
        current = client.get(lock_key)
        if current == token:
            client.delete(lock_key)
    except Exception:
        current_app.logger.warning('Failed to release Redis task lock: %s', lock_key)


def _send_billing_notification(sub: Subscription, message: str) -> None:
    """Send SMS/WhatsApp notification if Twilio is configured."""
    try:
        sid = current_app.config.get('TWILIO_ACCOUNT_SID')
        token = current_app.config.get('TWILIO_AUTH_TOKEN')
        from_number = current_app.config.get('TWILIO_PHONE_NUMBER')
        if not (sid and token and from_number):
            current_app.logger.info('Twilio not configured; skipping billing notification.')
            return
        to = sub.email  # fallback; ideally phone is stored
        # If email looks like phone (digits), append plus
        if to and to.replace('+', '').isdigit():
            to_number = to if to.startswith('+') else f"+{to}"
        else:
            current_app.logger.info('No phone available for billing notification; skipping.')
            return
        from twilio.rest import Client as TwilioClient

        client = TwilioClient(sid, token)
        client.messages.create(body=message, from_=from_number, to=to_number)
        current_app.logger.info('Billing notification sent to %s', to_number)
    except Exception as exc:
        current_app.logger.warning('Failed to send billing notification: %s', exc)


@celery.task(
    bind=True,
    name='app.tasks.poll_mikrotik_metrics',
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={'max_retries': 3},
)
def poll_mikrotik_metrics(self):
    """Poll active routers, persist metrics and evaluate alert rules."""
    lock_key = f"tasks:poll_mikrotik_metrics:{datetime.utcnow().strftime('%Y%m%d%H%M')}"
    lock_client, lock_token, acquired = _try_acquire_lock(lock_key, ttl_seconds=55)
    if not acquired:
        current_app.logger.info('Skipping poll_mikrotik_metrics because lock is already held.')
        return

    monitoring_service = MonitoringService()
    active_routers = MikroTikRouter.query.filter_by(is_active=True).all()
    current_app.logger.info('Starting metrics poll for %s active routers.', len(active_routers))

    snapshots: List[Dict[str, Any]] = []

    try:
        for router in active_routers:
            mikrotik_service = None
            try:
                mikrotik_service = MikroTikService(router_id=router.id)
                api_available = bool(mikrotik_service.api)
                if not api_available:
                    current_app.logger.warning('Could not connect to router %s via API.', router.name)

                if api_available:
                    resources = mikrotik_service.get_router_info(use_snapshot=False)
                    if resources:
                        tags = {'router_name': router.name, 'router_id': str(router.id)}
                        fields = {
                            'cpu_load': int(resources.get('cpu_load', 0)),
                            'free_memory': int(resources.get('free_memory', 0)),
                            'total_memory': int(resources.get('total_memory', 0)),
                            'uptime': str(resources.get('uptime', '0s')),
                        }
                        monitoring_service.write_metric('system_resources', fields, tags)

                    interfaces = mikrotik_service.get_interface_stats()
                    if interfaces:
                        for iface in interfaces:
                            if iface.get('running') and iface.get('type') in ['ether', 'sfp', 'sfp-plus', 'vlan', 'bridge']:
                                tags = {
                                    'router_name': router.name,
                                    'router_id': str(router.id),
                                    'interface_name': iface.get('name'),
                                }
                                fields = {
                                    'rx_bytes': int(iface.get('rx_bytes', 0)),
                                    'tx_bytes': int(iface.get('tx_bytes', 0)),
                                    'rx_packets': int(iface.get('rx_packets', 0)),
                                    'tx_packets': int(iface.get('tx_packets', 0)),
                                }
                                monitoring_service.write_metric('interface_traffic', fields, tags)

                    queues = mikrotik_service.get_queue_stats()
                    if queues:
                        for q in queues:
                            name = q.get('name', '')
                            cid = None
                            if name.startswith('client_'):
                                try:
                                    cid = name.split('_')[1]
                                except Exception as e:
                                    current_app.logger.warning('Failed to parse client ID from queue %s: %s', name, e)
                            
                            tags = {'router_id': str(router.id), 'queue_name': name}
                            if cid: tags['client_id'] = cid
                            
                            fields = {'queued_bytes': int(q.get('queued_bytes', 0))}
                            try:
                                rate_parts = q.get('rate', '0/0').split('/')
                                fields['upload_rate'] = int(rate_parts[0])
                                fields['download_rate'] = int(rate_parts[1])
                            except Exception as e:
                                current_app.logger.warning('Failed to parse queue rates for %s: %s', name, e)
                            monitoring_service.write_metric('client_traffic', fields, tags)

                snmp_profile = snmp_service.router_profile(router)
                if snmp_profile.get('enabled'):
                    try:
                        snmp_result = snmp_service.poll_router_profile(snmp_profile)
                        snmp_service.persist_router_poll(monitoring_service, router, snmp_result)
                    except SNMPRuntimeUnavailable as exc:
                        current_app.logger.info('SNMP runtime unavailable for router %s: %s', router.name, exc)
                    except ValueError as exc:
                        current_app.logger.info('Skipping SNMP poll for router %s: %s', router.name, exc)
                    except Exception as exc:
                        current_app.logger.warning('SNMP poll failed for router %s: %s', router.name, exc)

                if not api_available:
                    continue

                health = mikrotik_service.get_system_health()
                alert_result = noc_automation_service.evaluate(router.id, health)
                snapshot = {
                    'router_id': router.id,
                    'router_name': router.name,
                    'health_score': health.get('health_score', 0),
                    'router': health.get('router', {}),
                    'alerts': alert_result.get('alerts', []),
                }
                snapshots.append(snapshot)

                if alert_result.get('alert_count', 0) > 0:
                    current_app.logger.warning(
                        'NOC alerts triggered for router %s: %s',
                        router.name,
                        json.dumps(alert_result, ensure_ascii=True),
                    )

            except Exception as exc:
                current_app.logger.error(
                    'Unexpected error while polling router %s: %s',
                    router.name,
                    exc,
                    exc_info=True,
                )
            finally:
                if mikrotik_service:
                    mikrotik_service.disconnect()

        daily_kpis = analytics_service.build_daily_network_kpis(snapshots)
        current_app.logger.info('Daily KPI snapshot: %s', json.dumps(daily_kpis, ensure_ascii=True))
        
        # Real-Time 2.0: Emitir estado de salud consolidado a los clientes conectados
        try:
            socketio.emit('health_update', {
                'routers': snapshots,
                'timestamp': datetime.utcnow().isoformat() + 'Z'
            }, namespace='/')
        except Exception as e:
            current_app.logger.warning('Failed to emit health_update via socket: %s', e)

        current_app.logger.info('Finished metrics poll.')
    finally:
        _release_lock(lock_client, lock_key, lock_token)


@celery.task(name='app.tasks.evaluate_noc_alerts')
def evaluate_noc_alerts() -> Dict[str, Any]:
    """Run NOC rule evaluation on current health snapshots."""
    active_routers = MikroTikRouter.query.filter_by(is_active=True).all()
    total_alerts = 0
    evaluated = 0

    for router in active_routers:
        with MikroTikService(router.id) as service:
            if not service.api:
                continue
            health = service.get_system_health()
            result = noc_automation_service.evaluate(router.id, health)
            evaluated += 1
            total_alerts += result.get('alert_count', 0)

    summary = {
        'evaluated_routers': evaluated,
        'total_alerts': total_alerts,
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    }
    current_app.logger.info('NOC evaluation summary: %s', json.dumps(summary, ensure_ascii=True))
    return summary


@celery.task(name='app.tasks.compute_daily_network_kpis')
def compute_daily_network_kpis() -> Dict[str, Any]:
    """Build daily KPI aggregate from current router health state."""
    snapshots = []
    for router in MikroTikRouter.query.filter_by(is_active=True).all():
        with MikroTikService(router.id) as service:
            if not service.api:
                continue
            health = service.get_system_health()
            snapshots.append(
                {
                    'router_id': router.id,
                    'router_name': router.name,
                    'health_score': health.get('health_score', 0),
                    'router': health.get('router', {}),
                    'alerts': [],
                }
            )

    kpis = analytics_service.build_daily_network_kpis(snapshots)
    current_app.logger.info('Daily network KPIs: %s', json.dumps(kpis, ensure_ascii=True))
    return kpis


@celery.task(bind=True, name='app.tasks.execute_router_operation')
def execute_router_operation(self, router_id: int, operation: str, payload: Optional[Dict[str, Any]] = None):
    """Execute idempotent async router operations through worker pool."""
    payload = payload or {}
    lock_key = f"tasks:router_operation:{router_id}:{operation}:{hashlib.sha1(json.dumps(payload, sort_keys=True).encode('utf-8')).hexdigest()}"
    lock_client, lock_token, acquired = _try_acquire_lock(lock_key, ttl_seconds=120)
    if not acquired:
        return {'success': False, 'error': 'Operation is already running'}

    try:
        with MikroTikService(router_id=router_id) as service:
            if not service.api:
                return {'success': False, 'error': 'Could not connect to router'}

            if operation == 'reboot':
                result = service.reboot_router()
                return {'success': bool(result), 'operation': operation}
            if operation == 'backup':
                result = service.backup_configuration(payload.get('name'))
                return {'success': bool(result.get('success')), 'operation': operation, 'details': result}
            if operation == 'execute_script':
                script = payload.get('script', '')
                result = service.execute_script(script)
                return {'success': bool(result.get('success')), 'operation': operation, 'details': result}

            return {'success': False, 'error': f'Unsupported operation: {operation}'}
    finally:
        _release_lock(lock_client, lock_key, lock_token)


@celery.task(name='app.tasks.enforce_billing_status')
def enforce_billing_status() -> Dict[str, Any]:
    """
    Auto-suspende clientes vencidos y reactiva los que volvieron a 'active'.

    FIXES aplicados:
    - FIX #2: Filtra solo suscripciones relevantes (no .all()) con joinedload
              para evitar N+1 queries y respetar el aislamiento multi-tenant.
    - FIX #9: Commit atómico por suscripción con rollback en error,
              eliminando el estado inconsistente entre MikroTik y la DB.
    """
    from sqlalchemy.orm import joinedload

    today = datetime.utcnow().date()
    updated: List[Dict[str, Any]] = []
    errors: List[Dict[str, Any]] = []
    grace_period_days = 3

    # FIX #2: Solo traer suscripciones que realmente necesitan evaluación
    # (con fecha de cobro definida y estado relevante). Eager load del cliente.
    candidate_subs = (
        Subscription.query
        .filter(
            Subscription.status.in_(['active', 'past_due', 'suspended']),
            Subscription.next_charge.isnot(None),
        )
        .options(joinedload(Subscription.client))
        .all()
    )

    current_app.logger.info(
        'enforce_billing_status: evaluando %s suscripciones.', len(candidate_subs)
    )

    for sub in candidate_subs:
        original_status = sub.status

        try:
            # 1. Marcar como past_due si ya pasó la fecha de cobro
            if sub.next_charge < today and sub.status == 'active':
                sub.status = 'past_due'

            client: Optional[Client] = sub.client
            if not client and sub.client_id:
                client = db.session.get(Client, sub.client_id)

            # 2. Lógica de suspensión con período de gracia
            grace_date = sub.next_charge + timedelta(days=grace_period_days)
            is_past_grace = sub.status == 'past_due' and today > grace_date

            if (is_past_grace or sub.status == 'suspended') and client and client.router_id:
                # FIX #9: Primero persistir el estado en DB, luego aplicar en MikroTik
                if sub.status != 'suspended':
                    sub.status = 'suspended'
                    audit = AuditLog(
                        tenant_id=sub.tenant_id,
                        action='auto_suspend',
                        entity_type='client',
                        entity_id=str(client.id),
                        meta={
                            'subscription_id': sub.id,
                            'reason': 'payment_overdue',
                            'next_charge': sub.next_charge.isoformat(),
                            'grace_date': grace_date.isoformat(),
                        },
                    )
                    db.session.add(audit)
                    db.session.add(sub)
                    db.session.commit()  # Commit atómico ANTES de tocar MikroTik

                # Aplicar en MikroTik DESPUÉS de que la DB está consistente
                try:
                    with MikroTikService(client.router_id) as service:
                        service.suspend_client(client, reason='billing')
                except Exception as mt_err:
                    current_app.logger.warning(
                        'MikroTik suspend failed for client %s (DB ya actualizada): %s',
                        client.id, mt_err
                    )

                _send_billing_notification(
                    sub,
                    f'Tu servicio ha sido suspendido por falta de pago '
                    f'(Vencimiento: {sub.next_charge}).'
                )

            elif sub.status == 'active' and client and client.router_id:
                # Reactivación: también commit atómico primero
                if original_status == 'suspended':
                    audit = AuditLog(
                        tenant_id=sub.tenant_id,
                        action='auto_restore',
                        entity_type='client',
                        entity_id=str(client.id),
                        meta={'subscription_id': sub.id, 'reason': 'payment_received'},
                    )
                    db.session.add(audit)

                db.session.add(sub)
                db.session.commit()  # Commit atómico ANTES de tocar MikroTik

                try:
                    with MikroTikService(client.router_id) as service:
                        service.activate_client(client)
                except Exception as mt_err:
                    current_app.logger.warning(
                        'MikroTik activate failed for client %s (DB ya actualizada): %s',
                        client.id, mt_err
                    )
            else:
                # Sin cambio relevante: solo actualizar la suscripción si cambió
                if sub.status != original_status:
                    db.session.add(sub)
                    db.session.commit()

            if sub.status != original_status:
                updated.append({
                    'subscription_id': sub.id,
                    'tenant_id': sub.tenant_id,
                    'from': original_status,
                    'to': sub.status,
                })

        except Exception as exc:
            # Rollback solo de esta suscripción, continuar con las demás
            db.session.rollback()
            errors.append({'subscription_id': sub.id, 'error': str(exc)})
            current_app.logger.error(
                'Error procesando suscripción %s: %s', sub.id, exc, exc_info=True
            )

    summary = {
        'timestamp': datetime.utcnow().isoformat() + 'Z',
        'evaluated': len(candidate_subs),
        'updated': updated,
        'count': len(updated),
        'errors': errors,
        'error_count': len(errors),
    }
    current_app.logger.info('Billing enforcement summary: %s', json.dumps(summary, ensure_ascii=True))
    return summary






@celery.task(name='app.tasks.run_backups')
def run_backups() -> Dict[str, Any]:
    """
    Backup de base de datos (pg_dump) y config de MikroTik.
    """
    # Delegamos la logica a backup_service para mantener una sola fuente.
    from app.services.backup_service import run_backups as run_full_backups
    return run_full_backups()


# ─────────────────────────────────────────────────────────────────────────────
# Pilar 2: Heartbeat / Monitor de conectividad VPN
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(
    bind=True,
    name='app.tasks.heartbeat_check',
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={'max_retries': 2},
)
def heartbeat_check(self) -> Dict[str, Any]:
    """
    Verifica la conectividad de todos los MikroTik via VPN.
    Ejecutado cada minuto por Celery Beat.
    Genera alertas si un router se detecta offline.
    """
    lock_key = f"tasks:heartbeat_check:{datetime.utcnow().strftime('%Y%m%d%H%M')}"
    lock_client, lock_token, acquired = _try_acquire_lock(lock_key, ttl_seconds=55)
    if not acquired:
        current_app.logger.info('Skipping heartbeat_check: lock already held.')
        return {}

    try:
        from app.services.heartbeat_service import run_heartbeat_check
        result = run_heartbeat_check()
        current_app.logger.info(
            'Heartbeat check: online=%s offline=%s total=%s',
            result.get('online', 0), result.get('offline', 0), result.get('total', 0)
        )
        return result
    finally:
        _release_lock(lock_client, lock_key, lock_token)


# ─────────────────────────────────────────────────────────────────────────────
# Pilar 1: Orquestador VPN — tareas asíncronas
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(
    bind=True,
    name='app.tasks.provision_router_vpn',
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={'max_retries': 3},
)
def provision_router_vpn_task(self, router_id: int) -> Dict[str, Any]:
    """
    Provisiona el VPN de un router de forma asíncrona.
    Llamado cuando se crea un nuevo MikroTikRouter.
    """
    try:
        from app.services.vpn_orchestrator import provision_router_vpn
        result = provision_router_vpn(router_id)
        current_app.logger.info(
            'VPN provisioned for router %s: %s',
            router_id, result.get('vpn_username', 'N/A')
        )
        return result
    except Exception as exc:
        current_app.logger.error('Error provisioning VPN for router %s: %s', router_id, exc)
        raise


# ─────────────────────────────────────────────────────────────────────────────
# Pilar 4: Comandos MikroTik — corte, QoS, tráfico
# ─────────────────────────────────────────────────────────────────────────────

@celery.task(
    bind=True,
    name='app.tasks.suspend_client_billing',
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={'max_retries': 3},
)
def suspend_client_billing(self, router_id: int, client_ip: str,
                            client_name: str = "") -> Dict[str, Any]:
    """
    Suspende un cliente por falta de pago via Address List en MikroTik.
    """
    try:
        from app.services.mikrotik_commands import suspend_client_by_ip
        result = suspend_client_by_ip(router_id, client_ip, client_name)
        current_app.logger.info(
            'Client %s (%s) suspended on router %s: %s',
            client_name, client_ip, router_id, result.get('action')
        )
        return result
    except Exception as exc:
        current_app.logger.error(
            'Error suspending client %s on router %s: %s', client_ip, router_id, exc
        )
        raise


@celery.task(
    bind=True,
    name='app.tasks.restore_client_billing',
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_kwargs={'max_retries': 3},
)
def restore_client_billing(self, router_id: int, client_ip: str) -> Dict[str, Any]:
    """Reactiva un cliente eliminándolo de la Address List de morosos."""
    try:
        from app.services.mikrotik_commands import restore_client_by_ip
        result = restore_client_by_ip(router_id, client_ip)
        current_app.logger.info(
            'Client %s restored on router %s: %s', client_ip, router_id, result.get('action')
        )
        return result
    except Exception as exc:
        current_app.logger.error(
            'Error restoring client %s on router %s: %s', client_ip, router_id, exc
        )
        raise


@celery.task(
    bind=True,
    name='app.tasks.update_client_bandwidth',
)
def update_client_bandwidth(self, router_id: int, client_ip: str,
                              client_name: str, download_mbps: int,
                              upload_mbps: int) -> Dict[str, Any]:
    """Actualiza el ancho de banda de un cliente en tiempo real."""
    try:
        from app.services.mikrotik_commands import set_client_bandwidth
        result = set_client_bandwidth(router_id, client_ip, client_name,
                                       download_mbps, upload_mbps)
        current_app.logger.info(
            'Bandwidth updated for %s on router %s: %sMbps/%sMbps',
            client_ip, router_id, download_mbps, upload_mbps
        )
        return result
    except Exception as exc:
        current_app.logger.error(
            'Error updating bandwidth for %s: %s', client_ip, exc
        )
        raise



@celery.task(name='app.tasks.scheduled_ai_diagnostic')
def scheduled_ai_diagnostic() -> Dict[str, Any]:
    """
    Sentinel de IA: Analiza routers con baja salud y genera diagnósticos preventivos.
    """
    current_app.logger.info('Starting AI predictive diagnostic scan...')
    # Seleccionamos routers activos con salud menor a 85
    # En un entorno real, esto consultaría la última salud en Redis
    routers = MikroTikRouter.query.filter_by(is_active=True).all()
    diagnostics_run = 0
    alerts_emitted = 0

    for router in routers:
        # Consultar salud desde Redis (snapshot)
        redis_client = _get_redis_client()
        if not redis_client: continue
        
        snapshot_json = redis_client.get(f"router:snapshot:{router.id}")
        if not snapshot_json: continue
        
        snapshot = json.loads(snapshot_json)
        health_score = float(snapshot.get('health_score', 100))

        # Solo ejecutamos IA si la salud es baja o hay alertas críticas
        if health_score < 85:
            try:
                current_app.logger.info(f"Triggering AI Diagnostic for {router.name} (Score: {health_score})")
                ai_service = AIDiagnosticService(router.id)
                result = ai_service.run_diagnosis()
                
                if result.get('analysis'):
                    diagnostics_run += 1
                    # Emitir alerta NOC via Socket
                    alert_payload = {
                        'title': f'🤖 IA: Diagnóstico Preventivo - {router.name}',
                        'message': result['analysis'][:500] + '...', # Truncar para el toast
                        'router_name': router.name,
                        'severity': 'warning' if health_score > 60 else 'critical'
                    }
                    socketio.emit('noc_alert', alert_payload, namespace='/')
                    alerts_emitted += 1
                    
            except Exception as e:
                current_app.logger.error(f"AI Diagnostic failed for router {router.id}: {e}")

    summary = {
        'diagnostics_run': diagnostics_run,
        'alerts_emitted': alerts_emitted,
        'timestamp': datetime.utcnow().isoformat() + 'Z'
    }
    current_app.logger.info(f"AI diagnostic scan finished: {summary}")
    return summary
