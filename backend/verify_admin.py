import sys
import os

# Add backend to path
sys.path.append(os.getcwd())

try:
    from app import create_app
    app = create_app()
    with app.app_context():
        print("Backend application context loaded successfully.")
        
        # Test imports of administrative modules
        import app.routes.admin.staff as staff
        import app.routes.admin.billing as billing
        import app.routes.admin.network as network
        import app.routes.admin.inventory as inventory
        import app.routes.admin.support as support
        import app.routes.admin.platform as platform
        import app.routes.admin.system as system
        
        print("All administrative modules imported successfully without NameErrors.")
        
        # Verify specific helpers are available in blueprints (via utils)
        assert hasattr(staff, 'load_staff_meta')
        assert hasattr(network, '_build_network_health_payload')
        assert hasattr(support, '_load_notification_history')
        assert hasattr(inventory, 'admin_required')
        
        print("Verified critical helpers are available in their respective modules.")

except Exception as e:
    print(f"Verification FAILED: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
