// scripts/check-pedidos-cols.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const cols = await sql`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'pedidos'
  `;
  console.log("Columnas de pedidos:", cols.map(c => `${c.column_name}: ${c.data_type}`));
}

main().catch(console.error);
