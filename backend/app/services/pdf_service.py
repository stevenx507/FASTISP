# backend/app/services/pdf_service.py
import io
import qrcode
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.units import cm
from app.models import Invoice, Client

class PDFService:
    @staticmethod
    def generate_invoice_pdf(invoice: Invoice) -> io.BytesIO:
        from flask import current_app
        buffer = io.BytesIO()
        p = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        client = invoice.client
        tenant = invoice.tenant

        # Configuración de Colores (Brand Colors) - Fallback a azul ISPFAST
        primary_color = colors.HexColor(tenant.primary_color or "#3b82f6")
        
        # --- ENCABEZADO PREMIUM ---
        p.setFillColor(primary_color)
        p.rect(0, height - 4 * cm, width, 4 * cm, fill=1, stroke=0)
        
        p.setFillColor(colors.white)
        p.setFont("Helvetica-Bold", 28)
        p.drawString(2 * cm, height - 2.5 * cm, tenant.brand_name or "ISPFAST")
        
        p.setFont("Helvetica", 10)
        p.drawString(2 * cm, height - 3.2 * cm, tenant.name or "Infraestructura Cloud")
        
        # --- INFO FACTURA ---
        p.setFillColor(colors.black)
        p.setFont("Helvetica-Bold", 14)
        p.drawRightString(width - 2 * cm, height - 5.5 * cm, "FACTURA DE SERVICIOS")
        
        p.setFont("Helvetica", 10)
        p.drawRightString(width - 2 * cm, height - 6.2 * cm, f"Número: {invoice.number}")
        p.drawRightString(width - 2 * cm, height - 6.8 * cm, f"Fecha Emisión: {invoice.created_at.strftime('%d/%m/%Y')}")
        p.drawRightString(width - 2 * cm, height - 7.4 * cm, f"Vencimiento: {invoice.due_date.strftime('%d/%m/%Y')}")

        # --- DATOS DEL CLIENTE ---
        p.setFont("Helvetica-Bold", 12)
        p.drawString(2 * cm, height - 9 * cm, "DATOS DEL ABONADO")
        p.setStrokeColor(primary_color)
        p.setLineWidth(1)
        p.line(2 * cm, height - 9.2 * cm, 8 * cm, height - 9.2 * cm)
        
        p.setFont("Helvetica", 11)
        p.drawString(2 * cm, height - 10 * cm, f"Nombre: {client.full_name}")
        p.drawString(2 * cm, height - 10.6 * cm, f"DNI/RUC: {client.dni or 'N/A'}")
        p.drawString(2 * cm, height - 11.2 * cm, f"Dirección: {client.address or 'N/A'}")
        p.drawString(2 * cm, height - 11.8 * cm, f"Teléfono: {client.phone or 'N/A'}")

        # --- TABLA DE CARGOS ---
        y_table = height - 14 * cm
        p.setFillColor(primary_color)
        p.rect(2 * cm, y_table, width - 4 * cm, 0.8 * cm, fill=1, stroke=0)
        
        p.setFillColor(colors.white)
        p.setFont("Helvetica-Bold", 10)
        p.drawString(2.5 * cm, y_table + 0.25 * cm, "CONCEPTO / SERVICIO")
        p.drawRightString(width - 2.5 * cm, y_table + 0.25 * cm, "TOTAL")
        
        p.setFillColor(colors.black)
        p.setFont("Helvetica", 11)
        p.drawString(2.5 * cm, y_table - 1 * cm, f"Abono Mensual: {client.plan.name if client.plan else 'Servicio Internet'}")
        p.drawRightString(width - 2.5 * cm, y_table - 1 * cm, f"{invoice.currency} {invoice.total_amount:,.2f}")
        
        # --- TOTALES ---
        p.setDash(1, 2)
        p.line(width - 8 * cm, y_table - 3 * cm, width - 2 * cm, y_table - 3 * cm)
        p.setDash([])
        
        p.setFont("Helvetica-Bold", 16)
        p.setFillColor(primary_color)
        p.drawRightString(width - 2.5 * cm, y_table - 4 * cm, f"TOTAL A PAGAR: {invoice.currency} {invoice.total_amount:,.2f}")

        # --- QR PAGO ---
        qr_url = f"{current_app.config.get('FRONTEND_URL')}/pay/{invoice.id}"
        qr = qrcode.QRCode(version=1, box_size=10, border=2)
        qr.add_data(qr_url)
        qr.make(fit=True)
        img_qr = qr.make_image(fill_color="black", back_color="white")
        
        qr_buffer = io.BytesIO()
        img_qr.save(qr_buffer, format='PNG')
        qr_buffer.seek(0)
        
        from reportlab.lib.utils import ImageReader
        p.drawImage(ImageReader(qr_buffer), 2 * cm, 2 * cm, width=3.5*cm, height=3.5*cm)
        
        p.setFillColor(colors.black)
        p.setFont("Helvetica-Bold", 9)
        p.drawString(6 * cm, 4.5 * cm, "PAGA FÁCIL Y RÁPIDO")
        p.setFont("Helvetica", 8)
        p.drawString(6 * cm, 4 * cm, "Escanea este código con tu celular para pagar en línea")
        p.drawString(6 * cm, 3.6 * cm, "y reactivar tu servicio instantáneamente.")

        p.setFont("Helvetica-Oblique", 7)
        p.drawCentredString(width / 2, 1 * cm, f"Documento generado por {tenant.brand_name or 'ISPFAST'} Cloud Engine. Gracias por su confianza.")

        p.showPage()
        p.save()
        buffer.seek(0)
        return buffer

