# backend/app/services/ai_diagnostic_service.py
import os
import google.generativeai as genai
import json
from app.services.mikrotik_service import MikroTikService
from app.models import MikroTikRouter
from app import db
import logging

# Configurar logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AIDiagnosticService:
    """
    Servicio para realizar diagnósticos de red en routers MikroTik utilizando Google Gemini (Gratis).
    """
    def __init__(self, router_id: int):
        self.router_id = router_id
        self.router = db.session.get(MikroTikRouter, self.router_id)
        if not self.router:
            raise ValueError("Router no encontrado")
        
        # Configurar Gemini
        api_key = os.getenv("GEMINI_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)
        else:
            logger.warning("La variable de entorno GEMINI_API_KEY no está configurada.")

    def get_diagnostic_data(self) -> dict:
        """
        Recopila datos exhaustivos del router para el diagnóstico.
        """
        logger.info(f"Recopilando datos de diagnóstico para el router {self.router.name}...")
        
        with MikroTikService(router_id=self.router_id) as mt_service:
            if not mt_service.api:
                raise ConnectionError("No se pudo conectar al router.")
            
            data = {
                "system_info": mt_service.get_router_info(),
                "firewall_rules": mt_service.get_firewall_rules(),
                "nat_rules": mt_service.get_nat_rules(),
                "mangle_rules": mt_service.get_mangle_rules(),
                "logs": mt_service.get_logs(limit=100) # Limitar a los 100 registros más recientes
            }
        return data

    def run_diagnosis(self) -> dict:
        """
        Ejecuta el diagnóstico completo usando Google Gemini.
        """
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return {
                "error": "El servicio de IA (Gemini) no está configurado. Falta la clave GEMINI_API_KEY."
            }
            
        try:
            # 1. Recopilar datos reales
            diagnostic_data = self.get_diagnostic_data()
            
            # 2. Formatear el prompt
            prompt = self._format_prompt(diagnostic_data)
            
            # 3. Inicializar modelo y generar contenido
            # Usamos gemini-1.5-flash por su velocidad y nivel gratuito generoso
            model = genai.GenerativeModel('gemini-1.5-flash')
            
            chat_session = model.start_chat(history=[])
            system_instruction = "Eres un experto en redes MikroTik. Analiza los siguientes datos y proporciona un diagnóstico claro en español, identificando problemas potenciales y sugiriendo soluciones específicas con comandos de RouterOS si es posible. Formatea la salida con Markdown."
            
            response = chat_session.send_message(f"{system_instruction}\n\n{prompt}")
            
            if response and response.text:
                return {"analysis": response.text}
            else:
                return {"error": "Gemini devolvió una respuesta vacía o bloqueada."}

        except Exception as e:
            logger.error(f"Error durante el diagnóstico con Gemini: {e}")
            return {"error": f"Error en diagnóstico Gemini: {str(e)}"}

    def _format_prompt(self, data: dict) -> str:
        """
        Formatea los datos recopilados en un string legible para el modelo de IA.
        """
        prompt = "Analiza el estado del siguiente router MikroTik:\n\n"
        prompt += "--- Información del Sistema ---\n"
        for key, value in data.get("system_info", {}).items():
            prompt += f"- {key}: {value}\n"
        
        prompt += "\n--- Reglas del Firewall (Filter) ---\n"
        for rule in data.get("firewall_rules", []):
            prompt += f"- {json.dumps(rule)}\n"
            
        prompt += "\n--- Reglas de NAT ---\n"
        for rule in data.get("nat_rules", []):
            prompt += f"- {json.dumps(rule)}\n"

        prompt += "\n--- Reglas de Mangle ---\n"
        for rule in data.get("mangle_rules", []):
            prompt += f"- {json.dumps(rule)}\n"
            
        prompt += "\n--- Últimos 100 Registros (Logs) ---\n"
        for log in data.get("logs", []):
            prompt += f"- {log.get('time')} [{log.get('topics')}]: {log.get('message')}\n"
            
        prompt += "\n--- Fin de los Datos ---\n"
        prompt += "Por favor, proporciona tu diagnóstico y recomendaciones en español y con formato Markdown."
        
        return prompt
