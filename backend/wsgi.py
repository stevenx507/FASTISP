"""
WSGI entry point
"""
import os
from app import create_app

# Use environment-provided key matching app.config map or default to 'production'
app = create_app(os.environ.get('FLASK_ENV', 'production'))

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
