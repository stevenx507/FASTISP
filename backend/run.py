"""
Development server entry point
"""
import os
from app import create_app, socketio
from app.config import config as config_map

app = create_app('development')

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5000, debug=True)
