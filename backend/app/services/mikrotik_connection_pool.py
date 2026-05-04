"""
MikroTik Connection Pool
Manages a pool of RouterOS API connections for efficiency.
"""
from routeros_api import RouterOsApiPool
from routeros_api.exceptions import RouterOsApiConnectionError
import logging
import threading
import time
from threading import Lock
from queue import Queue, Empty
from app import db
from app.models import MikroTikRouter # To fetch router details

logger = logging.getLogger(__name__)

class MikroTikConnectionPool:
    def __init__(self, max_connections_per_router=5, connection_timeout=10, checkout_timeout=5):
        self.max_connections_per_router = max_connections_per_router
        self.connection_timeout = connection_timeout
        self.checkout_timeout = checkout_timeout
        self._pools = {}  # {router_id: {connections: Queue, lock: Lock, in_use: int}}
        self._pool_lock = Lock() # Protects access to _pools dictionary
        
        # Keep-alive thread to prevent session timeouts and evict dead connections
        self._stop_event = threading.Event()
        self._keep_alive_thread = threading.Thread(target=self._keep_alive_loop, name="MikroTikKeepAlive", daemon=True)
        self._keep_alive_thread.start()

    def _keep_alive_loop(self):
        """Background loop to ping idle connections every 30 seconds."""
        logger.info("MikroTik Keep-Alive thread started.")
        while not self._stop_event.is_set():
            try:
                # Wait 30s but wake up immediately if stop_event is set
                if self._stop_event.wait(30):
                    break
                
                with self._pool_lock:
                    router_ids = list(self._pools.keys())
                
                for rid in router_ids:
                    router_pool = self._pools.get(rid)
                    if not router_pool:
                        continue
                    
                    # We only check idle connections currently in the queue
                    q = router_pool["connections"]
                    num_to_check = q.qsize()
                    
                    for _ in range(num_to_check):
                        if self._stop_event.is_set():
                            return
                        
                        try:
                            api, pool_obj = q.get_nowait()
                            # Use a very short check. If it fails, we discard.
                            if self._is_connection_alive(api):
                                q.put((api, pool_obj))
                            else:
                                logger.debug(f"Evicting dead connection for router {rid} during keep-alive.")
                                try:
                                    pool_obj.disconnect()
                                except Exception:
                                    pass
                        except Empty:
                            break
                        except Exception as e:
                            logger.debug(f"Keep-alive check failed for router {rid}: {e}")
            except Exception as e:
                logger.error(f"Unexpected error in MikroTik keep-alive loop: {e}")


    def _create_new_connection(self, router: MikroTikRouter):
        """Creates and returns a new RouterOS API connection."""
        host = str(router.ip_address or '').strip()
        username = str(router.username or '').strip()
        password = router.password  # decrypted via model property
        try:
            api_port = int(router.api_port or 8728)
        except (TypeError, ValueError):
            api_port = 8728

        if not host:
            raise ValueError(f"Router {router.id} has no ip_address configured.")
        if password is None:
            raise ValueError(
                f"Could not decrypt password for router {router.id} ({host}). "
                "Check ENCRYPTION_KEY and that the password was stored correctly."
            )

        try:
            pool = RouterOsApiPool(
                host=host,
                username=username,
                password=password,
                port=api_port,
                plaintext_login=True,
                use_ssl=False,
                timeout=self.connection_timeout
            )
            api = pool.get_api()
            logger.debug(f"Created new connection for router {router.id} ({host})")
            return api, pool
        except RouterOsApiConnectionError as e:
            logger.error(f"Failed to create new connection to {host}: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error creating connection to {host}: {e}")
            raise

    def _is_connection_alive(self, api) -> bool:
        """Quick check to verify a pooled connection is still usable."""
        try:
            api.get_resource('/system/identity').get()
            return True
        except Exception:
            return False

    def get_connection(self, router_id: int):
        """
        Retrieves a connection from the pool for the given router_id.
        Creates new connections if the pool is not full.
        Bug fixes:
        - Use get_nowait() so the lock is never held while blocking.
        - Increment in_use before releasing the lock to reserve a slot.
        - Perform network I/O (create/validate connection) outside the lock.
        """
        with self._pool_lock:
            if router_id not in self._pools:
                self._pools[router_id] = {
                    "connections": Queue(maxsize=self.max_connections_per_router),
                    "lock": Lock(),
                    "in_use": 0
                }

        router_pool = self._pools[router_id]

        # --- Try to reuse an idle connection (non-blocking) ---
        with router_pool["lock"]:
            try:
                api, pool_obj = router_pool["connections"].get_nowait()
                router_pool["in_use"] += 1
            except Empty:
                api, pool_obj = None, None

        if api is not None:
            # Validate the connection OUTSIDE the lock
            if self._is_connection_alive(api):
                logger.debug(f"Reusing live connection for router {router_id}. In use: {router_pool['in_use']}")
                return api, pool_obj
            # Stale — discard and fall through to create a fresh one
            logger.debug(f"Discarding stale pooled connection for router {router_id}.")
            try:
                pool_obj.disconnect()
            except Exception:
                pass
            with router_pool["lock"]:
                router_pool["in_use"] -= 1
            api, pool_obj = None, None

        # --- Reserve a slot, then create a new connection outside the lock ---
        with router_pool["lock"]:
            if router_pool["in_use"] >= self.max_connections_per_router:
                raise RuntimeError(f"MikroTik connection pool for router {router_id} is exhausted.")
            router_pool["in_use"] += 1  # Reserve slot before releasing lock

        try:
            router_db = db.session.get(MikroTikRouter, router_id)
            if not router_db:
                raise ValueError(f"Router {router_id} not found in database.")
            api, pool_obj = self._create_new_connection(router_db)
            logger.debug(f"Created new connection for router {router_id}. In use: {router_pool['in_use']}")
            return api, pool_obj
        except Exception:
            with router_pool["lock"]:
                router_pool["in_use"] -= 1  # Release reserved slot on failure
            logger.error(f"Could not create a new connection for router {router_id}.")
            raise

    def release_connection(self, router_id: int, api_connection, pool_obj):
        """
        Releases a connection back to the pool.
        """
        if router_id not in self._pools:
            logger.warning(f"Attempted to release connection for unknown router {router_id}.")
            return

        router_pool = self._pools[router_id]
        with router_pool["lock"]:
            if router_pool["in_use"] > 0:
                router_pool["in_use"] -= 1
            
            # Put connection back if there's space
            if not router_pool["connections"].full():
                router_pool["connections"].put((api_connection, pool_obj))
                logger.debug(f"Released connection for router {router_id}. In use: {router_pool['in_use']}")
            else:
                # If pool is full, disconnect and discard
                try:
                    pool_obj.disconnect()
                    logger.debug(f"Discarded connection for router {router_id} (pool full).")
                except Exception as e:
                    logger.warning(f"Error disconnecting discarded connection for {router_id}: {e}")

    def disconnect_router(self, router_id: int):
        """Evict all pooled (idle + in-use count) connections for a specific router.
        Call this whenever the router's ip_address, username, password, or api_port changes,
        and when the router record is deleted, so stale sessions are not reused.
        """
        with self._pool_lock:
            router_pool = self._pools.pop(router_id, None)
        if router_pool is None:
            return
        with router_pool["lock"]:
            while not router_pool["connections"].empty():
                try:
                    api, pool_obj = router_pool["connections"].get_nowait()
                    try:
                        pool_obj.disconnect()
                    except Exception:
                        pass
                except Exception:
                    break
            router_pool["in_use"] = 0
        logger.info(f"Evicted all pooled connections for router {router_id}.")

    def disconnect_all(self):
        """Disconnects all connections in the pool."""
        with self._pool_lock:
            for router_id, router_pool in self._pools.items():
                with router_pool["lock"]:
                    while not router_pool["connections"].empty():
                        api, pool_obj = router_pool["connections"].get_nowait()
                        try:
                            pool_obj.disconnect()
                            logger.debug(f"Disconnected pooled connection for router {router_id}.")
                        except Exception as e:
                            logger.warning(f"Error disconnecting pooled connection for {router_id}: {e}")
                    router_pool["in_use"] = 0
            self._pools.clear()
        logger.info("All MikroTik connections in pool disconnected.")

# Global instance of the connection pool
mikrotik_connection_pool = MikroTikConnectionPool()
