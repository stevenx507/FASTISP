"""
MikroTik Management Service
Handles all MikroTik router operations for ISPMAX
"""
from routeros_api.exceptions import RouterOsApiError
from typing import Dict, List, Optional, Tuple
import logging
from datetime import datetime, timedelta
from sqlalchemy import or_
from app.models import Client, Plan, MikroTikRouter, Invoice, Subscription, AuditLog, Ticket
from app import db, cache
from app.services.monitoring_service import MonitoringService
from .mikrotik_connection_pool import mikrotik_connection_pool # Import the global pool instance

logger = logging.getLogger(__name__)

class MikroTikService:
    """Main MikroTik service for ISPMAX"""

    def __enter__(self):
        # We handle connection in __init__ for now, or ensure router_id is passed
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
    
    def __init__(self, router_id: Optional[int] = None):
        self.router = None
        self.api = None
        self.pool_obj = None  # Store the underlying pool object
        self.router_id = None  # Store router_id for pool operations
        if router_id is not None:
            self.connect_to_router(router_id)
    
    def connect_to_router(self, router_id: int) -> bool:
        """Connect to specific router by ID using the connection pool"""
        try:
            normalized_router_id = int(router_id)
        except (TypeError, ValueError):
            logger.error(f"Invalid router_id provided: {router_id}")
            return False

        try:
            self.router_id = normalized_router_id
            self.router = db.session.get(MikroTikRouter, normalized_router_id)
            if not self.router:
                logger.error(f"Router {normalized_router_id} not found in database.")
                return False
            
            self.api, self.pool_obj = mikrotik_connection_pool.get_connection(
                normalized_router_id
            )
            logger.info(f"Connected to MikroTik {self.router.ip_address} using connection from pool.")
            
            # Update last seen
            if self.router:
                self.router.last_seen = datetime.utcnow()
                db.session.commit()
            
            return True
        except Exception as e:
            logger.error(f"Error getting connection from pool for router {router_id}: {e}")
            return False
    
    def provision_client(self, client: Client, plan: Plan, config: Dict = None) -> Dict:
        """
        Provision a new client on MikroTik
        
        Args:
            client: Client model instance
            plan: Plan model instance
            config: Additional configuration options
        
        Returns:
            Dict with success status and details
        """
        results = {
            'success': False,
            'steps': {},
            'errors': [],
            'warnings': []
        }
        if not self.api:
            results['errors'].append("No connection to router.")
            return results
        
        try:
            # Step 1: Configure IP address
            if client.connection_type == 'pppoe':
                results['steps']['pppoe'] = self._configure_pppoe(client, plan)
            elif client.ip_address:
                results['steps']['ip'] = self._configure_static_ip(client)

            # Step 2: DHCP lease if MAC provided
            if client.mac_address:
                results['steps']['dhcp'] = self._create_dhcp_lease(client)

            # Step 3: QoS configuration
            results['steps']['qos'] = self._configure_qos(client, plan)

            # Step 4: Firewall rules
            results['steps']['firewall'] = self._configure_firewall_rules(client, plan)

            # Step 5: WiFi configuration (if applicable)
            results['steps']['wifi'] = self._configure_wifi(client, config)

            # Step 6: Apply features (IPv6, Gaming, VoIP)
            results['steps']['features'] = self._apply_plan_features(client, plan)

            # Check overall success
            successful_steps = [k for k, v in results['steps'].items() if v]
            results['success'] = len(successful_steps) > 0

            if results['success']:
                logger.info(f"Client {client.full_name} provisioned successfully")
                results['message'] = f"Cliente provisionado: {', '.join(successful_steps)}"
            else:
                results['message'] = "Fallo en el provisionamiento"
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error provisioning client {client.id}: {e}")
            results['errors'].append(f"MikroTik API Error: {e}")
        except Exception as e: # Catch other potential non-API errors
            logger.error(f"Unexpected error provisioning client {client.id}: {e}")
            results['errors'].append(f"Unexpected Error: {e}")
        return results
    
    def _configure_pppoe(self, client: Client, plan: Plan) -> bool:
        """Configure PPPoE connection for client"""
        try:
            pppoe_api = self.api.get_resource('/ppp/secret')
            
            # Check if PPPoE profile exists
            profile_name = f"profile_{plan.name.lower().replace(' ', '_')}"
            profile_api = self.api.get_resource('/ppp/profile')
            profiles = profile_api.get()
            
            if not any(p.get('name') == profile_name for p in profiles):
                # Create PPPoE profile (avoid invalid IP fields; rely on rate-limit only)
                profile_api.add(
                    name=profile_name,
                    rate_limit=f"{plan.download_speed}M/{plan.upload_speed}M"
                )
            
            # Add PPPoE secret
            pppoe_api.add(
                name=client.pppoe_username,
                password=client.pppoe_password,
                service="pppoe",
                profile=profile_name,
                comment=f"Cliente: {client.full_name}",
                disabled="no"
            )
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring PPPoE: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring PPPoE: {e}")
            return False
    
    def _configure_static_ip(self, client: Client) -> bool:
        """Register client's static IP in address-list (avoid adding IP to router)"""
        try:
            # Add to address list for easy management
            address_list_api = self.api.get_resource('/ip/firewall/address-list')
            # Avoid duplicates
            existing = address_list_api.get(list="active_clients", address=client.ip_address)
            if not existing:
                address_list_api.add(
                    list="active_clients",
                    address=client.ip_address,
                    comment=f"Cliente: {client.full_name}"
                )
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring static IP (address-list): {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring static IP (address-list): {e}")
            return False
    
    def _create_dhcp_lease(self, client: Client) -> bool:
        """Create DHCP lease for client (auto-select DHCP server)"""
        try:
            dhcp_api = self.api.get_resource('/ip/dhcp-server/lease')
            
            # Check if lease already exists
            existing = dhcp_api.get(mac_address=client.mac_address)
            if existing:
                logger.info(f"DHCP lease already exists for {client.mac_address}")
                return True
            
            # Determine DHCP server to use
            server_api = self.api.get_resource('/ip/dhcp-server')
            servers = server_api.get()
            server_name = None
            # Prefer 'dhcp1' if it exists, else first available
            if servers:
                names = [s.get('name') for s in servers if s.get('name')]
                server_name = 'dhcp1' if 'dhcp1' in names else names[0]
            
            lease_params = {
                'address': client.ip_address,
                'mac_address': client.mac_address,
                'comment': f"Cliente: {client.full_name}",
                'disabled': 'no'
            }
            if server_name:
                lease_params['server'] = server_name
            else:
                logger.warning("No DHCP server found; creating lease without explicit server may fail")
            
            dhcp_api.add(**lease_params)
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error creating DHCP lease: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error creating DHCP lease: {e}")
            return False
    
    # ==================== QoS CONFIGURATION ====================
    
    def _configure_qos(self, client: Client, plan: Plan) -> bool:
        """Configure QoS for client based on plan"""
        try:
            # For PPPoE, rely on /ppp/profile rate-limit instead of simple queue
            if client.connection_type == 'pppoe':
                return True

            queue_api = self.api.get_resource('/queue/simple')
            
            # Determine target (IP)
            target = client.ip_address
            if not target:
                logger.warning("No IP address found for client; skipping QoS queue creation")
                return True
            
            # Configure burst if available
            if plan.burst_download and plan.burst_upload:
                queue_api.add(
                    name=f"client_{client.id}",
                    target=target,
                    max_limit=f"{plan.download_speed}M/{plan.upload_speed}M",
                    comment=f"Cliente: {client.full_name} - Plan: {plan.name}"
                )
                queue_api.set(
                    **{"burst-limit": f"{plan.burst_download}M/{plan.burst_upload}M",
                       "burst-threshold": f"{plan.download_speed * 0.8}M/{plan.upload_speed * 0.8}M",
                       "burst-time": "30s"},
                    name=f"client_{client.id}"
                )
            else:
                queue_api.add(
                    name=f"client_{client.id}",
                    target=target,
                    max_limit=f"{plan.download_speed}M/{plan.upload_speed}M",
                    comment=f"Cliente: {client.full_name} - Plan: {plan.name}"
                )
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring QoS: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring QoS: {e}")
            return False
    
    # ==================== FIREWALL RULES ====================
    
    def _configure_firewall_rules(self, client: Client, plan: Plan) -> bool:
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
            dangerous_ports = "135,137,138,139,445,1433,1434,3389,5432,5900"
            firewall_api.add(
                chain="forward",
                src_address=client.ip_address,
                protocol="tcp",
                dst_port=dangerous_ports,
                action="drop",
                comment=f"Bloquear puertos peligrosos: {client.full_name}"
            )
            
            # Rate limiting
            # Optional basic connection limiting (disabled due to RouterOS syntax specifics)
            # To enable, ensure proper syntax for "connection-limit" matcher like "1000,32"
            # firewall_api.add(
            #     chain="forward",
            #     src_address=client.ip_address,
            #     **{"connection-limit": "1000,32"},
            #     action="drop",
            #     comment=f"Rate limit: {client.full_name}"
            # )
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring firewall: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring firewall: {e}")
            return False
    
    # ==================== WIFI CONFIGURATION ====================
    
    def _configure_wifi(self, client: Client, config: Dict = None) -> bool:
        """Configure WiFi for client CPE"""
        try:
            # Check if wireless interface exists
            wireless_api = self.api.get_resource('/interface/wireless')
            interfaces = wireless_api.get()
            
            if not interfaces:
                logger.info("No wireless interfaces, skipping WiFi config")
                return True
            
            # Default WiFi configuration
            wifi_config = config or {
                'ssid_prefix': 'ISPMAX',
                'security': 'wpa2',
                'band': '2ghz-b/g/n',
                'channel': 'auto'
            }
            
            ssid = f"{wifi_config['ssid_prefix']}_{client.full_name.split()[0]}"
            
            # Configure first wireless interface
            wireless_api.set(
                numbers="0",
                disabled="no",
                ssid=ssid,
                band=wifi_config['band'],
                frequency="auto",
                channel_width="20/40mhz"
            )
            
            # Configure security
            security_api = self.api.get_resource('/interface/wireless/security-profiles')
            security_api.add(
                name=f"profile_{client.id}",
                authentication_types="wpa2-psk",
                mode="dynamic-keys",
                wpa2_pre_shared_key=wifi_config.get('password', 'SecurePass123')
            )
            
            wireless_api.set(
                numbers="0",
                security_profile=f"profile_{client.id}"
            )
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring WiFi: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring WiFi: {e}")
            return False
    
    # ==================== PLAN FEATURES ====================
    
    def _apply_plan_features(self, client: Client, plan: Plan) -> bool:
        """Apply special features based on plan"""
        try:
            features_applied = []
            
            # IPv6 configuration
            if plan.features.get('ipv6'):
                if self._configure_ipv6(client):
                    features_applied.append('ipv6')
            
            # Gaming optimization
            if plan.features.get('gaming'):
                if self._configure_gaming_optimization(client):
                    features_applied.append('gaming')
            
            # VoIP optimization
            if plan.features.get('voip'):
                if self._configure_voip_optimization(client):
                    features_applied.append('voip')
            
            return len(features_applied) > 0
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error applying plan features: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error applying plan features: {e}")
            return False
    
    def _configure_ipv6(self, client: Client) -> bool:
        """Configure IPv6 for client"""
        try:
            # Enable IPv6 on interface
            ipv6_api = self.api.get_resource('/ipv6/address')
            ipv6_api.add(
                address=f"2001:db8::{client.id[-8:]}/64",
                interface="bridge-local",
                comment=f"IPv6 Cliente: {client.full_name}"
            )
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring IPv6: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring IPv6: {e}")
            return False
    
    def _configure_gaming_optimization(self, client: Client) -> bool:
        """Configure gaming optimization"""
        try:
            mangle_api = self.api.get_resource('/ip/firewall/mangle')
            
            # Mark gaming traffic
            mangle_api.add(
                chain="prerouting",
                src_address=client.ip_address,
                protocol="tcp",
                dst_port="27015-27030,3478-3479,4379-4380",
                action="mark-packet",
                new_packet_mark="gaming_traffic",
                passthrough="yes",
                comment=f"Gaming optimization: {client.full_name}"
            )
            
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring gaming optimization: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring gaming optimization: {e}")
            return False
    
    # ==================== CLIENT MANAGEMENT ====================
    

    def _manage_client_status_on_router(self, client: Client, activate: bool, reason: str = "") -> bool:
        """
        Helper to manage client status (suspend/activate) on MikroTik by manipulating
        queues, address lists, and firewall rules.
        """
        try:
            queue_name = f"client_{client.id}"
            queue_api = self.api.get_resource('/queue/simple')
            firewall_api = self.api.get_resource('/ip/firewall/filter')
            address_list_api = self.api.get_resource('/ip/firewall/address-list')

            queues = queue_api.get(name=queue_name)
            if queues:
                queue_id = queues[0]['id']
                queue_api.set(id=queue_id, disabled='no' if activate else 'yes')
            else:
                logger.warning(f"Queue '{queue_name}' not found for client {client.id}. Cannot {'activate' if activate else 'suspend'}.")
                # Depending on desired behavior, could return False or continue
                # For now, we'll continue, as other steps might still be valid.

            if activate:
                # Remove from suspended list
                to_remove = address_list_api.get(list="suspended_clients", address=client.ip_address)
                if to_remove:
                    address_list_api.remove(id=to_remove[0]['id'])
                
                # Remove block rule
                rules = firewall_api.get(comment=f"Cliente suspendido: {client.full_name}")
                for rule in rules:
                    firewall_api.remove(id=rule['id'])
                logger.info(f"Client {client.full_name} activated on router.")
            else: # Suspend
                # Add to suspended list
                existing = address_list_api.get(list="suspended_clients", address=client.ip_address)
                if not existing:
                    address_list_api.add(
                        list="suspended_clients",
                        address=client.ip_address,
                        comment=f"Suspendido: {client.full_name} - Razón: {reason}"
                    )
                
                # Block traffic
                existing_block_rule = firewall_api.get(chain="forward", src_address=client.ip_address, action="drop", comment=f"Cliente suspendido: {client.full_name}")
                if not existing_block_rule: # Avoid adding duplicate rule
                    firewall_api.add(
                        chain="forward",
                        src_address=client.ip_address,
                        action="drop",
                        comment=f"Cliente suspendido: {client.full_name}"
                    )
                logger.info(f"Client {client.full_name} suspended on router: {reason}")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error managing client status for {client.full_name} (activate={activate}): {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error managing client status for {client.full_name} (activate={activate}): {e}")
            return False

    def suspend_client(self, client: Client, reason: str = "non-payment") -> bool:
        """Suspend client access"""
        if not self.api:
            return False
        return self._manage_client_status_on_router(client, activate=False, reason=reason)
    
    def activate_client(self, client: Client) -> bool:
        """Activate suspended client"""
        if not self.api:
            return False
        return self._manage_client_status_on_router(client, activate=True)
    
    def update_client_speed(self, client: Client, new_plan: Plan) -> bool:
        """Update client speed/plan"""
        if not self.api:
            return False
        try:
            queue_name = f"client_{client.id}"
            queue_api = self.api.get_resource('/queue/simple')
            queues = queue_api.get(name=queue_name)
            if queues:
                queue_id = queues[0]['id']
                queue_api.set(id=queue_id, max_limit=f"{new_plan.download_speed}M/{new_plan.upload_speed}M")
            else:
                logger.warning(f"Could not update speed for client {client.id}: queue '{queue_name}' not found.")
                return False # Or attempt to create it if that's the desired logic
            logger.info(f"Client {client.full_name} speed updated to {new_plan.name}")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error updating client speed: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error updating client speed: {e}")
            return False
    
    def toggle_queue_status(self, queue_id: str, disable: bool) -> bool:
        """Enable or disable a simple queue by its ID."""
        if not self.api:
            return False
        try:
            queue_api = self.api.get_resource('/queue/simple')
            queues = queue_api.get(**{'.id': queue_id})
            if not queues:
                logger.warning(f"Queue with ID '{queue_id}' not found for toggling.")
                return False
            
            queue_api.set(id=queue_id, disabled='yes' if disable else 'no')
            logger.info(f"Queue '{queue_id}' has been {'disabled' if disable else 'enabled'}.")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error toggling queue status for ID {queue_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error toggling queue status for ID {queue_id}: {e}")
            return False

    def delete_queue(self, queue_id: str) -> bool:
        """Deletes a simple queue by its ID."""
        if not self.api:
            return False
        try:
            queue_api = self.api.get_resource('/queue/simple')
            # Check if it exists before trying to remove
            queues = queue_api.get(**{'.id': queue_id})
            if not queues:
                logger.warning(f"Queue with ID '{queue_id}' not found for deletion, assuming success.")
                return True # If it doesn't exist, the goal of deletion is achieved.
            
            queue_api.remove(id=queue_id)
            logger.info(f"Queue '{queue_id}' has been deleted.")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error deleting queue with ID {queue_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error deleting queue with ID {queue_id}: {e}")
            return False

    def update_queue_limit(self, queue_id: str, download_speed: str, upload_speed: str) -> bool:
        """Updates the max-limit of a simple queue."""
        if not self.api:
            return False
        try:
            queue_api = self.api.get_resource('/queue/simple')
            # Ensure the queue exists
            if not queue_api.get(**{'.id': queue_id}):
                logger.warning(f"Queue with ID '{queue_id}' not found for updating limit.")
                return False
            
            new_limit = f"{upload_speed}M/{download_speed}M"
            queue_api.set(id=queue_id, max_limit=new_limit)
            logger.info(f"Queue '{queue_id}' max-limit updated to {new_limit}.")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error updating queue limit for ID {queue_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error updating queue limit for ID {queue_id}: {e}")
            return False

    def create_simple_queue(self, name: str, target: str, download_speed: str, upload_speed: str) -> Dict:
        """Creates a new simple queue."""
        if not self.api:
            return {'success': False, 'error': 'No API connection'}
        try:
            queue_api = self.api.get_resource('/queue/simple')
            # Check if a queue with the same name already exists
            if queue_api.get(name=name):
                return {'success': False, 'error': f"Queue with name '{name}' already exists."}

            max_limit = f"{upload_speed}M/{download_speed}M"
            
            # The 'add' command returns a dict with the new item's ID, e.g., {'id': '*C'}
            new_queue_ref = queue_api.add(
                name=name,
                target=target,
                max_limit=max_limit,
                comment="Created via ISPMAX Panel"
            )
            new_queue_id = new_queue_ref.get('id')
            created_queue = queue_api.get(**{'.id': new_queue_id})[0]
            return {'success': True, 'queue': created_queue}
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error creating simple queue '{name}': {e}")
            return {'success': False, 'error': f"MikroTik API Error: {e}"}
        except Exception as e:
            logger.error(f"Unexpected error creating simple queue '{name}': {e}")
            return {'success': False, 'error': f"Unexpected Error: {e}"}

    def update_queue_comment(self, queue_id: str, comment: str) -> bool:
        """Updates the comment of a simple queue."""
        if not self.api:
            return False
        try:
            queue_api = self.api.get_resource('/queue/simple')
            # Ensure the queue exists
            if not queue_api.get(**{'.id': queue_id}):
                logger.warning(f"Queue with ID '{queue_id}' not found for updating comment.")
                return False
            
            queue_api.set(id=queue_id, comment=comment)
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error updating queue comment for ID {queue_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error updating queue comment for ID {queue_id}: {e}")
            return False

    # ==================== ROUTER MANAGEMENT ====================
    
    @cache.memoize(timeout=60) # Cache for 1 minute
    def get_router_info(self) -> Dict:
        """Get router information and status"""
        if not self.api:
            return {}
        try:
            # This method is called by others that manage the connection lifecycle.
            # It doesn't need its own try/finally/disconnect block.
            system_resource = self.api.get_resource('/system/resource')
            system_identity = self.api.get_resource('/system/identity')
            system_routerboard = self.api.get_resource('/system/routerboard')
            
            info = system_resource.get()[0]
            identity = system_identity.get()[0]
            routerboard_data = system_routerboard.get()
            routerboard = routerboard_data[0] if routerboard_data else {}
            
            return {
                'identity': identity.get('name', 'Unknown'),
                'model': routerboard.get('model', 'Unknown'),
                'serial_number': routerboard.get('serial-number', 'Unknown'),
                'firmware': info.get('version', 'Unknown'),
                'uptime': info.get('uptime', 'Unknown'),
                'cpu_load': info.get('cpu-load', 'Unknown'),
                'free_memory': info.get('free-memory', 'Unknown'),
                'total_memory': info.get('total-memory', 'Unknown'),
                'board_name': info.get('board-name', 'Unknown')
            }
        except (RouterOsApiError, IndexError, TypeError) as e:
            logger.error(f"Error getting router info: {e}")
            return {}
    
    @cache.memoize(timeout=30) # Cache for 30 seconds
    def get_interface_stats(self) -> List[Dict]:
        """Get interface statistics"""
        if not self.api:
            return []
        try:
            interface_api = self.api.get_resource('/interface')
            interfaces = interface_api.get()
            
            stats = []
            for interface in interfaces:
                stats.append({
                    'name': interface.get('name'),
                    'type': interface.get('type'),
                    'mtu': interface.get('mtu'),
                    'mac_address': interface.get('mac-address'),
                    'running': interface.get('running') == 'true',
                    'rx_bytes': interface.get('rx-byte', '0'),
                    'tx_bytes': interface.get('tx-byte', '0'),
                    'rx_packets': interface.get('rx-packet', '0'),
                    'tx_packets': interface.get('tx-packet', '0')
                })
            
            return stats
        except (RouterOsApiError, TypeError) as e:
            logger.error(f"Error getting interface stats: {e}")
            return []
    
    @cache.memoize(timeout=30) # Cache for 30 seconds
    def get_queue_stats(self) -> List[Dict]:
        """Get queue statistics"""
        if not self.api:
            return []
        try:
            queue_api = self.api.get_resource('/queue/simple')
            queues = queue_api.get()
            
            stats = []
            for queue in queues[:50]:  # Limit to first 50 queues
                stats.append({
                    'id': queue.get('.id'),
                    'name': queue.get('name', ''),
                    'target': queue.get('target', ''),
                    'max_limit': queue.get('max-limit', ''),
                    'rate': queue.get('rate', ''),
                    'packet_rate': queue.get('packet-rate', ''),
                    'queued_bytes': queue.get('queued-bytes', '0'),
                    'queued_packets': queue.get('queued-packets', '0'),
                    'disabled': queue.get('disabled') == 'true',
                    'comment': queue.get('comment', '')
                })
            
            return stats
        except (RouterOsApiError, TypeError) as e:
            logger.error(f"Error getting queue stats: {e}")
            return []

    @cache.memoize(timeout=30) # Cache for 30 seconds
    def get_firewall_rules(self) -> List[Dict]:
        """Get firewall filter rules."""
        if not self.api:
            return []
        try:
            rule_api = self.api.get_resource('/ip/firewall/filter')
            rules = rule_api.get()
            return rules
        except (RouterOsApiError, TypeError) as e:
            logger.error(f"Error getting firewall rules: {e}")
            return []

    @cache.memoize(timeout=30) # Cache for 30 seconds
    def get_nat_rules(self) -> List[Dict]:
        """Get firewall NAT rules."""
        if not self.api:
            return []
        try:
            rule_api = self.api.get_resource('/ip/firewall/nat')
            rules = rule_api.get()
            return rules
        except (RouterOsApiError, TypeError) as e:
            logger.error(f"Error getting firewall NAT rules: {e}")
            return []

    @cache.memoize(timeout=30) # Cache for 30 seconds
    def get_mangle_rules(self) -> List[Dict]:
        """Get firewall mangle rules."""
        if not self.api:
            return []
        try:
            rule_api = self.api.get_resource('/ip/firewall/mangle')
            rules = rule_api.get()
            return rules
        except (RouterOsApiError, TypeError) as e:
            logger.error(f"Error getting firewall mangle rules: {e}")
            return []

    @cache.memoize(timeout=10) # Cache for 10 seconds
    def get_logs(self, topic: Optional[str] = None, limit: int = 100) -> List[Dict]:
        """Fetch router logs with optional topic and limit."""
        if not self.api:
            return []
        try:
            log_api = self.api.get_resource('/log')
            logs = log_api.get()
            
            # RouterOS logs are newest first, so we reverse to process chronologically if needed,
            # but for diagnosis, recent logs are more important.
            
            if topic:
                logs = [l for l in logs if topic in (l.get('topics') or '')]
            
            if limit and isinstance(limit, int):
                logs = logs[:max(0, limit)]
                
            return logs
        except (RouterOsApiError, TypeError) as e:
            logger.error(f"Error getting router logs: {e}")
            return []
    
    @cache.memoize(timeout=15) # Cache for 15 seconds
    def get_active_connections(self) -> List[Dict]:
        """Get active connections/leases"""
        if not self.api:
            return []
        try:
            connections = []
            
            # DHCP leases
            dhcp_api = self.api.get_resource('/ip/dhcp-server/lease')
            leases = dhcp_api.get()
            for lease in leases:
                if lease.get('status') == 'bound':
                    connections.append({
                        'id': lease.get('.id'),
                        'type': 'dhcp',
                        'address': lease.get('address'),
                        'mac_address': lease.get('mac-address'),
                        'host_name': lease.get('host-name', ''),
                        'status': lease.get('expires-after', 'bound'),
                        'expires': lease.get('expires-after')
                    })
            
            # PPPoE connections
            pppoe_api = self.api.get_resource('/ppp/active')
            pppoe_connections = pppoe_api.get()
            for conn in pppoe_connections:
                connections.append({
                    'id': conn.get('.id'),
                    'type': 'pppoe',
                    'name': conn.get('name'),
                    'address': conn.get('address'),
                    'uptime': conn.get('uptime'),
                    'service': conn.get('service')
                })
            
            return connections
        except (RouterOsApiError, TypeError) as e:
            logger.error(f"Error getting active connections: {e}")
            return []

    def delete_active_connection(self, connection_id: str, connection_type: str) -> bool:
        """Deletes an active connection (DHCP lease or PPPoE active session)."""
        if not self.api:
            return False
        try:
            if connection_type == 'dhcp':
                api_resource = self.api.get_resource('/ip/dhcp-server/lease')
            elif connection_type == 'pppoe':
                api_resource = self.api.get_resource('/ppp/active')
            else:
                logger.warning(f"Unsupported connection type for deletion: {connection_type}")
                return False

            api_resource.remove(id=connection_id)
            logger.info(f"Connection of type '{connection_type}' with ID '{connection_id}' has been deleted.")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error deleting connection with ID {connection_id}: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error deleting connection with ID {connection_id}: {e}")
            return False
    
    def get_all_clients_with_location(self) -> List[Dict]:
        """
        Get all clients from DB with location and enrich with live status.
        This method is designed to feed the NetworkMap component.
        """
        db_clients = Client.query.filter(Client.latitude.isnot(None), Client.longitude.isnot(None)).all()
        
        if not db_clients:
            return []

        if not self.api:
            logger.warning("Could not connect to router to get live client statuses.")
            active_ips = set()
        else:
            active_conns = self.get_active_connections()
            active_ips = {conn['address'] for conn in active_conns if 'address' in conn}
        
        client_map_data = []
        for client in db_clients:
            status = 'active' if client.ip_address in active_ips else 'offline'
            # Simple logic, can be expanded (e.g., check queue stats for 'warning')
            client_map_data.append(client.to_dict() | {'status': status, 'lat': client.latitude, 'lng': client.longitude})
        
        return client_map_data

    def get_client_dashboard_stats(self, client: Client) -> Dict:
        """
        Return client dashboard stats using available telemetry, plan and billing data.
        This avoids synthetic random values in production dashboards.
        """
        try:
            plan_down = float(client.plan.download_speed) if client.plan and client.plan.download_speed else 0.0
            plan_up = float(client.plan.upload_speed) if client.plan and client.plan.upload_speed else 0.0

            download_mbps = 0.0
            upload_mbps = 0.0
            ping_ms: Optional[float] = None
            monthly_usage_gb = 0.0
            connection_up = False

            if client.router_id and (self.router_id != client.router_id or not self.api):
                self.connect_to_router(client.router_id)

            if self.api:
                active_connections = self.get_active_connections()
                for conn in active_connections:
                    ctype = str(conn.get('type') or '').lower()
                    addr = str(conn.get('address') or '')
                    mac = str(conn.get('mac_address') or '').lower()
                    name = str(conn.get('name') or '')

                    if client.connection_type == 'pppoe' and client.pppoe_username:
                        if ctype == 'pppoe' and name == client.pppoe_username:
                            connection_up = True
                            break
                    elif client.ip_address and addr == client.ip_address:
                        connection_up = True
                        break
                    elif client.mac_address and mac and mac == client.mac_address.lower():
                        connection_up = True
                        break

            telemetry_tags = {'router_id': str(client.router_id)} if client.router_id else None
            try:
                monitoring = MonitoringService()

                latest_traffic = monitoring.latest_point('interface_traffic', tags=telemetry_tags)
                if latest_traffic:
                    rx_bytes = float(latest_traffic.get('rx_bytes', 0) or 0)
                    tx_bytes = float(latest_traffic.get('tx_bytes', 0) or 0)
                    download_mbps = max(0.0, rx_bytes * 8 / 1_000_000)
                    upload_mbps = max(0.0, tx_bytes * 8 / 1_000_000)

                latest_router = monitoring.latest_point('router_stats', tags=telemetry_tags)
                if latest_router:
                    for key in ('ping_ms', 'latency_ms', 'wan_latency_ms'):
                        if latest_router.get(key) is not None:
                            ping_ms = float(latest_router.get(key))
                            break

                monthly_series = monitoring.query_metrics('interface_traffic', time_range='-30d', tags=telemetry_tags)
                for point in monthly_series:
                    rx = float(point.get('rx_bytes', 0) or 0)
                    tx = float(point.get('tx_bytes', 0) or 0)
                    monthly_usage_gb += (rx + tx) / (1024 ** 3)
            except Exception as telemetry_exc:
                logger.info("Dashboard stats using telemetry fallback for client %s: %s", client.id, telemetry_exc)

            if plan_down > 0:
                download_mbps = min(download_mbps, plan_down)
            if plan_up > 0:
                upload_mbps = min(upload_mbps, plan_up)

            cap_gb = max(120.0, (plan_down + plan_up) * 4.0) if (plan_down + plan_up) > 0 else 500.0
            monthly_usage_pct = min(100.0, (monthly_usage_gb / cap_gb) * 100.0) if cap_gb > 0 else 0.0

            invoice_query = Invoice.query.join(Subscription, Invoice.subscription_id == Subscription.id)
            if client.tenant_id is not None:
                invoice_query = invoice_query.filter(Subscription.tenant_id == client.tenant_id)

            filters = [Subscription.client_id == client.id]
            if client.user and client.user.email:
                filters.append(Subscription.email == client.user.email)

            next_invoice = (
                invoice_query
                .filter(or_(*filters))
                .filter(Invoice.status.in_(('pending', 'overdue', 'past_due')))
                .order_by(Invoice.due_date.asc())
                .first()
            )

            next_bill_amount = "0.00 USD"
            next_bill_due = "Sin factura pendiente"
            if next_invoice:
                currency = next_invoice.currency or 'USD'
                next_bill_amount = f"{float(next_invoice.total_amount):.2f} {currency}"
                if next_invoice.due_date:
                    delta_days = (next_invoice.due_date - datetime.utcnow().date()).days
                    if delta_days > 1:
                        next_bill_due = f"Vence en {delta_days} dias"
                    elif delta_days == 1:
                        next_bill_due = "Vence manana"
                    elif delta_days == 0:
                        next_bill_due = "Vence hoy"
                    else:
                        next_bill_due = f"Vencida hace {abs(delta_days)} dias"

            if ping_ms is None:
                ping_ms = 10.0 if connection_up else 0.0

            router_online = bool(client.router.is_active) if client.router else True
            if not router_online:
                connection_up = False

            return {
                "currentSpeed": f"{download_mbps:.1f}/{upload_mbps:.1f} Mbps",
                "ping": f"{ping_ms:.1f} ms",
                "monthlyUsage": f"{monthly_usage_pct:.0f}%",
                "nextBillAmount": next_bill_amount,
                "nextBillDue": next_bill_due,
                "deviceCount": 1 if connection_up else 0,
            }
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error getting dashboard stats for client {client.id}: {e}")
            return {'error': f"MikroTik API Error: {e}"}
        except Exception as e:
            logger.error(f"Could not get dashboard stats for client {client.id}: {e}")
            return {'error': f"Unexpected Error: {e}"}

    def get_client_event_history(self, client_id: int) -> List[Dict]:
        """
        Build a real client event timeline from tickets, invoices and audit logs.
        """
        client = db.session.get(Client, client_id)
        if not client:
            return []

        now = datetime.utcnow()
        events: List[Dict] = []

        if client.router:
            router_state = 'online' if client.router.is_active else 'offline'
            events.append(
                {
                    "id": f"router-{client.router.id}",
                    "timestamp": (client.router.last_seen or now).isoformat(),
                    "type": "success" if client.router.is_active else "warning",
                    "message": f"Router {client.router.name} reporta estado {router_state}.",
                }
            )

        tickets = (
            Ticket.query
            .filter_by(client_id=client_id)
            .order_by(Ticket.updated_at.desc())
            .limit(30)
            .all()
        )
        ticket_ids = {ticket.id for ticket in tickets}
        for ticket in tickets:
            ticket_type = 'warning' if ticket.status in ('open', 'in_progress') else 'success'
            if ticket.priority in ('high', 'urgent') and ticket.status in ('open', 'in_progress'):
                ticket_type = 'error'
            events.append(
                {
                    "id": f"ticket-{ticket.id}",
                    "timestamp": (ticket.updated_at or ticket.created_at or now).isoformat(),
                    "type": ticket_type,
                    "message": f"Ticket #{ticket.id} {ticket.status} ({ticket.priority}): {ticket.subject}",
                }
            )

        invoices = (
            Invoice.query
            .join(Subscription, Invoice.subscription_id == Subscription.id)
            .filter(Subscription.client_id == client_id)
            .order_by(Invoice.created_at.desc())
            .limit(20)
            .all()
        )
        for invoice in invoices:
            if invoice.status in ('overdue', 'past_due', 'cancelled'):
                invoice_type = 'error'
            elif invoice.status in ('pending',):
                invoice_type = 'warning'
            else:
                invoice_type = 'success'
            due = invoice.due_date.isoformat() if invoice.due_date else 'sin fecha'
            events.append(
                {
                    "id": f"invoice-{invoice.id}",
                    "timestamp": (invoice.updated_at or invoice.created_at or now).isoformat(),
                    "type": invoice_type,
                    "message": f"Factura #{invoice.id} {invoice.status} (vence {due}).",
                }
            )

        audit_logs = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(150).all()
        for log in audit_logs:
            meta = log.meta if isinstance(log.meta, dict) else {}
            entity_id = str(log.entity_id or '')

            related = False
            if log.entity_type == 'client' and entity_id == str(client_id):
                related = True
            elif log.entity_type == 'ticket' and entity_id.isdigit() and int(entity_id) in ticket_ids:
                related = True
            elif str(meta.get('client_id') or '') == str(client_id):
                related = True
            elif client.user_id and str(meta.get('user_id') or '') == str(client.user_id):
                related = True

            if not related:
                continue

            action = str(log.action or '').strip()
            action_lower = action.lower()
            if any(word in action_lower for word in ('error', 'fail', 'suspend', 'down')):
                event_type = 'error'
            elif any(word in action_lower for word in ('warning', 'retry', 'pending')):
                event_type = 'warning'
            else:
                event_type = 'info'

            events.append(
                {
                    "id": f"audit-{log.id}",
                    "timestamp": (log.created_at or now).isoformat(),
                    "type": event_type,
                    "message": action.replace('_', ' '),
                }
            )

        if not events:
            events.append(
                {
                    "id": f"client-{client_id}-bootstrap",
                    "timestamp": now.isoformat(),
                    "type": "info",
                    "message": "Sin eventos operativos recientes para este cliente.",
                }
            )

        def _event_ts(event: Dict) -> datetime:
            try:
                return datetime.fromisoformat(str(event.get('timestamp') or '').replace('Z', '+00:00'))
            except Exception:
                return now

        return sorted(events, key=_event_ts, reverse=True)[:60]

    def reboot_client_cpe(self, client: Client) -> Tuple[bool, str]:
        """
        Reboots a client's CPE by dropping their active session.
        For PPPoE, it removes the active connection.
        For DHCP, it removes the lease.
        This method assumes it's connected to the correct router via the service instance.
        """
        if not self.api:
            return False, "No active router connection for rebooting CPE."

        try:
            if client.connection_type == 'pppoe' and client.pppoe_username:
                pppoe_api = self.api.get_resource('/ppp/active')
                active_sessions = pppoe_api.get(name=client.pppoe_username)
                if not active_sessions:
                    return False, "El cliente PPPoE no está conectado."
                
                session_id = active_sessions[0].get('.id') or active_sessions[0].get('id')
                if not session_id:
                    return False, "No se pudo identificar la sesion PPPoE activa del cliente."
                pppoe_api.remove(id=session_id)
                logger.info(f"PPPoE session for {client.pppoe_username} dropped to force reboot.")
                return True, "Se envió la señal de reinicio al cliente PPPoE."

            elif client.mac_address:  # Assumes DHCP or static with MAC
                dhcp_lease_api = self.api.get_resource('/ip/dhcp-server/lease')
                active_leases = dhcp_lease_api.get(mac_address=client.mac_address)
                if not active_leases:
                    return False, "El cliente no tiene una concesión DHCP activa."

                lease_id = active_leases[0].get('.id') or active_leases[0].get('id')
                if not lease_id:
                    return False, "No se pudo identificar la concesion DHCP activa del cliente."
                dhcp_lease_api.remove(id=lease_id)
                logger.info(f"DHCP lease for {client.mac_address} removed to force reconnection.")
                return True, "Se envió la señal de reinicio al cliente DHCP."

            return False, "Método de conexión no soportado para reinicio o datos insuficientes."
        except (RouterOsApiError, IndexError, KeyError) as e:
            logger.error(f"Error rebooting CPE for client {client.id}: {e}")
            return False, f"Error en la API del router: {e}"

    # ==================== ADVANCED FEATURES ====================
    
    def configure_hotspot(self, config: Dict) -> bool:
        """Configure hotspot with captive portal"""
        try:
            # Hotspot profile
            profile_api = self.api.get_resource('/ip/hotspot/profile')
            profile_api.add(
                name=config.get('name', 'ISPMAX-Hotspot'),
                html_directory="hotspot",
                login_by="http-chap",
                http_cookie_lifetime=config.get('session_time', '1d')
            )
            
            # Hotspot server
            hotspot_api = self.api.get_resource('/ip/hotspot')
            hotspot_api.add(
                name=config.get('name', 'ISPMAX-Hotspot'),
                interface=config.get('interface', 'bridge-hotspot'),
                address_pool=config.get('pool', 'hotspot-pool'),
                profile=config.get('name', 'ISPMAX-Hotspot')
            )
            
            # User profiles
            user_profile_api = self.api.get_resource('/ip/hotspot/user/profile')
            user_profile_api.add(
                name="1hour",
                address_pool="hotspot-pool",
                rate_limit="2M/1M",
                keepalive_timeout="1h"
            )
            
            # Wall garden (allowed sites without login)
            walled_garden_api = self.api.get_resource('/ip/hotspot/walled-garden')
            for site in config.get('allowed_sites', ['*.stripe.com', '*.google.com']):
                walled_garden_api.add(dst_host=site)
            
            logger.info(f"Hotspot {config.get('name')} configured")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring hotspot: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring hotspot: {e}")
            return False
    
    def configure_multi_wan(self, config: Dict) -> bool:
        """Configure multi-WAN with failover"""
        try:
            # Create route for each WAN
            route_api = self.api.get_resource('/ip/route')
            
            for i, wan in enumerate(config.get('wan_interfaces', [])):
                distance = 1 if i == 0 else 2  # Primary and backup
                route_api.add(
                    dst_address="0.0.0.0/0",
                    gateway=wan.get('gateway'),
                    distance=distance,
                    check_gateway="ping",
                    comment=f"WAN {i+1}: {wan.get('interface')}"
                )
            
            # Configure load balancing if enabled
            if config.get('load_balancing'):
                route_api.add(
                    dst_address="0.0.0.0/0",
                    gateway=",".join([w.get('gateway') for w in config.get('wan_interfaces')]),
                    distance=1,
                    comment="ECMP Load Balancing"
                )
            
            logger.info("Multi-WAN configured")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error configuring multi-WAN: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error configuring multi-WAN: {e}")
            return False
    
    def backup_configuration(self, backup_name: str = None) -> Dict:
        """Backup router configuration"""
        try:
            if not backup_name:
                backup_name = f"backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            
            backup_api = self.api.get_resource('/system/backup')
            backup_api.add(name=backup_name, password="")
            
            # Also export configuration
            # Attempt CLI export to file; RouterOS API typically doesn't return contents
            try:
                export_api = self.api.get_resource('/export')
                export_api.get(file=backup_name)
            except Exception:
                pass
            
            return {
                'success': True,
                'backup_name': backup_name
            }
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error creating backup: {e}")
            return {'success': False, 'error': f"MikroTik API Error: {e}"}
        except Exception as e:
            logger.error(f"Error creating backup: {e}")
            return {'success': False, 'error': str(e)}
    
    def restore_configuration(self, backup_name: str) -> bool:
        """Restore router from backup"""
        try:
            backup_api = self.api.get_resource('/system/backup')
            backup_api.call('load', {'name': backup_name})
            logger.info(f"Configuration restored from {backup_name}")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error restoring backup: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error restoring backup: {e}")
            return False
    
    def reboot_router(self) -> bool:
        """Reboot MikroTik router"""
        try:
            if not self.api:
                return False
            system_api = self.api.get_resource('/system')
            system_api.call('reboot', {})
            logger.info("Router reboot initiated")
            return True
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error rebooting router: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error rebooting router: {e}")
            return False

    def rotate_api_password(self, username: str, new_password: str) -> Dict:
        """Rotate password for an existing RouterOS user."""
        try:
            if not self.api:
                return {'success': False, 'error': 'No active router connection.'}

            user_token = str(username or '').strip()
            secret = str(new_password or '')
            if not user_token:
                return {'success': False, 'error': 'username is required'}
            if len(secret) < 8:
                return {'success': False, 'error': 'new password is too short'}

            user_api = self.api.get_resource('/user')
            users = user_api.get(name=user_token)
            if not users:
                return {'success': False, 'error': f'Router user not found: {user_token}'}

            user_id = users[0].get('.id') or users[0].get('id')
            if not user_id:
                return {'success': False, 'error': f'Unable to resolve router user id: {user_token}'}

            user_api.set(id=user_id, password=secret)
            return {'success': True, 'username': user_token}
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error rotating router password: {e}")
            return {'success': False, 'error': f"MikroTik API Error: {e}"}
        except Exception as e:
            logger.error(f"Unexpected error rotating router password: {e}")
            return {'success': False, 'error': f"Unexpected Error: {e}"}
    
    def execute_script(self, script_content: str) -> Dict:
        """Execute script on router"""
        try:
            script_api = self.api.get_resource('/system/script')
            
            # Create temporary script
            script_name = f"temp_script_{datetime.now().strftime('%H%M%S')}"
            script_api.add(name=script_name, source=script_content)
            # Retrieve script id
            created = script_api.get(name=script_name)
            script_id = None
            if created:
                script_id = created[0].get('.id') or created[0].get('id')
            
            # Execute script by id/numbers
            if script_id:
                result = script_api.call('run', {'numbers': script_id})
                # Remove temporary script
                try:
                    script_api.remove(**({'numbers': script_id} if script_id else {'name': script_name}))
                except Exception:
                    pass
            else:
                # Fallback: try run by name
                result = script_api.call('run', {'numbers': script_name})
                try:
                    script_api.remove(name=script_name)
                except Exception:
                    pass
            
            return {
                'success': True,
                'result': result
            }
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error executing script: {e}")
            return {'success': False, 'error': f"MikroTik API Error: {e}"}
        except Exception as e:
            logger.error(f"Unexpected error executing script: {e}")
            return {'success': False, 'error': f"Unexpected Error: {e}"}
    
    def get_system_health(self) -> Dict:
        """Get comprehensive system health"""
        try:
            # This method is called by an endpoint that manages the connection.
            if not self.api:
                return {'error': 'No active router connection.'}

            health = {
                'timestamp': datetime.utcnow().isoformat() + "Z",
                'router': self.get_router_info(),
                'interfaces': self.get_interface_stats(),
                'queues': len(self.get_queue_stats()),
                'connections': len(self.get_active_connections()),
                'health_score': 100  # Will be calculated
            }
            
            # Calculate health score
            issues = []
            
            # Check CPU
            cpu_load_str = str(health['router'].get('cpu_load', '0')).replace('%', '')
            cpu_load = int(float(cpu_load_str)) if cpu_load_str.isdigit() or cpu_load_str.replace('.', '', 1).isdigit() else 0
            if cpu_load > 80:
                issues.append(f"CPU high: {cpu_load}%")
            
            # Check memory
            free_mem = int(health['router'].get('free_memory', 0))
            total_mem = int(health['router'].get('total_memory', 1))
            memory_usage = ((total_mem - free_mem) / total_mem) * 100
            if memory_usage > 85:
                issues.append(f"Memory high: {memory_usage:.1f}%")
            
            # Check interfaces
            for interface in health['interfaces']:
                if not interface['running'] and interface['type'] != 'bridge':
                    issues.append(f"Interface down: {interface['name']}")
            
            # Adjust health score
            if issues:
                health['health_score'] = max(0, 100 - (len(issues) * 10))
                health['issues'] = issues
            else:
                health['issues'] = []
            
            return health
        except RouterOsApiError as e:
            logger.error(f"MikroTik API error getting system health: {e}")
            return {'error': f"MikroTik API Error: {e}"}
        except Exception as e:
            logger.error(f"Unexpected error getting system health: {e}")
            return {'error': f"Unexpected Error: {e}"}
    
    def disconnect(self):
        """Release connection back to the pool"""
        if self.api and self.pool_obj and self.router_id is not None:
            mikrotik_connection_pool.release_connection(self.router_id, self.api, self.pool_obj)
        self.api = None
        self.pool_obj = None

    # ==== Operational helpers ====

    def suspend_client(self, client: Client) -> bool:
        """Suspend a client by disabling PPP secret or throttling queue + address-list."""
        if not self.api:
            return False
        try:
            if client.connection_type == 'pppoe' and client.pppoe_username:
                secret_api = self.api.get_resource('/ppp/secret')
                secrets = secret_api.get(name=client.pppoe_username)
                if secrets:
                    secret_api.set(id=secrets[0]['.id'], disabled='yes', comment='suspended')
            else:
                # add to address-list "suspended" and set queue to 0
                if client.ip_address:
                    addr_api = self.api.get_resource('/ip/firewall/address-list')
                    addr_api.add(list='suspended', address=client.ip_address, comment=f"Cliente {client.full_name}")
                queue_api = self.api.get_resource('/queue/simple')
                q = queue_api.get(name=f"client_{client.id}")
                if q:
                    queue_api.set(id=q[0]['.id'], max_limit="0/0", comment="suspended")
            return True
        except Exception as e:
            logger.error(f"Suspend client failed: {e}")
            return False

    def activate_client(self, client: Client, plan: Optional[Plan] = None) -> bool:
        """Reactivar cliente (habilitar PPP o restaurar queue)."""
        if not self.api:
            return False
        try:
            if client.connection_type == 'pppoe' and client.pppoe_username:
                secret_api = self.api.get_resource('/ppp/secret')
                secrets = secret_api.get(name=client.pppoe_username)
                if secrets:
                    secret_api.set(id=secrets[0]['.id'], disabled='no', comment=f"Cliente {client.full_name}")
                    if plan:
                        secret_api.set(id=secrets[0]['.id'], profile=f"profile_{plan.name.lower().replace(' ','_')}")
            else:
                if client.ip_address:
                    addr_api = self.api.get_resource('/ip/firewall/address-list')
                    suspended = addr_api.get(list='suspended', address=client.ip_address)
                    for item in suspended:
                        addr_api.remove(id=item['.id'])
                queue_api = self.api.get_resource('/queue/simple')
                q = queue_api.get(name=f"client_{client.id}")
                if q and plan:
                    queue_api.set(id=q[0]['.id'], max_limit=f"{plan.download_speed}M/{plan.upload_speed}M",
                                  comment=f"Cliente {client.full_name} Plan {plan.name}")
            return True
        except Exception as e:
            logger.error(f"Activate client failed: {e}")
            return False

    def change_speed(self, client: Client, plan: Plan) -> bool:
        """Ajustar velocidad según plan."""
        if not self.api:
            return False
        try:
            if client.connection_type == 'pppoe' and client.pppoe_username:
                secret_api = self.api.get_resource('/ppp/secret')
                secrets = secret_api.get(name=client.pppoe_username)
                if secrets:
                    secret_api.set(id=secrets[0]['.id'], profile=f"profile_{plan.name.lower().replace(' ','_')}",
                                   comment=f"Plan {plan.name}")
            else:
                queue_api = self.api.get_resource('/queue/simple')
                q = queue_api.get(name=f"client_{client.id}")
                if q:
                    queue_api.set(id=q[0]['.id'], max_limit=f"{plan.download_speed}M/{plan.upload_speed}M",
                                  comment=f"Plan {plan.name}")
            return True
        except Exception as e:
            logger.error(f"Change speed failed: {e}")
            return False

    def export_backup(self, name: str = None) -> Optional[str]:
        """Solicita backup en el router (archivo .rsc)."""
        if not self.api:
            return None
        try:
            if not name:
                name = f"ispmax-backup-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}"
            system = self.api.get_resource('/system/backup')
            system.call('save', {'name': name, 'dont-encrypt': 'yes'})
            return f"{name}.backup"
        except Exception as e:
            logger.error(f"Backup failed: {e}")
            return None


