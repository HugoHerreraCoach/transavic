// scripts/migrate-products.mjs
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('Error: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
  }

  const sql = neon(connectionString);
  console.log('✅ Conexión establecida. Creando tablas de productos...');

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

    // ── 1. Crear tabla de productos (catálogo) ──
    await sql`
      CREATE TABLE IF NOT EXISTS productos (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        categoria VARCHAR(50) NOT NULL,
        unidad VARCHAR(50) NOT NULL,
        activo BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('✅ Tabla "productos" creada.');

    // ── 2. Crear tabla de items por pedido ──
    await sql`
      CREATE TABLE IF NOT EXISTS pedido_items (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        pedido_id UUID REFERENCES pedidos(id) ON DELETE CASCADE,
        producto_id UUID REFERENCES productos(id),
        producto_nombre VARCHAR(255) NOT NULL,
        cantidad DECIMAL(10, 2) NOT NULL,
        unidad VARCHAR(50) NOT NULL,
        notas TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('✅ Tabla "pedido_items" creada.');

    // ── 3. Insertar catálogo de productos ──
    // Primero verificamos si ya hay productos
    const existingCount = await sql`SELECT COUNT(*) as count FROM productos`;
    if (Number(existingCount[0].count) > 0) {
      console.log(`⚠️  Ya existen ${existingCount[0].count} productos. Saltando inserción.`);
      return;
    }

    const productos = [
      // ═══════════════════════════════════════
      // PRODUCTOS DE POLLO
      // ═══════════════════════════════════════
      { nombre: 'Pollo con menudencia entero', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Pollo entero sin menudencia', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Pechuga deshuesada / filetes', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Pechuga especial con hueso', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Filetes de pierna', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Pierna especial', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Piernas solas', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Encuentro / muslo', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Alas', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Milanesas', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Gallina doble pecho venta entera (peso aprox. 3.600 a 4.200 kg)', categoria: 'Pollo', unidad: 'uni' },
      { nombre: 'Gallina colorada (peso aprox. 1.700 a 2kg)', categoria: 'Pollo', unidad: 'uni' },
      { nombre: 'Menudencia', categoria: 'Pollo', unidad: 'kg' },
      { nombre: 'Pato entero precio', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Magret de pato', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Cuy entero precio por uni.', categoria: 'Pollo', unidad: 'uni' },
      { nombre: 'Pavita', categoria: 'Pollo', unidad: 'uni/kg' },
      { nombre: 'Piernitas bouchet de pollo', categoria: 'Pollo', unidad: 'uni' },

      // ═══════════════════════════════════════
      // CARNES (RES, CERDO, OTROS)
      // ═══════════════════════════════════════
      { nombre: 'Bistec de res', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Lomo Fino (peso de 2 a 2.900 sale por entero)', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Carne guiso de res (sin hueso)', categoria: 'Carnes', unidad: 'kg' },
      { nombre: 'Carne molida de res especial', categoria: 'Carnes', unidad: 'kg' },
      { nombre: 'Costillar', categoria: 'Carnes', unidad: 'kg' },
      { nombre: 'Hueso Manzano', categoria: 'Carnes', unidad: 'kg' },
      { nombre: 'Cerdo en corte de guiso', categoria: 'Carnes', unidad: 'kg' },
      { nombre: 'Osobuco con hueso', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Osobuco sin hueso', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Huachalomo', categoria: 'Carnes', unidad: 'kg' },
      { nombre: 'Hígado de Res', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Churrasco', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Lomo de cerdo sin hueso (peso de 5kg a 7kg) sale por entero', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Lomo de cerdo con hueso (peso de 5kg a 7kg) sale por entero', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Panceta', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Chuleta de cerdo', categoria: 'Carnes', unidad: 'uni/kg' },
      { nombre: 'Mondonguito', categoria: 'Carnes', unidad: 'kg' },
      { nombre: 'Corazón de res para anticucho por entero (peso aprox 1 kg)', categoria: 'Carnes', unidad: 'uni/kg' },

      // ═══════════════════════════════════════
      // HUEVOS
      // ═══════════════════════════════════════
      { nombre: 'Huevos x paquete de 6 planchas A GRANEL (solo x paquete 11.500 KG a 11.80 KG aprox)', categoria: 'Huevos', unidad: 'paquete de 6' },
      { nombre: 'Huevos la calera plancha de 30 uni. Con fecha vencimiento', categoria: 'Huevos', unidad: 'plancha' },
      { nombre: 'Huevos de corral x 12 unid. La calera', categoria: 'Huevos', unidad: 'pack x uni' },
    ];

    for (const producto of productos) {
      await sql`
        INSERT INTO productos (nombre, categoria, unidad)
        VALUES (${producto.nombre}, ${producto.categoria}, ${producto.unidad})
      `;
    }
    console.log(`✅ ${productos.length} productos insertados exitosamente.`);

    // Mostrar resumen
    const resumen = await sql`
      SELECT categoria, COUNT(*) as total FROM productos GROUP BY categoria ORDER BY categoria
    `;
    console.log('\n📊 Resumen del catálogo:');
    for (const row of resumen) {
      console.log(`   ${row.categoria}: ${row.total} productos`);
    }

  } catch (error) {
    console.error('❌ Error al ejecutar la migración:', error);
    process.exit(1);
  }
}

main();
