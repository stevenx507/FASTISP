import logging
import requests
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)

class MessagingManager:
    """
    Unified messaging bridge for Phase 5 Automation.
    Supports multiple providers for WhatsApp, Email, and Push.
    """
    
    @staticmethod
    def send_whatsapp(to_number: str, message: str, provider: str = 'ultramsg', config: Optional[Dict[str, Any]] = None) -> bool:
        """
        Sends a WhatsApp message using the configured provider.
        """
        if not config:
            logger.warning("WhatsApp config missing. Skipping message.")
            return False
            
        try:
            # Normalize number (strip +, etc)
            clean_number = "".join(filter(str.isdigit, to_number))
            
            if provider == 'ultramsg':
                url = f"https://api.ultramsg.com/{config.get('instance_id')}/messages/chat"
                payload = {
                    "token": config.get('token'),
                    "to": clean_number,
                    "body": message,
                    "priority": 10
                }
                response = requests.post(url, data=payload, timeout=10)
                return response.status_code == 200
                
            elif provider == 'mock':
                logger.info(f"[MOCK WHATSAPP] To: {clean_number} | Msg: {message}")
                return True
                
            return False
        except Exception as e:
            logger.error(f"Failed to send WhatsApp message: {str(e)}")
            return False

    @staticmethod
    def notify_invoice_created(client_name: str, phone: str, amount: float, due_date: str, config: Dict):
        msg = (
            f"Hola {client_name}! 🚀\n\n"
            f"Tu factura de ISPMAX ha sido generada.\n"
            f"Monto: ${amount}\n"
            f"Vencimiento: {due_date}\n\n"
            f"Puedes pagar desde el portal del cliente. ¡Gracias!"
        )
        return MessagingManager.send_whatsapp(phone, msg, config=config)

    @staticmethod
    def notify_tech_on_route(client_name: str, phone: str, tech_name: str, config: Dict):
        msg = (
            f"¡Buenas noticias {client_name}! 🛠️\n\n"
            f"Nuestro técnico {tech_name} ya está en ruta a tu domicilio.\n"
            f"Por favor, asegúrate de que alguien mayor de edad se encuentre en casa.\n\n"
            f"¡Llegaremos pronto!"
        )
        return MessagingManager.send_whatsapp(phone, msg, config=config)

    @staticmethod
    def notify_payment_confirmed(client_name: str, phone: str, amount: float, config: Dict):
        msg = (
            f"¡Pago Confirmado! ✅\n\n"
            f"Hola {client_name}, hemos recibido tu pago por ${amount}.\n"
            f"Tu servicio está al día. ¡Gracias por confiar en ISPMAX!"
        )
        return MessagingManager.send_whatsapp(phone, msg, config=config)
