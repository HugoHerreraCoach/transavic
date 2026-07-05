// scripts/migrate-trigger-auditoria.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
const sql = neon(connectionString);

async function migrate() {
  console.log("🔄 Creando trigger de auditoría para precios de productos...");

  // Creamos la función del trigger
  await sql`
    CREATE OR REPLACE FUNCTION audit_precio_producto()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.precio_venta <> OLD.precio_venta OR NEW.precio_compra <> OLD.precio_compra THEN
        INSERT INTO public.precios_audit_log (
          entidad, entidad_id, precio_anterior, precio_nuevo, motivo, modificado_por
        ) VALUES (
          'producto', 
          NEW.producto_id, 
          OLD.precio_venta, 
          NEW.precio_venta, 
          'Cambio de precio detectado por trigger', 
          NEW.created_by
        );
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `;

  // Asignamos el trigger a la tabla
  await sql`
    DROP TRIGGER IF EXISTS trigger_audit_precio_producto ON public.precios_productos;
  `;
  await sql`
    CREATE TRIGGER trigger_audit_precio_producto
    AFTER UPDATE ON public.precios_productos
    FOR EACH ROW
    EXECUTE FUNCTION audit_precio_producto();
  `;

  console.log("   ✅ Trigger audit_precio_producto creado exitosamente");
}

migrate().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
