import sys
import os
from datetime import datetime

# Add the current directory to sys.path
sys.path.append(os.getcwd())

from app import create_app, db
from app.models import Client, Subscription

def migrate_client_statuses():
    app = create_app('production') # Use production config to get real DB
    with app.app_context():
        print("Starting client status migration...")
        clients = Client.query.all()
        count = 0
        for client in clients:
            # Logic similar to what was in _derive_status
            new_status = 'active'
            if client.status and client.status != 'active':
                new_status = client.status
            elif client.subscriptions:
                latest = max(client.subscriptions, key=lambda s: s.updated_at or s.created_at or datetime.min)
                if latest.status in ('suspended', 'cancelled'):
                    new_status = latest.status
                elif latest.status == 'past_due':
                    new_status = 'past_due'
            
            if client.status != new_status:
                client.status = new_status
                count += 1
        
        db.session.commit()
        print(f"Migration completed. Updated {count} clients.")

if __name__ == "__main__":
    migrate_client_statuses()
