// scripts/seed-precios-2026.mjs
// Seed inicial de precios para productos del catálogo Transavic.
// Precios obtenidos de mercado mayorista peruano (MIDAGRI, Carnicentro, La Calera, etc., mayo 2026).
// Antonio podrá ajustar todos estos precios desde /dashboard/precios.

import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL no está definida");
  process.exit(1);
}

const sql = neon(connectionString);

// ── Tabla de precios investigada ──
// precio_compra = lo que la distribuidora paga al proveedor primario
// precio_venta  = lo que cobra a restaurantes (mayorista)
// Fuentes: MIDAGRI mayorista Lima, Carnicentro, Klikame, La Calera, EMMSA, Beef's House.
const PRECIOS_2026 = [
  // ═══════════════════ POLLO ═══════════════════
  { nombre: "Pollo con menudencia entero",                                  precio_compra: 8.50,  precio_venta: 10.50 },
  { nombre: "Pollo entero sin menudencia",                                  precio_compra: 9.00,  precio_venta: 11.00 },
  { nombre: "Pechuga deshuesada / filetes",                                 precio_compra: 14.50, precio_venta: 18.00 },
  { nombre: "Pechuga especial con hueso",                                   precio_compra: 11.50, precio_venta: 14.50 },
  { nombre: "Filetes de pierna",                                            precio_compra: 12.50, precio_venta: 15.50 },
  { nombre: "Pierna especial",                                              precio_compra: 10.00, precio_venta: 12.50 },
  { nombre: "Piernas solas",                                                precio_compra: 9.50,  precio_venta: 12.00 },
  { nombre: "Encuentro / muslo",                                            precio_compra: 10.50, precio_venta: 13.00 },
  { nombre: "Alas",                                                         precio_compra: 9.50,  precio_venta: 12.00 },
  { nombre: "Milanesas",                                                    precio_compra: 15.50, precio_venta: 19.00 },
  { nombre: "Gallina doble pecho venta entera (peso aprox. 3.600 a 4.200 kg)", precio_compra: 11.00, precio_venta: 14.00 },
  { nombre: "Gallina colorada (peso aprox. 1.700 a 2kg)",                   precio_compra: 12.00, precio_venta: 15.00 },
  { nombre: "Menudencia",                                                   precio_compra: 4.20,  precio_venta: 5.50 },
  { nombre: "Pato entero precio",                                           precio_compra: 19.00, precio_venta: 24.00 },
  { nombre: "Magret de pato",                                               precio_compra: 78.00, precio_venta: 99.50 },
  { nombre: "Cuy entero precio por uni.",                                   precio_compra: 28.00, precio_venta: 35.00 },
  { nombre: "Pavita",                                                       precio_compra: 19.00, precio_venta: 24.00 },
  { nombre: "Piernitas bouchet de pollo",                                   precio_compra: 11.00, precio_venta: 14.00 },

  // ═══════════════════ CARNES (RES + CERDO) ═══════════════════
  { nombre: "Bistec de res",                                                precio_compra: 24.00, precio_venta: 30.00 },
  { nombre: "Lomo Fino (peso de 2 a 2.900 sale por entero)",                precio_compra: 38.00, precio_venta: 48.00 },
  { nombre: "Carne guiso de res (sin hueso)",                               precio_compra: 18.00, precio_venta: 22.00 },
  { nombre: "Carne molida de res especial",                                 precio_compra: 20.00, precio_venta: 25.00 },
  { nombre: "Costillar",                                                    precio_compra: 22.00, precio_venta: 28.00 },
  { nombre: "Hueso Manzano",                                                precio_compra: 12.00, precio_venta: 15.00 },
  { nombre: "Cerdo en corte de guiso",                                      precio_compra: 18.50, precio_venta: 23.00 },
  { nombre: "Osobuco con hueso",                                            precio_compra: 20.50, precio_venta: 26.00 },
  { nombre: "Osobuco sin hueso",                                            precio_compra: 26.50, precio_venta: 33.00 },
  { nombre: "Huachalomo",                                                   precio_compra: 32.00, precio_venta: 40.00 },
  { nombre: "Hígado de Res",                                                precio_compra: 12.00, precio_venta: 15.00 },
  { nombre: "Churrasco",                                                    precio_compra: 19.50, precio_venta: 24.50 },
  { nombre: "Lomo de cerdo sin hueso (peso de 5kg a 7kg) sale por entero",  precio_compra: 22.00, precio_venta: 28.00 },
  { nombre: "Lomo de cerdo con hueso (peso de 5kg a 7kg) sale por entero",  precio_compra: 19.00, precio_venta: 24.00 },
  { nombre: "Panceta",                                                      precio_compra: 25.50, precio_venta: 32.00 },
  { nombre: "Chuleta de cerdo",                                             precio_compra: 19.50, precio_venta: 24.50 },
  { nombre: "Mondonguito",                                                  precio_compra: 13.50, precio_venta: 17.00 },
  { nombre: "Corazón de res para anticucho por entero (peso aprox 1 kg)",   precio_compra: 16.00, precio_venta: 20.00 },

  // ═══════════════════ HUEVOS ═══════════════════
  { nombre: "Huevos x paquete de 6 planchas A GRANEL (solo x paquete 11.500 KG a 11.80 KG aprox)", precio_compra: 62.00, precio_venta: 75.00 },
  { nombre: "Huevos la calera plancha de 30 uni. Con fecha vencimiento",    precio_compra: 13.50, precio_venta: 16.50 },
  { nombre: "Huevos de corral x 12 unid. La calera",                        precio_compra: 9.50,  precio_venta: 12.00 },
];

async function seed() {
  console.log("🌱 Seed: precios 2026 (mercado mayorista Perú)\n");
  console.log(`📍 Conectado a: ${new URL(connectionString).hostname}\n`);

  let updates = 0;
  let inserts = 0;
  const misses = [];

  for (const p of PRECIOS_2026) {
    const productos = await sql`SELECT id FROM productos WHERE nombre = ${p.nombre} LIMIT 1`;
    if (productos.length === 0) {
      misses.push(p.nombre);
      continue;
    }
    const producto_id = productos[0].id;

    // 1. Actualizar snapshot en productos
    await sql`
      UPDATE productos
      SET precio_compra = ${p.precio_compra}, precio_venta = ${p.precio_venta}
      WHERE id = ${producto_id}
    `;
    updates++;

    // 2. Cerrar histórico anterior (si existía vigente)
    await sql`
      UPDATE precios_productos
      SET vigente_hasta = (NOW() AT TIME ZONE 'America/Lima')::date
      WHERE producto_id = ${producto_id} AND vigente_hasta IS NULL
    `;

    // 3. Insertar nuevo registro vigente
    await sql`
      INSERT INTO precios_productos (producto_id, precio_compra, precio_venta)
      VALUES (${producto_id}, ${p.precio_compra}, ${p.precio_venta})
    `;
    inserts++;
  }

  console.log(`✅ Actualizados: ${updates} productos`);
  console.log(`✅ Histórico insertado: ${inserts} registros vigentes`);
  if (misses.length > 0) {
    console.log(`\n⚠️  Productos NO encontrados en el catálogo (${misses.length}):`);
    for (const m of misses) console.log(`   • ${m}`);
  }

  // ── Verificación: top 5 productos con precio ──
  console.log("\n📊 Muestra de precios cargados:");
  const muestra = await sql`
    SELECT nombre, precio_compra, precio_venta
    FROM productos
    WHERE precio_venta IS NOT NULL
    ORDER BY precio_venta DESC
    LIMIT 5
  `;
  for (const m of muestra) {
    console.log(`   ${m.nombre}: compra S/ ${m.precio_compra} → venta S/ ${m.precio_venta}`);
  }

  console.log("\n🎉 Seed completado");
}

seed().catch((err) => {
  console.error("❌ Error en seed:", err);
  process.exit(1);
});
