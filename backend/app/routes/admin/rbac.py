# Role-Based Access Control Constants and Catalog

PLATFORM_ADMIN_ROLE = "platform_admin"

ROLE_BASE_PERMISSIONS: dict[str, set[str]] = {
    PLATFORM_ADMIN_ROLE: {"*"},
    "admin": {"*"},
    "noc": {
        "dashboard.read", "network.read", "network.alerts.read",
        "network.maintenance.read", "network.maintenance.write",
        "ops.preflight.read", "ops.slo.read", "ops.sops.read",
        "ops.change.read", "tickets.read",
    },
    "tech": {
        "dashboard.read", "clients.read", "installations.read",
        "installations.write", "ops.sops.read", "ops.change.read",
        "tickets.read", "tickets.write", "network.read",
    },
    "support": {
        "clients.read", "tickets.read", "tickets.write", "notifications.read",
    },
    "billing": {
        "billing.read", "billing.write", "billing.promises.read",
        "billing.promises.write", "payments.review", "clients.read",
    },
    "operator": {
        "dashboard.read", "clients.read", "tickets.read", "notifications.read",
    },
    "client": {
        "client.portal.read",
    },
}

PERMISSION_CATALOG = sorted(
    {p for perms in ROLE_BASE_PERMISSIONS.values() for p in perms if p != "*"}
    | {
        "audit.read", "billing.promises.read", "billing.promises.write",
        "catalog.read", "catalog.write", "communications.alerts.read",
        "communications.alerts.write", "hotspot.read", "hotspot.write",
        "installations.read", "installations.write", "network.maintenance.read",
        "network.maintenance.write", "ops.sops.read", "ops.sops.write",
        "ops.change.read", "ops.change.write", "ops.change.approve",
        "ops.preflight.read", "ops.slo.read", "payments.review",
        "security.permissions.read", "security.permissions.write",
        "system.jobs.read", "system.jobs.run", "system.settings.read",
        "system.settings.write",
    }
)
