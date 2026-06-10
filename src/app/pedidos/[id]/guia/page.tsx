// src/app/pedidos/[id]/guia/page.tsx
// Página HTML imprimible de la "orden de pedido" (sin librería PDF — usa window.print()).
// (La ruta sigue llamándose /guia internamente por compatibilidad con enlaces existentes;
//  el documento ya NO es una guía de remisión legal, es una orden de pedido interna.)
// Ruta PÚBLICA fuera de /dashboard para que el motorizado/cliente pueda verla sin auth si tiene el link directo.
// Pero internamente verifica sesión para emisión de número correlativo.
import { neon } from "@neondatabase/serverless";
import { auth } from "@/auth";
import { siguienteCorrelativo, formatNumeroGuia } from "@/lib/correlativos";
import { notFound } from "next/navigation";
import GuiaImprimibleClient from "./guia-imprimible-client";

interface PageProps {
  params: Promise<{ id: string }>;
}

interface ItemRow {
  producto_nombre: string;
  cantidad: number;
  cantidad_real: number | null;
  unidad: string;
  precio_unitario: number | null;
  subtotal_real: number | null;
  subtotal: number | null;
}

export default async function GuiaPage({ params }: PageProps) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return <div className="p-8">No autorizado. Iniciá sesión primero.</div>;
  }

  const sql = neon(process.env.DATABASE_URL!);

  // Cargar pedido
  const pedidoRows = await sql`
    SELECT
      p.id, p.cliente, p.direccion, p.distrito, p.empresa, p.numero_guia,
      p.razon_social, p.ruc_dni, p.whatsapp, p.notas,
      TO_CHAR(p.fecha_pedido, 'DD/MM/YYYY') as fecha,
      u.name as asesor_name
    FROM pedidos p
    LEFT JOIN users u ON p.asesor_id = u.id
    WHERE p.id = ${id}
  `;
  if (pedidoRows.length === 0) return notFound();
  const pedido = pedidoRows[0];

  // Cargar items con pesos reales
  const items = (await sql`
    SELECT producto_nombre, cantidad, cantidad_real, unidad,
      precio_unitario, subtotal_real, subtotal
    FROM pedido_items
    WHERE pedido_id = ${id}
    ORDER BY producto_nombre ASC
  `) as ItemRow[];

  // Si el pedido no tiene número de orden aún, reservarlo ahora.
  // Usa el correlativo `orden_pedido` (interno), SEPARADO de la numeración legal
  // de las guías de remisión SUNAT (T001/T002). Antes compartían `guia_remision`
  // y abrir esta página gastaba un número de la guía legal (fix 2026-06-10).
  let numero = pedido.numero_guia as number | null;
  if (!numero) {
    numero = await siguienteCorrelativo("orden_pedido");
    await sql`UPDATE pedidos SET numero_guia = ${numero} WHERE id = ${id}`;
  }

  // Calcular total
  const totalReal = items.reduce(
    (s, it) => s + Number(it.subtotal_real ?? 0),
    0
  );
  const totalEstimado = items.reduce(
    (s, it) => s + Number(it.subtotal ?? 0),
    0
  );
  const total = totalReal > 0 ? totalReal : totalEstimado;

  return (
    <GuiaImprimibleClient
      numero={formatNumeroGuia(numero)}
      empresa={pedido.empresa as string}
      cliente={pedido.cliente as string}
      razonSocial={(pedido.razon_social as string) || ""}
      rucDni={(pedido.ruc_dni as string) || ""}
      direccion={(pedido.direccion as string) || ""}
      distrito={(pedido.distrito as string) || ""}
      whatsapp={(pedido.whatsapp as string) || ""}
      fecha={pedido.fecha as string}
      asesor={(pedido.asesor_name as string) || ""}
      notas={(pedido.notas as string) || ""}
      items={items.map((it) => ({
        producto: it.producto_nombre,
        cantidad: Number(it.cantidad_real ?? it.cantidad),
        unidad: it.unidad,
        precio: Number(it.precio_unitario ?? 0),
        subtotal: Number(it.subtotal_real ?? it.subtotal ?? 0),
      }))}
      total={total}
    />
  );
}
