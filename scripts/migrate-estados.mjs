// scripts/migrate-estados.mjs
// Migración: entregado (boolean) → estado (varchar) + campos de despacho
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Error: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
  }

  const sql = neon(connectionString);
  console.log('🚀 Iniciando migración de estados de pedidos...\n');

  try {
    // ── 1. Verificar si la migración ya fue ejecutada ──
    const checkColumn = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'pedidos' AND column_name = 'estado'
    `;

    if (checkColumn.length > 0) {
      console.log('⚠️  La columna "estado" ya existe. La migración ya fue ejecutada.');
      process.exit(0);
    }

    // ── 2. Agregar nuevas columnas ──
    console.log('📦 Agregando nuevas columnas...');

    await sql`ALTER TABLE pedidos ADD COLUMN estado VARCHAR(20) NOT NULL DEFAULT 'Pendiente'`;
    console.log('   ✅ estado');

    await sql`ALTER TABLE pedidos ADD COLUMN repartidor_id UUID REFERENCES users(id)`;
    console.log('   ✅ repartidor_id');

    await sql`ALTER TABLE pedidos ADD COLUMN orden_ruta INTEGER`;
    console.log('   ✅ orden_ruta');

    await sql`ALTER TABLE pedidos ADD COLUMN hora_llegada_estimada TIMESTAMP WITH TIME ZONE`;
    console.log('   ✅ hora_llegada_estimada');

    await sql`ALTER TABLE pedidos ADD COLUMN razon_fallo TEXT`;
    console.log('   ✅ razon_fallo');

    await sql`ALTER TABLE pedidos ADD COLUMN inicio_viaje_at TIMESTAMP WITH TIME ZONE`;
    console.log('   ✅ inicio_viaje_at');

    // ── 3. Migrar datos existentes ──
    console.log('\n🔄 Migrando datos existentes...');

    const updatedEntregados = await sql`
      UPDATE pedidos SET estado = 'Entregado' WHERE entregado = TRUE
    `;
    console.log(`   ✅ ${updatedEntregados.count ?? 0} pedidos marcados como "Entregado"`);

    const updatedPendientes = await sql`
      UPDATE pedidos SET estado = 'Pendiente' WHERE entregado = FALSE
    `;
    console.log(`   ✅ ${updatedPendientes.count ?? 0} pedidos marcados como "Pendiente"`);

    // Migrar repartidor_id desde entregado_por (matching por nombre de usuario)
    const migratedRepartidores = await sql`
      UPDATE pedidos p SET repartidor_id = u.id
      FROM users u
      WHERE p.entregado_por = u.name AND p.entregado_por IS NOT NULL
    `;
    console.log(`   ✅ ${migratedRepartidores.count ?? 0} pedidos vinculados a repartidores`);

    // ── 4. Crear índices para performance ──
    console.log('\n📊 Creando índices...');

    await sql`CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos(estado)`;
    console.log('   ✅ idx_pedidos_estado');

    await sql`CREATE INDEX IF NOT EXISTS idx_pedidos_repartidor ON pedidos(repartidor_id)`;
    console.log('   ✅ idx_pedidos_repartidor');

    await sql`CREATE INDEX IF NOT EXISTS idx_pedidos_fecha_estado ON pedidos(fecha_pedido, estado)`;
    console.log('   ✅ idx_pedidos_fecha_estado');

    // ── 5. Verificación ──
    console.log('\n🔍 Verificación post-migración:');
    const counts = await sql`
      SELECT estado, COUNT(*) as total FROM pedidos GROUP BY estado ORDER BY total DESC
    `;
    for (const row of counts) {
      console.log(`   ${row.estado}: ${row.total} pedidos`);
    }

    console.log('\n✅ ¡Migración completada exitosamente!');
    console.log('ℹ️  La columna "entregado" se mantiene como respaldo. Se puede eliminar en una fase posterior.\n');

  } catch (error) {
    console.error('\n❌ Error durante la migración:', error);
    process.exit(1);
  }
}

main();
