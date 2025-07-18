// scripts/seed.mjs
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('Error: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
  }
  
  const sql = neon(connectionString);
  console.log('✅ Conexión establecida. Creando tabla...');

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

    await sql`
      CREATE TABLE IF NOT EXISTS pedidos (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        cliente VARCHAR(255) NOT NULL,
        whatsapp VARCHAR(50),
        direccion TEXT,
        distrito VARCHAR(100),
        tipo_cliente VARCHAR(50),
        detalle TEXT NOT NULL,
        hora_entrega VARCHAR(100),
        notas TEXT,
        empresa VARCHAR(100) NOT NULL,
        fecha_pedido DATE NOT NULL,
        peso_exacto DECIMAL(10, 2),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('✅ Tabla "pedidos" creada o ya existente.');
  } catch (error) {
    console.error('Error al crear la tabla:', error);
    process.exit(1);
  }
}

main();