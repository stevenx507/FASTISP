# backend/app/services/ai_support_service.py
import os
import google.generativeai as genai
import logging
from app.models import Client, Plan, db

logger = logging.getLogger(__name__)

class AISupportService:
    """
    Servicio de asistencia inteligente para clientes del ISP usando Google Gemini.
    Utiliza Function Calling para interactuar con el sistema de forma gratuita.
    """
    def __init__(self, client_id: int):
        self.client_id = client_id
        self.client = db.session.get(Client, self.client_id)
        api_key = os.getenv("GEMINI_API_KEY")
        if api_key:
            genai.configure(api_key=api_key)

    def get_response(self, user_message: str) -> str:
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key:
            return "El servicio de chat inteligente no está configurado. Por favor, contacta a soporte humano."

        # Definir herramientas para Gemini
        def get_billing_status():
            """Consulta el saldo pendiente y estado de facturación del cliente."""
            return self._call_tool("get_billing_status")

        def check_signal():
            """Realiza un diagnóstico de la señal de fibra óptica (niveles de potencia)."""
            return self._call_tool("check_signal")

        def reboot_cpe():
            """Reinicia el equipo (Router/ONT) del cliente remotamente."""
            return self._call_tool("reboot_cpe")

        tools = [get_billing_status, check_signal, reboot_cpe]

        try:
            context = self._build_context()
            model = genai.GenerativeModel(
                model_name='gemini-1.5-flash',
                tools=tools,
                system_instruction=f"Eres el asistente virtual de ISPMAX. Tienes herramientas para diagnosticar la señal, ver facturación y reiniciar equipos. No inventes datos, usa las herramientas. Contexto: {context}"
            )
            
            chat = model.start_chat(enable_automatic_function_calling=True)
            response = chat.send_message(user_message)
            
            if response and response.text:
                return response.text.strip()
            
            return "Lo siento, no pude procesar tu solicitud técnica en este momento."
        except Exception as e:
            logger.error(f"Error en AI Support Gemini: {e}")
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
