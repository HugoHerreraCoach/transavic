"""
Genera el PDF de propuesta comercial COMPACTA para Transavic.
Formato cotización: 1-2 páginas máximo. Lenguaje sencillo.
"""

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, white
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)
from datetime import datetime

# ── Paleta ──
ROJO = HexColor("#C8102E")
GRIS_OSCURO = HexColor("#2C2C2C")
GRIS_MEDIO = HexColor("#5A5A5A")
GRIS_CLARO = HexColor("#F5F5F5")
GRIS_BORDE = HexColor("#E0E0E0")
VERDE = HexColor("#10B981")
AZUL = HexColor("#3B82F6")
MORADO = HexColor("#8B5CF6")

OUTPUT = "/Users/hugoherrera/Programación/proyectos/transavic/propuesta-mejoras-transavic.pdf"

doc = SimpleDocTemplate(
    OUTPUT,
    pagesize=A4,
    leftMargin=1.6*cm,
    rightMargin=1.6*cm,
    topMargin=1*cm,
    bottomMargin=1*cm,
    title="Cotización - Mejoras Sistema Transavic",
    author="Hugo Herrera"
)

# ── Estilos ──
styles = getSampleStyleSheet()

style_titulo = ParagraphStyle(
    "Titulo", fontName="Helvetica-Bold", fontSize=20, leading=24,
    textColor=ROJO, alignment=TA_LEFT
)
style_subtitulo = ParagraphStyle(
    "Sub", fontName="Helvetica", fontSize=10.5, leading=14,
    textColor=GRIS_MEDIO, alignment=TA_LEFT
)
style_h2 = ParagraphStyle(
    "H2", fontName="Helvetica-Bold", fontSize=10.5, leading=13,
    textColor=ROJO, spaceBefore=6, spaceAfter=3
)
style_body = ParagraphStyle(
    "Body", fontName="Helvetica", fontSize=9.5, leading=13,
    textColor=GRIS_OSCURO, alignment=TA_JUSTIFY, spaceAfter=4
)
style_label = ParagraphStyle(
    "Label", fontName="Helvetica-Bold", fontSize=8, leading=10,
    textColor=GRIS_MEDIO
)
style_meta = ParagraphStyle(
    "Meta", fontName="Helvetica", fontSize=9, leading=12,
    textColor=GRIS_OSCURO
)
style_mejora_num = ParagraphStyle(
    "MN", fontName="Helvetica-Bold", fontSize=11, leading=12,
    textColor=white, alignment=TA_CENTER
)
style_mejora_titulo = ParagraphStyle(
    "MT", fontName="Helvetica-Bold", fontSize=9.5, leading=11,
    textColor=GRIS_OSCURO
)
style_mejora_desc = ParagraphStyle(
    "MD", fontName="Helvetica", fontSize=8.5, leading=10.5,
    textColor=GRIS_MEDIO
)


def header_footer(canv, doc):
    canv.saveState()
    # Barra roja superior
    canv.setFillColor(ROJO)
    canv.rect(0, A4[1] - 0.4*cm, A4[0], 0.4*cm, fill=True, stroke=False)
    # Footer
    canv.setFillColor(GRIS_MEDIO)
    canv.setFont("Helvetica", 7.5)
    canv.drawString(1.8*cm, 0.8*cm, "Cotización - Mejoras Sistema Transavic")
    canv.drawRightString(A4[0] - 1.8*cm, 0.8*cm, f"Página {doc.page}")
    canv.setStrokeColor(GRIS_BORDE)
    canv.setLineWidth(0.5)
    canv.line(1.8*cm, 1.1*cm, A4[0] - 1.8*cm, 1.1*cm)
    canv.restoreState()


def fila_mejora(num, color_num, titulo, desc):
    """Fila compacta de una mejora con número de color, título y descripción."""
    num_box = Table([[Paragraph(str(num), style_mejora_num)]],
                    colWidths=[0.7*cm], rowHeights=[0.7*cm])
    num_box.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), color_num),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    cuerpo = Table([
        [Paragraph(f"<b>{titulo}</b>", style_mejora_titulo)],
        [Paragraph(desc, style_mejora_desc)]
    ], colWidths=[16*cm])
    cuerpo.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    fila = Table([[num_box, cuerpo]], colWidths=[1*cm, 16.8*cm])
    fila.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LINEBELOW", (0, 0), (-1, -1), 0.3, GRIS_BORDE),
    ]))
    return fila


# ═══════════════════════════════════════════════════════════════
#                       PDF
# ═══════════════════════════════════════════════════════════════

story = []

# ─── Encabezado ───
story.append(Spacer(1, 0.2*cm))

# Logo + título en fila
logo = Table([[Paragraph('<font color="white" size="20"><b>T</b></font>',
              ParagraphStyle("l", fontName="Helvetica-Bold", fontSize=20,
                             textColor=white, alignment=TA_CENTER, leading=22))]],
             colWidths=[1.1*cm], rowHeights=[1.1*cm])
logo.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), ROJO),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))

titulo_block = Table([
    [Paragraph('<font color="#C8102E"><b>COTIZACIÓN</b></font>',
               ParagraphStyle("e", fontName="Helvetica-Bold", fontSize=9,
                              textColor=ROJO, spaceAfter=2))],
    [Paragraph("Mejoras al Sistema Transavic", style_titulo)],
], colWidths=[14*cm])
titulo_block.setStyle(TableStyle([
    ("LEFTPADDING", (0, 0), (-1, -1), 12),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
]))

header_row = Table([[logo, titulo_block]], colWidths=[1.1*cm, 14*cm])
header_row.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
story.append(header_row)

story.append(Spacer(1, 0.3*cm))
story.append(HRFlowable(width="100%", thickness=1.5, color=ROJO,
                        spaceBefore=0, spaceAfter=8))

# ─── Datos cliente / fecha ───
fecha = datetime.now().strftime("%d/%m/%Y")
datos = Table([
    [Paragraph("PARA", style_label),
     Paragraph("DE", style_label),
     Paragraph("FECHA", style_label),
     Paragraph("VALIDEZ", style_label)],
    [Paragraph("<b>Antonio</b><br/>Transavic / Avícola de Tony", style_meta),
     Paragraph("<b>Hugo Herrera</b><br/>Desarrollo de Software", style_meta),
     Paragraph(f"<b>{fecha}</b>", style_meta),
     Paragraph("<b>7 días</b>", style_meta)],
], colWidths=[5*cm, 5*cm, 3.7*cm, 3.7*cm])
datos.setStyle(TableStyle([
    ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ("RIGHTPADDING", (0, 0), (-1, -1), 6),
    ("TOPPADDING", (0, 0), (-1, -1), 2),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
]))
story.append(datos)

story.append(Spacer(1, 0.3*cm))

# ─── Resumen breve ───
story.append(Paragraph(
    "Implementación de <b>8 mejoras</b> que conectan las áreas de <b>oficina, producción y motorizados</b>, "
    "automatizan la facturación electrónica (SUNAT) y la cobranza, y elevan el control comercial con "
    "metas, panel gerencial y seguimiento inteligente de clientes. Entrega en <b>3 etapas</b> dentro del "
    "mismo proyecto.",
    style_body
))

# ─── Las 6 mejoras (compactas) ───
story.append(Paragraph("Mejoras incluidas", style_h2))

story.append(fila_mejora(
    1, ROJO,
    "Pesos digitales y flujo completo de pedidos",
    "La asistente registra los pesos exactos cliente por cliente. Cada pedido avanza por estados claros: "
    "<b>pendiente → producción → listo → en ruta → entregado</b>."
))
story.append(fila_mejora(
    2, AZUL,
    "Guía de remisión digital con firma",
    "El sistema genera la guía con pesos correctos. El motorizado sube foto de la firma desde su celular."
))
story.append(fila_mejora(
    3, VERDE,
    "Seguimiento del motorizado en vivo",
    "App Android que transmite ubicación incluso con celular bloqueado. Cálculo automático del tiempo de llegada."
))
story.append(fila_mejora(
    4, MORADO,
    "Avisos automáticos entre áreas y de metas",
    "Notificaciones cuando se crea un pedido, se confirman pesos o se entrega. <b>Avisos diarios de metas</b> "
    "a cada asesora para mantenerla enfocada en su objetivo del día."
))
story.append(fila_mejora(
    5, HexColor("#F59E0B"),
    "Dashboard comercial, metas y panel gerencial",
    "Ventas diarias por asesora, <b>objetivo diario calculado en base al mes anterior + meta de crecimiento "
    "del 15%</b>, panel comparativo entre asesoras, margen por cliente/producto/asesora y vista gerencial "
    "con visión global del negocio."
))
story.append(fila_mejora(
    6, HexColor("#06B6D4"),
    "Gestión de cobranzas y pagos pendientes",
    "Registro de facturas con plazos (7 / 15 días). Alertas automáticas a la asesora cuando un cliente "
    "se atrasa. Estadísticas de deuda vencida por asesora visibles para la administración."
))
story.append(fila_mejora(
    7, HexColor("#14B8A6"),
    "Integración con SUNAT (facturación electrónica)",
    "Emisión automática de comprobantes desde el sistema con los <b>2 RUCs</b> "
    "(Transavic + Avícola de Tony). Facturas y boletas listas para enviar al cliente."
))
story.append(fila_mejora(
    8, HexColor("#EC4899"),
    "Seguimiento comercial inteligente con IA",
    "Identificación de <b>clientes sin compra y clientes frecuentes</b>. Registro de actividad "
    "(contactos, cotizaciones, seguimientos). Recomendaciones por cliente y resumen semanal por asesora con sus prioridades."
))

story.append(Spacer(1, 0.15*cm))

# ─── Cronograma de entrega (SIN precios por fase) ───
story.append(Paragraph("Cronograma de entrega", style_h2))

cronograma = Table([
    [Paragraph("<b>ETAPA</b>", ParagraphStyle("th", fontName="Helvetica-Bold",
              fontSize=9, textColor=white, alignment=TA_LEFT)),
     Paragraph("<b>QUÉ SE ENTREGA</b>", ParagraphStyle("th2", fontName="Helvetica-Bold",
              fontSize=9, textColor=white, alignment=TA_LEFT)),
     Paragraph("<b>PLAZO</b>", ParagraphStyle("th3", fontName="Helvetica-Bold",
              fontSize=9, textColor=white, alignment=TA_CENTER))],
    [Paragraph("<b>Etapa 1</b><br/><font color='#10B981' size='7'><b>OPERACIÓN</b></font>", style_meta),
     Paragraph("Mejoras 1 y 2: Pesos digitales + Guía digital con firma", style_meta),
     Paragraph("4 días", ParagraphStyle("c1", fontName="Helvetica", fontSize=9,
              textColor=GRIS_OSCURO, alignment=TA_CENTER))],
    [Paragraph("<b>Etapa 2</b><br/><font color='#3B82F6' size='7'><b>CONTROL</b></font>", style_meta),
     Paragraph("Mejoras 3, 4, 5 y 6: Tracking en vivo + Avisos + Costos y metas + Cobranzas", style_meta),
     Paragraph("8 días", ParagraphStyle("c3", fontName="Helvetica", fontSize=9,
              textColor=GRIS_OSCURO, alignment=TA_CENTER))],
    [Paragraph("<b>Etapa 3</b><br/><font color='#8B5CF6' size='7'><b>SUNAT + IA</b></font>", style_meta),
     Paragraph("Mejoras 7 y 8: Facturación electrónica SUNAT + Asistente con IA", style_meta),
     Paragraph("5 días", ParagraphStyle("c5", fontName="Helvetica", fontSize=9,
              textColor=GRIS_OSCURO, alignment=TA_CENTER))],
], colWidths=[2.5*cm, 12.9*cm, 2*cm])

cronograma.setStyle(TableStyle([
    # Header
    ("BACKGROUND", (0, 0), (-1, 0), GRIS_OSCURO),
    ("TOPPADDING", (0, 0), (-1, 0), 8),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
    ("LEFTPADDING", (0, 0), (-1, 0), 8),
    ("RIGHTPADDING", (0, 0), (-1, 0), 8),
    # Filas
    ("VALIGN", (0, 1), (-1, 3), "MIDDLE"),
    ("LEFTPADDING", (0, 1), (-1, 3), 8),
    ("RIGHTPADDING", (0, 1), (-1, 3), 8),
    ("TOPPADDING", (0, 1), (-1, 3), 4),
    ("BOTTOMPADDING", (0, 1), (-1, 3), 4),
    ("LINEBELOW", (0, 1), (-1, 3), 0.5, GRIS_BORDE),
    ("BACKGROUND", (0, 1), (-1, 1), white),
    ("BACKGROUND", (0, 2), (-1, 2), GRIS_CLARO),
    ("BACKGROUND", (0, 3), (-1, 3), white),
]))
story.append(cronograma)

story.append(Spacer(1, 0.2*cm))

# ─── Inversión total (precio único, grande, destacado) ───
total_box = Table([
    [Paragraph("<b>INVERSIÓN TOTAL DEL PROYECTO</b>",
               ParagraphStyle("tlbl", fontName="Helvetica-Bold", fontSize=10,
                              textColor=white, alignment=TA_LEFT, leading=12)),
     Paragraph("<b>S/ 4 000</b>",
               ParagraphStyle("tval", fontName="Helvetica-Bold", fontSize=20,
                              textColor=white, alignment=TA_RIGHT, leading=22))],
    [Paragraph("<font color='#FFFFFF' size='8'>Incluye las 8 mejoras y las 3 etapas de entrega</font>",
               ParagraphStyle("tsub", fontName="Helvetica", fontSize=8,
                              textColor=white, alignment=TA_LEFT)),
     Paragraph("<font color='#FFFFFF' size='9'>Anticipo S/ 2 000 abonado&nbsp;&nbsp;·&nbsp;&nbsp;Saldo <b>S/ 2 000</b> a la entrega</font>",
               ParagraphStyle("tsub2", fontName="Helvetica", fontSize=9,
                              textColor=white, alignment=TA_RIGHT))],
], colWidths=[8*cm, 9.4*cm])
total_box.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), ROJO),
    ("VALIGN", (0, 0), (-1, 0), "MIDDLE"),
    ("VALIGN", (0, 1), (-1, 1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 14),
    ("RIGHTPADDING", (0, 0), (-1, -1), 14),
    ("TOPPADDING", (0, 0), (-1, 0), 8),
    ("TOPPADDING", (0, 1), (-1, 1), 0),
    ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
    ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
    ("LINEABOVE", (0, 1), (-1, 1), 0.5, white),
]))
story.append(total_box)

story.append(Spacer(1, 0.2*cm))

# ─── Condiciones (compacto, 3 bloques en una caja) ───
condiciones_texto = Paragraph(
    "<b><font color='#C8102E'>Estado de pago:</font></b> Anticipo del 50% (<b>S/ 2 000</b>) ya abonado. "
    "Saldo pendiente: <b>S/ 2 000</b> a la entrega final del proyecto.&nbsp;&nbsp;&nbsp;"
    "<b><font color='#C8102E'>Plazo:</font></b> 17 días aproximadamente.<br/>"
    "<b><font color='#C8102E'>Costos mensuales:</font></b> S/ 0 con el volumen actual. La facturación "
    "electrónica SUNAT requiere un proveedor autorizado (PSE) que el cliente contrata por separado según volumen.<br/>"
    "<b><font color='#C8102E'>Optimización de costos:</font></b> Se trabajará buscando mantener al mínimo "
    "los costos de IA, tiempo real y servicios asociados, optimizando consumos para que el sistema "
    "escale sin generar gastos mensuales mientras sea posible.",
    ParagraphStyle("ct", fontName="Helvetica", fontSize=8.5, leading=12,
                   textColor=GRIS_OSCURO, alignment=TA_JUSTIFY, spaceAfter=2)
)

condiciones = Table([[condiciones_texto]], colWidths=[17.8*cm])
condiciones.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ("RIGHTPADDING", (0, 0), (-1, -1), 10),
    ("TOPPADDING", (0, 0), (-1, -1), 8),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ("BACKGROUND", (0, 0), (-1, -1), GRIS_CLARO),
    ("LINEBEFORE", (0, 0), (0, -1), 3, ROJO),
]))
story.append(condiciones)

# ── Build ──
doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)

print(f"✅ PDF generado: {OUTPUT}")
import os
size_kb = os.path.getsize(OUTPUT) / 1024
print(f"📄 Tamaño: {size_kb:.1f} KB")
