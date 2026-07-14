import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const root = process.cwd();
const leer = (ruta) => readFile(join(root, ruta), "utf8");

const endpoint = await leer("src/app/api/pedidos/[id]/reprogramar/route.ts");

// Contrato de entrada: UUID real, fecha de calendario real y JSON inválido como 400.
assert.match(endpoint, /const UuidSchema = z\.string\(\)\.uuid\(\)/);
assert.match(endpoint, /valor\.toISOString\(\)\.slice\(0, 10\) === fecha/);
assert.match(endpoint, /El cuerpo JSON no es válido/);

// Producción solo puede mover a mañana en sus tres estados. Las mismas reglas se
// revalidan sobre la fila bloqueada, no solo en una lectura previa vulnerable a carrera.
assert.match(
  endpoint,
  /const ESTADOS_PRODUCCION = \["Pendiente", "En_Produccion", "Listo_Para_Despacho"\]/
);
assert.match(endpoint, /FOR UPDATE OF p/);
assert.match(endpoint, /\), permitido AS \(/);
assert.match(
  endpoint,
  /AND \$\{nueva_fecha\}::date =\s*\(NOW\(\) AT TIME ZONE 'America\/Lima'\)::date \+ 1/
);

// Un mismo destino no genera otro cambio: actualización, auditoría y aviso nacen
// del RETURNING de una sola sentencia atómica.
assert.match(endpoint, /p\.fecha_pedido IS DISTINCT FROM \$\{nueva_fecha\}::date/);
assert.match(endpoint, /\), auditoria AS \([\s\S]*?FROM actualizado/);
assert.match(endpoint, /\), destinatarios AS \([\s\S]*?FROM actualizado/);
assert.match(endpoint, /\), avisos AS \([\s\S]*?FROM destinatarios d/);
assert.match(endpoint, /idempotente: !resultado\.actualizado/);
assert.doesNotMatch(endpoint, /crearNotificacion\(/);

const produccion = await leer("src/app/dashboard/produccion/produccion-client.tsx");
assert.match(produccion, /const hayCambiosSinGuardar = pedido\.items\.some/);
assert.match(produccion, /Primero guarda los cambios de pesos, unidades o precios/);
assert.match(produccion, /Date\.UTC\(/, "mañana debe calcularse sin depender de la zona del navegador");
assert.match(produccion, /ref=\{motivoReprogramacionRef\}/);
assert.match(produccion, /aria-labelledby="titulo-pedido-produccion"/);
assert.match(produccion, /event\.key === "Escape"/);
assert.match(produccion, /event\.key !== "Tab"/);

const popup = await leer("src/components/ArriboPopup.tsx");
assert.match(popup, /sessionStorage\.setItem\(STORAGE_CERRADAS/);
assert.match(
  popup,
  /recordarAparicionEnSesion\(alertasArribo\[0\]\.id\);\s*setActivo\(alertasArribo\[0\]\)/,
  "la aparición debe recordarse al mostrarla, no solo cuando el usuario la cierre"
);
assert.match(popup, /n\.tipo === "pedido_reprogramado"/);
assert.match(popup, /role="dialog"/);
assert.match(popup, /role="status" aria-live="polite"/);
assert.match(popup, /event\.key === "Escape"/);
assert.match(popup, /event\.key !== "Tab"/);
assert.match(
  popup,
  /onClick=\{esReprogramacion \? handleCerrarTemporal : handleMarcarLeido\}/,
  "cerrar una reprogramación debe conservarla sin leer en la campana"
);

const campana = await leer("src/components/NotificationBell.tsx");
assert.match(campana, /case "pedido_reprogramado":[\s\S]*?<FiCalendar/);
assert.match(campana, /case "pedido_reprogramado":[\s\S]*?border-l-orange-500/);

const detallePedido = await leer("src/app/api/pedidos/[id]/route.ts");
assert.match(detallePedido, /const asesorPropietarioId = pedido\.asesor_id \?\? pedido\.cliente_asesor_id/);
assert.match(detallePedido, /asesorPropietarioId !== session\.user\.id/);
assert.doesNotMatch(
  detallePedido,
  /pedido\.asesor_id !== session\.user\.id\s*&&\s*pedido\.cliente_asesor_id !== session\.user\.id/,
  "el asesor actual del cliente no debe saltarse al asesor histórico del pedido"
);

const dashboard = await leer("src/app/dashboard/dashboard-content.tsx");
assert.match(dashboard, /searchParams\.get\('pedido'\)/);
assert.match(dashboard, /fetch\(`\/api\/pedidos\/\$\{pedidoId\}`\)/);
assert.match(dashboard, /setEditingPedido\(\{ \.\.\.pedido, fecha_pedido \}\)/);

console.log("Reprogramación de Producción: permisos, idempotencia, aviso y enlace OK");
