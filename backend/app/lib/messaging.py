import logging
import requests
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)

class MessagingManager:
    """
    Unified messaging bridge for Phase 5 Automation.
    Supports UltraMsg (WhatsApp) and Telegram API.
    """
    
    @staticmethod
    def _get_tenant_config(tenant_id: int) -> Dict[str, Any]:
        try:
            from app.routes.admin.utils import _effective_system_settings
            return _effective_system_settings(tenant_id)
        except Exception as e:
            logger.error(f"Failed to load tenant config for messaging: {e}")
            return {}

    @staticmethod
    def send_whatsapp(tenant_id: int, to_number: str, message: str, provider: str = 'ultramsg') -> bool:
        """
        Sends a WhatsApp message using the configured provider.
        """
        config = MessagingManager._get_tenant_config(tenant_id)
        token = config.get('whatsapp_token')
        instance_id = config.get('whatsapp_instance_id')
        
        if not token or not instance_id:
            logger.warning(f"WhatsApp config missing for tenant {tenant_id}. Skipping message.")
            return False
            
        try:
            # Normalize number (strip +, spaces, dashes)
            clean_number = "".join(filter(str.isdigit, str(to_number)))
            if not clean_number:
                return False
                
            if provider == 'ultramsg':
                url = f"https://api.ultramsg.com/{instance_id}/messages/chat"
                payload = {
                    "token": token,
                    "to": clean_number,
                    "body": message,
                    "priority": 10
                }
                response = requests.post(url, data=payload, timeout=10)
                if response.status_code == 200:
                    logger.info(f"WhatsApp message sent to {clean_number}")
                    return True
                else:
                    logger.error(f"WhatsApp API Error: {response.text}")
                return False
            elif provider == 'mock':
                logger.info(f"[MOCK WHATSAPP] To: {clean_number} | Msg: {message}")
                return True
                
            return False
        except Exception as e:
            logger.error(f"Failed to send WhatsApp message: {str(e)}")
            return False

    @staticmethod
    def send_telegram(tenant_id: int, message: str, custom_chat_id: Optional[str] = None) -> bool:
        """
        Sends a Telegram message to the configured NOC group or a specific chat_id.
        """
        config = MessagingManager._get_tenant_config(tenant_id)
        token = config.get('telegram_bot_token')
        chat_id = custom_chat_id or config.get('telegram_noc_chat_id')
        
        if not token or not chat_id:
            logger.warning(f"Telegram config missing for tenant {tenant_id}. Skipping alert.")
            return False
            
        try:
            url = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = {
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "HTML"
            }
            response = requests.post(url, json=payload, timeout=10)
            if response.status_code == 200:
                logger.info("Telegram alert sent successfully.")
                return True
            else:
                logger.error(f"Telegram API Error: {response.text}")
            return False
        except Exception as e:
            logger.error(f"Failed to send Telegram message: {str(e)}")
            return False

    # --- Client WhatsApp Templates ---
    
    @staticmethod
    def notify_invoice_created(tenant_id: int, client_name: str, phone: str, amount: float, due_date: str):
        msg = (
            f"Hola {client_name}! 🚀\n\n"
            f"Tu factura de ISPMAX ha sido generada.\n"
            f"Monto: ${amount}\n"
            f"Vencimiento: {due_date}\n\n"
            f"Puedes pagar desde el portal del cliente. ¡Gracias!"
        )
        return MessagingManager.send_whatsapp(tenant_id, phone, msg)

    @staticmethod
    def notify_tech_on_route(tenant_id: int, client_name: str, phone: str, tech_name: str):
        msg = (
            f"¡Buenas noticias {client_name}! 🛠️\n\n"
            f"Nuestro técnico {tech_name} ya está en ruta a tu domicilio.\n"
            f"Por favor, asegúrate de que alguien mayor de edad se encuentre en casa.\n\n"
            f"¡Llegaremos pronto!"
        )
        return MessagingManager.send_whatsapp(tenant_id, phone, msg)

    @staticmethod
    def notify_payment_confirmed(tenant_id: int, client_name: str, phone: str, amount: float):
        msg = (
            f"¡Pago Confirmado! ✅\n\n"
            f"Hola {client_name}, hemos recibido tu pago por ${amount}.\n"
            f"Tu servicio está al día. ¡Gracias por confiar en nosotros!"
        )
        return MessagingManager.send_whatsapp(tenant_id, phone, msg)

    # --- NOC Telegram Templates ---

    @staticmethod
    def notify_router_offline(tenant_id: int, router_name: str, ip_address: str, downtime_mins: int):
        msg = (
            f"🚨 <b>ALERTA CRÍTICA: MIKROTIK OFFLINE</b> 🚨\n\n"
            f"<b>Router:</b> {router_name}\n"
            f"<b>IP:</b> {ip_address}\n"
            f"<b>Tiempo caído:</b> {downtime_mins} minutos\n\n"
            f"<i>Por favor, revise la conectividad inmediatamente.</i>"
        )
        return MessagingManager.send_telegram(tenant_id, msg)

    @staticmethod
    def notify_new_ticket(tenant_id: int, ticket_id: int, client_name: str, priority: str, subject: str):
        icon = "🔴" if priority.lower() in ["high", "urgent"] else "🔵"
        msg = (
            f"{icon} <b>NUEVO TICKET DE SOPORTE</b> {icon}\n\n"
            f"<b>Ticket #:</b> {ticket_id}\n"
            f"<b>Cliente:</b> {client_name}\n"
            f"<b>Prioridad:</b> {priority.upper()}\n"
            f"<b>Asunto:</b> {subject}\n\n"
            f"<i>Acceda al panel para asignar un técnico.</i>"
        )
        return MessagingManager.send_telegram(tenant_id, msg)
