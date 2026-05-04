import sys
import os

# Add the current directory to sys.path
sys.path.append(os.getcwd())

try:
    from app import create_app
    app = create_app('testing')
    print("SUCCESS: Application factory created successfully.")
    print("Registered Blueprints:", list(app.blueprints.keys()))
except Exception as e:
    print(f"FAILURE: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
