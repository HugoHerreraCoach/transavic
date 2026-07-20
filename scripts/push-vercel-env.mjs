import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

// Parse .env.local
const envPath = path.resolve('.env.local');
if (!fs.existsSync(envPath)) {
  console.error('❌ Error: .env.local no existe.');
  process.exit(1);
}

const dotenv = fs.readFileSync(envPath, 'utf8');
const lines = dotenv.split('\n');

const vars = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
  'NEXT_PUBLIC_FIREBASE_VAPID_KEY'
];

async function addEnv(name, value) {
  return new Promise((resolve) => {
    // Remover primero la variable vieja para evitar duplicados / conflictos
    const rm = spawn('npx', ['vercel', 'env', 'rm', name, 'production', '-y']);
    
    rm.on('close', () => {
      console.log(`🔄 Agregando ${name} a Vercel...`);
      const add = spawn('npx', ['vercel', 'env', 'add', name, 'production']);
      
      add.stdin.write(value);
      add.stdin.end();
      
      add.on('close', (code) => {
        if (code === 0) {
          console.log(`   ✅ ${name} guardada en Vercel.`);
        } else {
          console.error(`   ❌ Error al guardar ${name}.`);
        }
        resolve();
      });
    });
  });
}

async function main() {
  for (const name of vars) {
    const line = lines.find(l => l.trim().startsWith(name + '='));
    if (line) {
      let value = line.split('=')[1].trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      }
      if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      }
      
      // Desescapar saltos de línea para que se guarden como saltos de línea reales
      value = value.replace(/\\n/g, '\n');
      
      await addEnv(name, value);
    }
  }
  
  console.log('🎉 Todas las credenciales configuradas en Vercel.');
}

main();
