// src/lib/prestamos.ts
import { neon } from "@neondatabase/serverless";

export async function recalcularSaldo(proveedorId: string, productoId: string) {
  const sql = neon(process.env.DATABASE_URL!);
  const result = await sql`
    SELECT 
      COALESCE(SUM(
        CASE 
          WHEN tipo_movimiento IN ('PRESTAMO_OTORGADO', 'DEVOLUCION_OTORGADA') THEN jabas 
          WHEN tipo_movimiento IN ('PRESTAMO_RECIBIDO', 'DEVOLUCION_RECIBIDA') THEN -jabas 
          ELSE 0 
        END
      ), 0)::int AS total_jabas,
      COALESCE(SUM(
        CASE 
          WHEN tipo_movimiento IN ('PRESTAMO_OTORGADO', 'DEVOLUCION_OTORGADA') THEN peso_kg 
          WHEN tipo_movimiento IN ('PRESTAMO_RECIBIDO', 'DEVOLUCION_RECIBIDA') THEN -peso_kg 
          ELSE 0 
        END
      ), 0)::numeric AS total_peso
    FROM prestamos_transacciones
    WHERE proveedor_id = ${proveedorId} AND producto_id = ${productoId}
  `;

  const jabas = Number(result[0].total_jabas);
  const pesoKg = Number(result[0].total_peso);

  await sql`
    INSERT INTO prestamos_saldos (proveedor_id, producto_id, jabas, peso_kg, updated_at)
    VALUES (${proveedorId}, ${productoId}, ${jabas}, ${pesoKg}, NOW())
    ON CONFLICT (proveedor_id, producto_id) DO UPDATE SET
      jabas = EXCLUDED.jabas,
      peso_kg = EXCLUDED.peso_kg,
      updated_at = NOW()
  `;
}
