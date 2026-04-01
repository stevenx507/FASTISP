"""
MikroTik Connection Pool
Manages a pool of RouterOS API connections for efficiency.
"""
from routeros_api import RouterOsApiPool
from routeros_api.exceptions import RouterOsApiConnectionError
import logging
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

    def _create_new_connection(self, router: MikroTikRouter):
        """Creates and returns a new RouterOS API connection."""
        try:
            pool = RouterOsApiPool(
                host=router.ip_address,
                username=router.username,
                password=router.password, # Decrypted password from model property
                port=router.api_port,
                plaintext_login=True,
                use_ssl=False,
            )
            api = pool.get_api()
            logger.debug(f"Created new connection for router {router.id} ({router.ip_address})")
            return api, pool # Return both api and the underlying pool object
        except RouterOsApiConnectionError as e:
            logger.error(f"Failed to create new connection to {router.ip_address}: {e}")
            raise
        except Exception as e:
            logger.error(f"Unexpected error creating connection to {router.ip_address}: {e}")
            raise

    def get_connection(self, router_id: int):
        """
        Retrieves a connection from the pool for the given router_id.
        Creates new connections if the pool is not full.
        """
        with self._pool_lock:
            if router_id not in self._pools:
                self._pools[router_id] = {
                    "connections": Queue(maxsize=self.max_connections_per_router),
                    "lock": Lock(), # Lock for individual router's pool
                    "in_use": 0
                }
        
        router_pool = self._pools[router_id]
        with router_pool["lock"]:
            # Try to get an existing connection
            try:
                api, pool_obj = router_pool["connections"].get(timeout=self.checkout_timeout)
                router_pool["in_use"] += 1
                logger.debug(f"Reusing connection for router {router_id}. In use: {router_pool['in_use']}")
                return api, pool_obj
            except Empty:
                pass # No existing connection, try to create one

            # If no existing connection, and max_connections not reached, create new
            if router_pool["in_use"] < self.max_connections_per_router:
                try:
                    router_db = db.session.get(MikroTikRouter, router_id)
                    if not router_db:
                        raise ValueError(f"Router {router_id} not found in database.")
                    
                    api, pool_obj = self._create_new_connection(router_db)
                    router_pool["in_use"] += 1
                    logger.debug(f"Created new connection for router {router_id}. In use: {router_pool['in_use']}")
                    return api, pool_obj
                except Exception:
                    logger.error(f"Could not create a new connection for router {router_id}.")
                    raise
            else:
                raise RuntimeError(f"MikroTik connection pool for router {router_id} is exhausted.")

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
