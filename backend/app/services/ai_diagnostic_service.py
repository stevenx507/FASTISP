# backend/app/services/ai_diagnostic_service.py
import os
import openai
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
    Servicio para realizar diagnósticos de red en routers MikroTik utilizando un modelo de IA.
    """
    def __init__(self, router_id: int):
        self.router_id = router_id
        self.router = db.session.get(MikroTikRouter, self.router_id)
        if not self.router:
            raise ValueError("Router no encontrado")
        
        # Configurar la clave de API de OpenAI
        # Se espera que la clave esté en las variables de entorno, p.ej., OPENAI_API_KEY
        openai.api_key = os.getenv("OPENAI_API_KEY")
        if not openai.api_key:
            logger.warning("La variable de entorno OPENAI_API_KEY no está configurada.")

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
        Ejecuta el diagnóstico completo: recopila datos, los envía a la IA y devuelve el análisis.
        """
        if not openai.api_key:
            return {
                "error": "El servicio de IA no está configurado. Falta la clave de API de OpenAI."
            }
            
        try:
            # 1. Recopilar datos reales
            diagnostic_data = self.get_diagnostic_data()
            
            # 2. Formatear el prompt para la IA
            prompt = self._format_prompt(diagnostic_data)
            
            # 3. Enviar a la IA
            response = openai.ChatCompletion.create(
                model="gpt-3.5-turbo", # o "gpt-4"
                messages=[
                    {"role": "system", "content": "Eres un experto en redes MikroTik. Analiza los siguientes datos y proporciona un diagnóstico claro en español, identificando problemas potenciales y sugiriendo soluciones específicas con comandos de RouterOS si es posible. Formatea la salida con Markdown."},
                    {"role": "user", "content": prompt}
                ]
            )
            ai_analysis = response.choices[0].message['content']

            return {"analysis": ai_analysis}

        except ConnectionError as ce:
            logger.error(f"Error de conexión durante el diagnóstico con IA: {ce}")
            return {"error": str(ce)}
        except Exception as e:
            logger.error(f"Error durante el diagnóstico con IA: {e}")
            return {"error": f"Ocurrió un error inesperado: {str(e)}"}

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
