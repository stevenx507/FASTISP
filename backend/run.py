"""
Development server entry point
"""
import os
from app import create_app
from app.config import config as config_map

app = create_app('development')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
