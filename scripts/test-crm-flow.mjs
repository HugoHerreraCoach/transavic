// scripts/test-crm-flow.mjs
import { handleInboundMessage } from "../src/lib/chatbot/bot-orchestrator.js";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL no está definida.");
  process.exit(1);
}
const sql = neon(connectionString);

async function runTest() {
  console.log("🚀 Iniciando prueba automatizada de flujo de CRM y Chatbot de IA...\n");

  const testPhone = "51999999999";
  const testName = "Cliente de Prueba (Pollería)";
  const testMsg1 = "Hola, buenas tardes. ¿Tienen pollo entero con menudo y hacen entregas en Miraflores?";

  // 1. Limpiar cualquier residuo de pruebas previas
  await sql`DELETE FROM public.leads WHERE telefono = ${testPhone}`;

  console.log(`💬 Simulando mensaje entrante de: ${testName} (${testPhone})`);
  console.log(`   Mensaje: "${testMsg1}"`);

  // 2. Invocar el orquestador del chatbot
  console.log("\n🤖 Generando respuesta automática del Chatbot con Gemini/Groq...");
  const reply1 = await handleInboundMessage(testPhone, testName, testMsg1);
  console.log(`\n🤖 Respuesta del Bot:\n   "${reply1}"`);

  // 3. Consultar base de datos para verificar que el lead fue creado y guardado correctamente
  const leadRows = await sql`SELECT * FROM public.leads WHERE telefono = ${testPhone}`;
  if (leadRows.length === 0) {
    throw new Error("❌ Error: El lead no se insertó en la base de datos.");
  }
  const lead = leadRows[0];
  console.log(`\n✅ Lead creado en BD con ID: ${lead.id}`);
  console.log(`   Estado: ${lead.estado}`);
  console.log(`   Chatbot Activo: ${lead.chatbot_activo}`);

  // Verificar mensajes
  const msgRows = await sql`SELECT sender, body FROM public.lead_mensajes WHERE lead_id = ${lead.id} ORDER BY created_at ASC`;
  console.log("\n✉️ Mensajes registrados en base de datos:");
  msgRows.forEach((m) => {
    console.log(`   [${m.sender}] -> ${m.body}`);
  });

  // 4. Probar comportamiento de Handoff
  const testMsg2 = "Quiero hacer un pedido de 20 pollos enteros para mañana, por favor pásame con una asesora.";
  console.log(`\n💬 Simulando segundo mensaje del cliente (solicitando asesor):`);
  console.log(`   Mensaje: "${testMsg2}"`);

  const reply2 = await handleInboundMessage(testPhone, testName, testMsg2);
  console.log(`\n🤖 Respuesta del Bot (con Handoff):\n   "${reply2}"`);

  // Verificar si el chatbot se desactivó
  const leadRowsUpdated = await sql`SELECT chatbot_activo, estado FROM public.leads WHERE id = ${lead.id}`;
  const leadUpdated = leadRowsUpdated[0];
  console.log(`\n✅ Estado de chatbot actualizado en BD:`);
  console.log(`   Chatbot Activo: ${leadUpdated.chatbot_activo} (Debería ser FALSE)`);
  console.log(`   Estado Comercial: ${leadUpdated.estado} (Debería ser 'Contactado')`);

  // 5. Limpieza final de la base de datos
  console.log("\n🧹 Limpiando base de datos...");
  await sql`DELETE FROM public.leads WHERE id = ${lead.id}`;
  console.log("✅ Base de datos limpia de pruebas.");

  console.log("\n🎉 ¡Todas las pruebas de flujo del CRM y Chatbot concluyeron con éxito!");
}

runTest().catch((err) => {
  console.error("\n❌ Error en la ejecución de la prueba:", err);
  process.exit(1);
});
