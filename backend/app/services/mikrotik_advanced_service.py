"""
Advanced MikroTik Service with v6/v7 support
"""
from typing import Any, Dict
import logging
import re
from datetime import datetime
from routeros_api.exceptions import RouterOsApiError

from app.models import Client, Plan, MikroTikRouter
from app import db
from .mikrotik_connection_pool import (
    mikrotik_connection_pool,
)  # Import the global pool instance

logger = logging.getLogger(__name__)

class MikroTikAdvancedService:
    """Advanced MikroTik management service"""
    
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()

    def __init__(self, router_id: str):
        self.connection = None
        self.api = None
        self.router_id = router_id
        self.router = None
        self.routeros_version = None
        self.capsman_supported = False
        self.connect()
    
    def connect(self) -> bool:
        """Establish connection to MikroTik router using the connection pool"""
        try:
            self.router = db.session.get(MikroTikRouter, self.router_id)
            if not self.router:
                logger.error(f"Router {self.router_id} not found in database.")
                return False

            self.api, self.connection = mikrotik_connection_pool.get_connection(self.router_id)
            
            # Detect router info
            self._detect_router_info()
            logger.info(f"Connected to MikroTik {self.router.ip_address} - v{self.routeros_version} using connection from pool.")

            # Update last seen
            if self.router:
                self.router.last_seen = datetime.utcnow()
                db.session.commit()
            
            return True
            
        except Exception as e:
            logger.error(f"Error getting connection from pool for MikroTik {self.router_id}: {e}")
            return False
    
    def _detect_router_info(self):
        """Detect router version and capabilities"""
        try:
            system_resource = self.api.get_resource('/system/resource')
            system_info = system_resource.get()
            
            if system_info:
                version = system_info[0].get('version', '6.0')
                self.routeros_version = self._parse_version(version)
                
                # Detect CAPsMAN support
                try:
                    capsman_check = self.api.get_resource('/caps-man')
                    capsman_check.get()
                    self.capsman_supported = True
                except Exception as e:
                    self.capsman_supported = False
                    logger.warning(f"Error checking CAPsMAN support: {e}")
                    
        except RouterOsApiError as e:
            logger.warning(f"MikroTik API error detecting router info: {e}")
            self.routeros_version = "6.0"
        except Exception as e:
            logger.warning(f"Could not detect router info: {e}")
            self.routeros_version = "6.0"
    
    def _parse_version(self, version_str: str) -> str:
        """Parse RouterOS version"""
        match = re.search(r'(\d+\.\d+)', version_str)
        return match.group(1) if match else "6.0"
    
    def is_v7(self) -> bool:
        """Check if RouterOS v7+"""
        try:
            return float(self.routeros_version) >= 7.0
        except ValueError:
            return False
    
    def provision_client(self, client: Client, plan: Plan) -> Dict[str, Any]:
        """Provision a new client with advanced configuration"""
        results = {
            'success': False,
            'steps': {},
            'errors': []
        }
        
        try:
            # 1. Configure IP address
            if client.ip_address and client.connection_type == 'static':
                results['steps']['ip_config'] = self._configure_static_ip(client)
            
            # 2. Create DHCP lease if needed
            if client.mac_address:
                results['steps']['dhcp_lease'] = self._create_dhcp_lease(client)
            
            # 3. Apply advanced QoS
            results['steps']['qos'] = self._apply_advanced_qos(client, plan)
            
            # 4. Configure firewall rules
            results['steps']['firewall'] = self._configure_client_firewall(client)
            
            # 5. Set up WiFi if CPE has wireless
            results['steps']['wifi'] = self._configure_client_wifi(client)
            
            # Check if all steps were successful
            all_success = all(results['steps'].values())
            results['success'] = all_success
            
            if all_success:
                logger.info(f"Successfully provisioned client {client.full_name}")
            else:
                logger.warning(f"Partial success provisioning client {client.full_name}")
                
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error provisioning client: {e}")
            results['errors'].append(f"MikroTik API Error: {e}")
        except Exception as e:
            logger.error(f"Unexpected error provisioning client: {e}")
            results['errors'].append(f"Unexpected Error: {e}")
        
        return results
    
    def _configure_static_ip(self, client: Client) -> bool:
        """Configure static IP for client"""
        try:
            ip_api = self.api.get_resource('/ip/address')
            ip_api.add(
                address=f"{client.ip_address}/32",
                interface="bridge-local",
                comment=f"Cliente: {client.full_name}"
            )
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring static IP: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring static IP: {e}")
            return False
    
    def _create_dhcp_lease(self, client: Client) -> bool:
        """Create DHCP lease for client"""
        try:
            dhcp_api = self.api.get_resource('/ip/dhcp-server/lease')
            dhcp_api.add(
                address=client.ip_address,
                mac_address=client.mac_address,
                comment=f"Cliente: {client.full_name}",
                server="dhcp1",
                disabled="no"
            )
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error creating DHCP lease: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error creating DHCP lease: {e}")
            return False
    
    def _apply_advanced_qos(self, client: Client, plan: Plan) -> bool:
        """Apply advanced QoS configuration"""
        try:
            if self.is_v7():
                return self._apply_v7_qos(client, plan)
            else:
                return self._apply_v6_qos(client, plan)
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error applying QoS: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error applying QoS: {e}")
            return False
    
    def _apply_v7_qos(self, client: Client, plan: Plan) -> bool:
        """Apply v7 QoS with Cake"""
        try:
            queue_api = self.api.get_resource('/queue/simple')
            
            # Configure burst if available
            burst_limit = ""
            if plan.burst_download and plan.burst_upload:
                burst_limit = f"{plan.burst_download}M/{plan.burst_upload}M"
            
            queue_api.add(
                name=f"client_{client.id}",
                target=client.ip_address,
                max_limit=f"{plan.download_speed}M/{plan.upload_speed}M",
                burst_limit=burst_limit,
                burst_threshold=f"{plan.download_speed * 0.8}M/{plan.upload_speed * 0.8}M",
                burst_time="30s",
                queue="cake",
                comment=f"Cliente: {client.full_name} - Plan: {plan.name}"
            )
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error applying v7 QoS: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error applying v7 QoS: {e}")
            return False
    
    def _apply_v6_qos(self, client: Client, plan: Plan) -> bool:
        """Apply v6 QoS with PCQ"""
        try:
            # Create PCQ queue types if they don't exist
            queue_type_api = self.api.get_resource('/queue/type')
            
            # Check if PCQ types exist
            existing_types = queue_type_api.get()
            pcq_download_exists = any(t.get('name') == 'PCQ_Download' for t in existing_types)
            pcq_upload_exists = any(t.get('name') == 'PCQ_Upload' for t in existing_types)
            
            if not pcq_download_exists:
                queue_type_api.add(
                    name="PCQ_Download",
                    kind="pcq",
                    **{'pcq-rate': '0', 'pcq-limit': '50', 'pcq-classifier': 'dst-address'}
                )
            
            if not pcq_upload_exists:
                queue_type_api.add(
                    name="PCQ_Upload",
                    kind="pcq",
                    **{'pcq-rate': '0', 'pcq-limit': '50', 'pcq-classifier': 'src-address'}
                )
            
            # Create queue
            queue_api = self.api.get_resource('/queue/simple')
            queue_api.add(
                name=f"client_{client.id}",
                target=client.ip_address,
                max_limit=f"{plan.download_speed}M/{plan.upload_speed}M",
                burst_limit=f"{plan.burst_download}M/{plan.burst_upload}M" if plan.burst_download else "",
                burst_threshold=f"{plan.download_speed * 0.8}M/{plan.upload_speed * 0.8}M",
                burst_time="30s",
                queue="PCQ_Download/PCQ_Upload",
                comment=f"Cliente: {client.full_name}"
            )
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error applying v6 QoS: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error applying v6 QoS: {e}")
            return False
    
    def _configure_client_firewall(self, client: Client) -> bool:
        """Configure firewall rules for client"""
        try:
            firewall_api = self.api.get_resource('/ip/firewall/filter')
            
            # Allow client traffic
            firewall_api.add(
                chain="forward",
                src_address=client.ip_address,
                action="accept",
                comment=f"Permitir cliente: {client.full_name}"
            )
            
            # Block dangerous ports
            dangerous_ports = "135,137,138,139,445,1433,1434,3389"
            firewall_api.add(
                chain="forward",
                src_address=client.ip_address,
                protocol="tcp",
                dst_port=dangerous_ports,
                action="drop",
                comment=f"Bloquear puertos peligrosos: {client.full_name}"
            )
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring firewall: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring firewall: {e}")
            return False
    
    def _configure_client_wifi(self, client: Client) -> bool:
        """Configure WiFi for client CPE"""
        try:
            # Check if wireless interface exists
            wireless_api = self.api.get_resource('/interface/wireless')
            interfaces = wireless_api.get()
            
            if not interfaces:
                logger.info("No wireless interfaces found, skipping WiFi config")
                return True
            
            # Configure first wireless interface
            ssid = f"ISPMAX-{client.full_name.split()[0]}"
            wireless_api.set(
                numbers="0",
                disabled="no",
                ssid=ssid,
                security_profile="default"
            )
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring WiFi: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring WiFi: {e}")
            return False
    
    def get_router_metrics(self) -> Dict[str, Any]:
        """Get advanced router metrics"""
        try:
            metrics = {}
            
            # System resource metrics
            system_resource = self.api.get_resource('/system/resource')
            system_info = system_resource.get()[0]
            metrics['system'] = {
                'cpu_load': system_info.get('cpu-load'),
                'free_memory': system_info.get('free-memory'),
                'total_memory': system_info.get('total-memory'),
                'uptime': system_info.get('uptime'),
                'version': system_info.get('version'),
                'board_name': system_info.get('board-name')
            }
            
            # Interface metrics
            interface_api = self.api.get_resource('/interface')
            interfaces = interface_api.get()
            metrics['interfaces'] = []
            
            for interface in interfaces:
                metrics['interfaces'].append({
                    'name': interface.get('name'),
                    'type': interface.get('type'),
                    'rx_bytes': interface.get('rx-byte'),
                    'tx_bytes': interface.get('tx-byte'),
                    'rx_packets': interface.get('rx-packet'),
                    'tx_packets': interface.get('tx-packet'),
                    'running': interface.get('running') == 'true'
                })
            
            # Queue metrics
            queue_api = self.api.get_resource('/queue/simple')
            queues = queue_api.get()
            metrics['queues'] = []
            
            for queue in queues[:10]:  # Limit to first 10 queues
                metrics['queues'].append({
                    'name': queue.get('name'),
                    'target': queue.get('target'),
                    'rate': queue.get('rate'),
                    'packet_rate': queue.get('packet-rate'),
                    'queued_bytes': queue.get('queued-bytes'),
                    'queued_packets': queue.get('queued-packets')
                })
            
            return metrics
            
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error getting router metrics: {e}")
            return {'error': f"MikroTik API Error: {e}"}
        except Exception as e:
            logger.error(f"Unexpected error getting router metrics: {e}")
            return {'error': f"Unexpected Error: {e}"}
    
    def backup_configuration(self, backup_name: str = None, backup_password: str = "") -> bool:
        """Backup router configuration"""
        try:
            if not backup_name:
                backup_name = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            backup_api = self.api.get_resource('/system/backup')
            
            backup_api.add(
                name=backup_name,
                password=backup_password
            )
            
            logger.info(f"Backup created: {backup_name}")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error creating backup: {e}")
            return False
        except Exception as e:
            logger.error(f"Error creating backup: {e}")
            return False
    
    def reboot_router(self) -> bool:
        """Reboot router"""
        try:
            system_api = self.api.get_resource('/system')
            system_api.call('reboot')
            logger.info("Router reboot initiated")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error rebooting router: {e}")
            return False
        except Exception as e:
            logger.error(f"Error rebooting router: {e}")
            return False
    
    def disconnect(self):
        """Release connection back to the pool"""
        if self.api and self.connection:
            mikrotik_connection_pool.release_connection(self.router_id, self.api, self.connection)
            self.api = None
            self.connection = None
