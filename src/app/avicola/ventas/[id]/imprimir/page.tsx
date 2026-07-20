// src/app/avicola/ventas/[id]/imprimir/page.tsx
// Página HTML pública para la impresión de la "Guía de Venta" de campo de Avícola de Tony
// (Documento interno informal que se imprime en tiqueteras de 80mm o en hojas A4, sin usar librerías PDF).
import { neon } from "@neondatabase/serverless";
import { guiaDeVenta } from "@/lib/avicola/guia";
import { notFound } from "next/navigation";
import { formatNumeroGuia } from "@/lib/correlativos";
import OrdenImprimible from "@/components/OrdenImprimible";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function VentaImprimirPage({ params }: PageProps) {
  const { id } = await params;
  const sql = neon(process.env.DATABASE_URL!);

  // Cargar datos completos de la venta y estado de cuenta
  const data = await guiaDeVenta(sql, id);
  if (!data) return notFound();

  return (
    <OrdenImprimible
      tipoDocumento="Guía de Venta"
      numero={formatNumeroGuia(data.numero_guia)}
      empresa={data.cliente.empresa}
      clienteNombre={data.cliente.nombre}
      clienteDetalle={`${data.cliente.mercado}${
        data.cliente.numero_puesto ? ` · Puesto ${data.cliente.numero_puesto}` : ""
      }`}
      clienteTelefono={data.cliente.telefono || undefined}
      fecha={data.fecha}
      notas={data.observaciones || undefined}
      items={data.items.map((it) => ({
        producto: it.producto_nombre,
        cantidad: it.peso_kg,
        unidad: "kg",
        precio: it.precio_kg,
        subtotal: it.subtotal,
      }))}
      total={data.total}
      anulada={data.anulada}
      estadoCuenta={{
        saldoPrevio: data.estado_cuenta.saldo_previo,
        totalVenta: data.estado_cuenta.total_venta,
        abonosAplicados: data.estado_cuenta.abonos_aplicados,
        saldoActualizado: data.estado_cuenta.saldo_actualizado,
      }}
    />
  );
}
