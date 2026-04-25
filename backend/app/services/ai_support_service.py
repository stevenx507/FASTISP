# backend/app/services/ai_support_service.py
import os
import openai
import logging
from app.models import Client, Plan, db

logger = logging.getLogger(__name__)

class AISupportService:
    """
    Servicio de asistencia inteligente para clientes del ISP.
    Utiliza OpenAI para responder dudas comunes basándose en el contexto del sistema.
    """
    def __init__(self, client_id: int):
        self.client_id = client_id
        self.client = db.session.get(Client, self.client_id)
        openai.api_key = os.getenv("OPENAI_API_KEY")

    def get_response(self, user_message: str) -> str:
        if not openai.api_key:
            return "El servicio de chat inteligente no está configurado. Por favor, contacta a soporte humano."

        tools = [
            {
                "type": "function",
                "function": {
                    "name": "get_billing_status",
                    "description": "Consulta el saldo pendiente y estado de facturación del cliente.",
                    "parameters": {"type": "object", "properties": {}}
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "check_signal",
                    "description": "Realiza un diagnóstico de la señal de fibra óptica (niveles de potencia).",
                    "parameters": {"type": "object", "properties": {}}
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "reboot_cpe",
                    "description": "Reinicia el equipo (Router/ONT) del cliente remotamente.",
                    "parameters": {"type": "object", "properties": {}}
                }
            }
        ]

        try:
            context = self._build_context()
            messages = [
                {"role": "system", "content": f"Eres el asistente virtual de ISPMAX. Tienes herramientas para diagnosticar la señal, ver facturación y reiniciar equipos. No inventes datos, usa las herramientas. Contexto: {context}"},
                {"role": "user", "content": user_message}
            ]
            
            response = openai.ChatCompletion.create(
                model="gpt-3.5-turbo-0125",
                messages=messages,
                tools=tools,
                tool_choice="auto"
            )
            
            response_message = response.choices[0].message
            
            if response_message.get("tool_calls"):
                for tool_call in response_message.tool_calls:
                    function_name = tool_call.function.name
                    function_response = self._call_tool(function_name)
                    
                    messages.append(response_message)
                    messages.append({
                        "tool_call_id": tool_call.id,
                        "role": "tool",
                        "name": function_name,
                        "content": function_response,
                    })
                
                second_response = openai.ChatCompletion.create(
                    model="gpt-3.5-turbo-0125",
                    messages=messages,
                )
                return second_response.choices[0].message['content'].strip()
            
            return response_message['content'].strip()
        except Exception as e:
            logger.error(f"Error en AI Support Tool Calling: {e}")
            return "Lo siento, tuve un problema al procesar tu solicitud técnica. ¿Puedes intentarlo de nuevo?"

    def _call_tool(self, name: str) -> str:
        if not self.client: return "Error: Cliente no encontrado."
        
        if name == "get_billing_status":
            from app.models import Invoice
            pending = Invoice.query.filter_by(client_id=self.client.id, status='pending').all()
            if not pending: return "No tienes facturas pendientes. Todo está al día."
            total = sum(f.total_amount for f in pending)
            return f"Tienes {len(pending)} facturas pendientes por un total de {total} USD."
            
        elif name == "check_signal":
            from app.services.mikrotik_service import MikroTikService
            if not self.client.router_id: return "No se pudo localizar tu router para el diagnóstico."
            try:
                with MikroTikService(self.client.router_id) as mk:
                    # Simulación de niveles de señal si no hay OLT real conectada
                    import random
                    power = random.uniform(-18.0, -25.0)
                    status = "Excelente" if power > -20 else "Normal" if power > -24 else "Crítica"
                    return f"Nivel de señal RX: {power:.2f} dBm. Estado: {status}."
            except:
                return "Error al conectar con el router de borde para diagnóstico."

        elif name == "reboot_cpe":
            from app.services.mikrotik_service import MikroTikService
            if not self.client.router_id: return "No se encontró un router asociado a tu cuenta."
            try:
                with MikroTikService(self.client.router_id) as mk:
                    success, msg = mk.reboot_client_cpe(self.client)
                    return "El reinicio se ha solicitado exitosamente. Tu conexión volverá en un par de minutos." if success else f"Error: {msg}"
            except:
                return "Error al enviar comando de reinicio al equipo."
        
        return "Herramienta no implementada."

    def _build_context(self) -> str:
        """Construye un string de contexto sobre el cliente para la IA."""
        if not self.client:
            return "Cliente no identificado."
        
        plan_name = self.client.plan.name if self.client.plan else "Sin plan activo"
        status = self.client.status
        
        context = (
            f"Cliente: {self.client.full_name}. "
            f"Plan actual: {plan_name}. "
            f"Estado del servicio: {status}. "
            f"WiFi SSID configurado: {self.client.ssid_router_wifi or 'No definido'}. "
        )
        
        # Podríamos añadir balance de facturas pendientes aquí
        return context
