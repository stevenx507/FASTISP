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
        buffer = io.BytesIO()
        p = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4

        # Estética Premium
        p.setStrokeColor(colors.cyan)
        p.setLineWidth(2)
        p.line(0, height - 100, width, height - 100)

        # Encabezado
        p.setFont("Helvetica-Bold", 24)
        p.drawString(2 * cm, height - 2 * cm, "ISPMAX - Internet Premium")
        
        p.setFont("Helvetica", 10)
        p.drawString(2 * cm, height - 3 * cm, "Factura Electronica")
        p.drawString(2 * cm, height - 3.5 * cm, f"No: #INV-{invoice.id:06d}")
        p.drawString(2 * cm, height - 4 * cm, f"Fecha: {invoice.created_at.strftime('%Y-%m-%d')}")

        # Datos del Cliente
        client = invoice.client
        p.setFont("Helvetica-Bold", 12)
        p.drawString(2 * cm, height - 6 * cm, "FACTURAR A:")
        p.setFont("Helvetica", 11)
        p.drawString(2 * cm, height - 6.6 * cm, client.name)
        p.drawString(2 * cm, height - 7.2 * cm, f"Email: {client.email}")
        p.drawString(2 * cm, height - 7.8 * cm, f"DNI: {client.dni or 'N/A'}")

        # Tabla de Detalles (Simple para este ejemplo)
        p.setFillColor(colors.lightgrey)
        p.rect(2 * cm, height - 11 * cm, width - 4 * cm, 0.8 * cm, fill=1)
        p.setFillColor(colors.black)
        p.setFont("Helvetica-Bold", 10)
        p.drawString(2.5 * cm, height - 10.5 * cm, "DESCRIPCION")
        p.drawRightString(width - 2.5 * cm, height - 10.5 * cm, "TOTAL")

        p.setFont("Helvetica", 11)
        p.drawString(2.5 * cm, height - 12 * cm, f"Servicio de Internet - Mes de {invoice.created_at.strftime('%B %Y')}")
        p.drawRightString(width - 2.5 * cm, height - 12 * cm, f"${invoice.amount:,.2f}")

        # Total
        p.line(width - 7 * cm, height - 13 * cm, width - 2 * cm, height - 13 * cm)
        p.setFont("Helvetica-Bold", 14)
        p.drawRightString(width - 2.5 * cm, height - 14 * cm, f"TOTAL: ${invoice.amount:,.2f}")

        # QR Code para Pago (Mocking URL)
        qr_data = f"https://ispmax.cloud/pay/{invoice.id}"
        qr = qrcode.QRCode(version=1, box_size=10, border=5)
        qr.add_data(qr_data)
        qr.make(fit=True)
        img_qr = qr.make_image(fill_color="black", back_color="white")
        
        qr_buffer = io.BytesIO()
        img_qr.save(qr_buffer, format='PNG')
        qr_buffer.seek(0)
        
        from reportlab.lib.utils import ImageReader
        p.drawImage(ImageReader(qr_buffer), width - 5 * cm, 2 * cm, width=3*cm, height=3*cm)
        
        p.setFont("Helvetica-Oblique", 8)
        p.drawString(2 * cm, 2 * cm, "Gracias por preferir ISPMAX. Este documento es un comprobante de cobro oficial.")
        p.drawRightString(width - 5.5 * cm, 2.5 * cm, "Escanee para pagar")

        p.showPage()
        p.save()
        buffer.seek(0)
        return buffer
