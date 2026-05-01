import os
import sys
from pathlib import Path

# Añadir el path del backend para poder importar la app
backend_path = Path(__file__).resolve().parent.parent / 'backend'
sys.path.append(str(backend_path))

# Cargar variables de entorno (simulado)
os.environ['GEMINI_API_KEY'] = 'AIzaSyCFuNh9I-qptGCAddoJDP4hqTOltfncYYE'
os.environ['MIKROTIK_WG_ENDPOINT'] = 'vpn.fastisp.cloud:51820'
os.environ['MIKROTIK_WG_SERVER_PUBLIC_KEY'] = 'S3rv3rPubK3yExample1234567890'

from flask import Flask
from app import db
from app.models import Client, Plan
from app.services.ai_support_service import AISupportService

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///:memory:'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db.init_app(app)

def simulate():
    with app.app_context():
        db.create_all()
        
        # Crear datos de prueba
        plan = Plan(name="Fibra 100MB", price=25.0)
        db.session.add(plan)
        db.session.commit()
        
        client = Client(
            full_name="Steve Demo",
            email="steve@demo.com",
            status="active",
            plan_id=plan.id,
            router_id=1
        )
        db.session.add(client)
        db.session.commit()
        
        print(f"--- Simulación de Asistente IA para el cliente: {client.full_name} ---")
        service = AISupportService(client_id=client.id)
        
        questions = [
            "¿Cuál es mi plan actual?",
            "Necesito un script para conectar mi router remotamente al sistema."
        ]
        
        for q in questions:
            print(f"\n> USUARIO: {q}")
            response = service.get_response(q)
            print(f"\n🤖 ASISTENTE: {response}\n")
            print("-" * 50)

if __name__ == "__main__":
    simulate()
