// scripts/seed.mjs
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';
import bcrypt from 'bcrypt';

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.error('Error: La variable de entorno DATABASE_URL no está definida.');
    process.exit(1);
  }
  
  const sql = neon(connectionString);
  console.log('✅ Conexión establecida. Limpiando y creando tablas...');

  try {
    await sql`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`;

    // Limpiar tablas existentes
    await sql`DROP TABLE IF EXISTS pedidos;`;
    await sql`DROP TABLE IF EXISTS users;`;
    console.log('✅ Tablas anteriores eliminadas.');

    // Crear tabla de usuarios
    await sql`
      CREATE TABLE users (
        id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role VARCHAR(50) NOT NULL
      );
    `;
    console.log('✅ Tabla "users" creada.');

    // Hashear contraseñas y crear usuarios
    const users = [
      { name: 'Antonio', password: 'Antonio1234', role: 'admin' },
      { name: 'Leslie', password: 'Leslie1313', role: 'asesor' },
      { name: 'Yoshelin', password: 'Yoshelin1414', role: 'asesor' },
      { name: 'Sarai', password: 'Sarai1515', role: 'asesor' },
      { name: 'Yesica', password: 'Yesica1616', role: 'asesor' },
      { name: 'Reparto', password: 'Reparto2025', role: 'repartidor' },
    ];

    for (const user of users) {
      const hashedPassword = await bcrypt.hash(user.password, 10);
      await sql`
        INSERT INTO users (name, password, role)
        VALUES (${user.name}, ${hashedPassword}, ${user.role});
      `;
    }
    console.log('✅ Usuarios insertados.');

    // Crear tabla de pedidos
    await sql`
      CREATE TABLE pedidos (
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
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        asesor_id UUID REFERENCES users(id)
      );
    `;
    console.log('✅ Tabla "pedidos" creada.');

  } catch (error) {
    console.error('Error al ejecutar el script de seed:', error);
    process.exit(1);
  }
}

main();