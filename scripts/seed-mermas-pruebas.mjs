// scripts/seed-mermas-pruebas.mjs
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL no encontrada.");
  process.exit(1);
}

const sql = neon(dbUrl);

async function main() {
  console.log("Iniciando seed de datos de prueba completos para mermas...");

  // 1. Obtener o crear productos de prueba
  const productosData = [
    { nombre: "Alas", categoria: "Pollo", unidad: "kg" },
    { nombre: "Filetes de pierna", categoria: "Pollo", unidad: "kg" },
    { nombre: "Gallina colorada o roja", categoria: "Pollo", unidad: "kg" },
    { nombre: "Gallina doble pechuga", categoria: "Pollo", unidad: "kg" },
    { nombre: "Menudencia Mixta", categoria: "Pollo", unidad: "kg" }
  ];

  const productos = [];
  for (const p of productosData) {
    const existing = await sql`
      SELECT id, nombre FROM public.productos WHERE nombre = ${p.nombre} LIMIT 1
    `;
    if (existing.length > 0) {
      await sql`
        UPDATE public.productos SET activo = true WHERE id = ${existing[0].id}
      `;
      productos.push(existing[0]);
      console.log(`Producto reutilizado: ${existing[0].nombre} (${existing[0].id})`);
    } else {
      const rows = await sql`
        INSERT INTO public.productos (nombre, categoria, unidad, precio_compra, precio_venta, activo)
        VALUES (${p.nombre}, ${p.categoria}, ${p.unidad}, 8.00, 10.00, true)
        RETURNING id, nombre
      `;
      productos.push(rows[0]);
      console.log(`Producto creado: ${rows[0].nombre} (${rows[0].id})`);
    }
  }

  // 2. Obtener o crear un proveedor
  let proveedorId;
  const provRows = await sql`
    SELECT id FROM proveedores LIMIT 1
  `;
  if (provRows.length > 0) {
    proveedorId = provRows[0].id;
  } else {
    const newProv = await sql`
      INSERT INTO proveedores (razon_social, ruc, direccion, celular, activo)
      VALUES ('Distribuidora San Fernando S.A.', '20100012345', 'Av. Central 456, Lima', '987654321', true)
      RETURNING id
    `;
    proveedorId = newProv[0].id;
  }

  // 3. Obtener o crear un cliente de ejecutivas
  let clienteId;
  const cliRows = await sql`
    SELECT id FROM clientes LIMIT 1
  `;
  if (cliRows.length > 0) {
    clienteId = cliRows[0].id;
  } else {
    const newCli = await sql`
      INSERT INTO clientes (nombre, celular, direccion, distrito, whatsapp, activo)
      VALUES ('Pollería El Pollo Loco', '912345678', 'Av. Larco 789', 'MIRAFLORES', '51912345678', true)
      RETURNING id
    `;
    clienteId = newCli[0].id;
  }

  // 4. Obtener o crear un cliente de campo (ventas_avicola)
  let clienteAvicolaId;
  const cliAviRows = await sql`
    SELECT id FROM clientes_avicola LIMIT 1
  `;
  if (cliAviRows.length > 0) {
    clienteAvicolaId = cliAviRows[0].id;
  } else {
    const newCliAvi = await sql`
      INSERT INTO clientes_avicola (nombre, ruc_dni, celular, direccion, activo)
      VALUES ('Restaurante Las Canastas', '20456789123', 'Av. Arequipa 1234', '955666777', true)
      RETURNING id
    `;
    clienteAvicolaId = newCliAvi[0].id;
  }

  // 5. Obtener un usuario
  let usuarioId;
  const userRows = await sql`
    SELECT id FROM users LIMIT 1
  `;
  if (userRows.length > 0) {
    usuarioId = userRows[0].id;
  } else {
    console.error("No hay usuarios en la base de datos. Por favor, crea un usuario primero o ejecuta npm run seed.");
    process.exit(1);
  }

  // Fecha del seed: hoy en Lima (2026-07-26)
  const fechaSeed = "2026-07-26";

  // Limpiar datos previos
  await sql`DELETE FROM compra_items WHERE compra_id IN (SELECT id FROM compras WHERE fecha = ${fechaSeed}::date)`;
  await sql`DELETE FROM compras WHERE fecha = ${fechaSeed}::date`;
  await sql`DELETE FROM venta_avicola_items WHERE venta_id IN (SELECT id FROM ventas_avicola WHERE fecha = ${fechaSeed}::date)`;
  await sql`DELETE FROM ventas_avicola WHERE fecha = ${fechaSeed}::date`;
  await sql`DELETE FROM pedido_items WHERE pedido_id IN (SELECT id FROM pedidos WHERE (created_at AT TIME ZONE 'America/Lima')::date = ${fechaSeed}::date)`;
  await sql`DELETE FROM pedidos WHERE (created_at AT TIME ZONE 'America/Lima')::date = ${fechaSeed}::date`;
  await sql`DELETE FROM public.ajustes_cuadre_fisico WHERE fecha = ${fechaSeed}::date`;

  console.log("Limpieza de datos de prueba previos completada.");

  const alasProd = productos.find(p => p.nombre === "Alas");
  const piernaProd = productos.find(p => p.nombre === "Filetes de pierna");
  const coloradaProd = productos.find(p => p.nombre === "Gallina colorada o roja");
  const pechugaProd = productos.find(p => p.nombre === "Gallina doble pechuga");
  const menudenciaProd = productos.find(p => p.nombre === "Menudencia Mixta");

  // --- INSERTAR COMPRAS (CARGA) CON DESGLOSE MACHO/HEMBRA ---
  const newCompra = await sql`
    INSERT INTO compras (proveedor_id, fecha, tipo_doc, nro_doc, estado, total, created_by)
    VALUES (${proveedorId}, ${fechaSeed}::date, 'Guía de Remisión', 'GRE-002345', 'Completado', 2800.00, ${usuarioId})
    RETURNING id
  `;
  const compraId = newCompra[0].id;

  if (alasProd) {
    await sql`
      INSERT INTO compra_items (compra_id, producto_id, jabas, peso_bruto, peso_tara, peso_neto, costo_unitario, subtotal, tipo, jabas_macho, jabas_hembra, sueltos_macho, sueltos_hembra, total_pollos)
      VALUES (${compraId}, ${alasProd.id}, 10, 50.00, 0.00, 50.00, 8.00, 400.00, 'ingreso', 5, 5, 0, 0, 80)
    `;
  }
  if (piernaProd) {
    await sql`
      INSERT INTO compra_items (compra_id, producto_id, jabas, peso_bruto, peso_tara, peso_neto, costo_unitario, subtotal, tipo, jabas_macho, jabas_hembra, sueltos_macho, sueltos_hembra, total_pollos)
      VALUES (${compraId}, ${piernaProd.id}, 20, 100.00, 0.00, 100.00, 12.00, 1200.00, 'ingreso', 10, 10, 0, 0, 160)
    `;
  }
  if (coloradaProd) {
    // 40 Machos (4 jabas * 7 pollos = 28 + 12 sueltos) -> merma est: 40 * 0.35 = 14 kg
    // 35 Hembras (3 jabas * 9 pollos = 27 + 8 sueltas) -> merma est: 35 * 0.30 = 10.5 kg
    // Total aves: 75 und. Total merma est: 24.50 kg
    await sql`
      INSERT INTO compra_items (compra_id, producto_id, jabas, peso_bruto, peso_tara, peso_neto, costo_unitario, subtotal, tipo, jabas_macho, jabas_hembra, sueltos_macho, sueltos_hembra, total_pollos)
      VALUES (${compraId}, ${coloradaProd.id}, 7, 150.00, 0.00, 150.00, 10.00, 1500.00, 'ingreso', 4, 3, 12, 8, 75)
    `;
  }
  if (pechugaProd) {
    // 60 Machos (6 jabas * 7 = 42 + 18 sueltos) -> merma est: 60 * 0.35 = 21 kg
    // 40 Hembras (4 jabas * 9 = 36 + 4 sueltas) -> merma est: 40 * 0.30 = 12 kg
    // Total aves: 100 und. Total merma est: 33.00 kg
    await sql`
      INSERT INTO compra_items (compra_id, producto_id, jabas, peso_bruto, peso_tara, peso_neto, costo_unitario, subtotal, tipo, jabas_macho, jabas_hembra, sueltos_macho, sueltos_hembra, total_pollos)
      VALUES (${compraId}, ${pechugaProd.id}, 10, 200.00, 0.00, 200.00, 11.00, 2200.00, 'ingreso', 6, 4, 18, 4, 100)
    `;
  }
  if (menudenciaProd) {
    await sql`
      INSERT INTO compra_items (compra_id, producto_id, jabas, peso_bruto, peso_tara, peso_neto, costo_unitario, subtotal, tipo, jabas_macho, jabas_hembra, sueltos_macho, sueltos_hembra, total_pollos)
      VALUES (${compraId}, ${menudenciaProd.id}, 4, 30.00, 0.00, 30.00, 5.00, 150.00, 'ingreso', 0, 0, 0, 0, 0)
    `;
  }

  // --- INSERTAR VENTAS EJECUTIVAS (PEDIDOS ASESORA) ---
  const insertPedidoConItem = async (prodId, prodNombre, kilos, cajero = "Asesora Leslie", origen = "asesor") => {
    const newPed = await sql`
      INSERT INTO pedidos (cliente, cliente_id, estado, origen, created_at, entregado_por, direccion, detalle, empresa, fecha_pedido, entregado)
      VALUES ('Pollería El Pollo Loco', ${clienteId}, 'Entregado', ${origen}, (${fechaSeed} || ' 10:00:00')::timestamp AT TIME ZONE 'America/Lima', ${cajero}, 'Av. Larco 789', 'Pedidos de prueba para mermas', 'Transavic', ${fechaSeed}::date, true)
      RETURNING id
    `;
    const pedId = newPed[0].id;
    await sql`
      INSERT INTO pedido_items (pedido_id, producto_id, producto_nombre, cantidad, cantidad_real, unidad, precio_unitario, subtotal)
      VALUES (${pedId}, ${prodId}, ${prodNombre}, ${kilos}, ${kilos}, 'kg', 12.00, ${kilos * 12})
    `;
  };

  // Alas
  if (alasProd) await insertPedidoConItem(alasProd.id, alasProd.nombre, 15.00);
  // Pierna
  if (piernaProd) await insertPedidoConItem(piernaProd.id, piernaProd.nombre, 25.00);
  // Colorada
  if (coloradaProd) await insertPedidoConItem(coloradaProd.id, coloradaProd.nombre, 10.00);
  // Pechuga
  if (pechugaProd) await insertPedidoConItem(pechugaProd.id, pechugaProd.nombre, 45.00);
  // Menudencia
  if (menudenciaProd) await insertPedidoConItem(menudenciaProd.id, menudenciaProd.nombre, 5.00);

  // --- INSERTAR VENTAS EN CAMPO (AVICOLA) ---
  const ventaAviId = crypto.randomUUID();
  await sql`
    INSERT INTO ventas_avicola (id, cliente_id, fecha, numero_guia, observaciones, total, anulada, creado_por)
    VALUES (${ventaAviId}::uuid, ${clienteAvicolaId}, ${fechaSeed}::date, 445, 'Ruta de reparto Sur', 1200.00, false, ${usuarioId})
  `;

  const insertVentaCampoItem = async (prodId, prodNombre, kilos) => {
    await sql`
      INSERT INTO venta_avicola_items (venta_id, producto_id, producto_nombre, peso_kg, precio_kg, subtotal)
      VALUES (${ventaAviId}::uuid, ${prodId}, ${prodNombre}, ${kilos}, 12.00, ${kilos * 12})
    `;
  };

  if (alasProd) await insertVentaCampoItem(alasProd.id, alasProd.nombre, 8.00);
  if (piernaProd) await insertVentaCampoItem(piernaProd.id, piernaProd.nombre, 12.00);
  if (coloradaProd) await insertVentaCampoItem(coloradaProd.id, coloradaProd.nombre, 22.00);
  if (pechugaProd) await insertVentaCampoItem(pechugaProd.id, pechugaProd.nombre, 32.80);
  if (menudenciaProd) await insertVentaCampoItem(menudenciaProd.id, menudenciaProd.nombre, 4.00);

  // --- INSERTAR VENTAS EN PLANTA (POS PLANTA) ---
  // Alas
  if (alasProd) await insertPedidoConItem(alasProd.id, alasProd.nombre, 5.00, "Cajero Planta", "pos_planta");
  // Pierna
  if (piernaProd) await insertPedidoConItem(piernaProd.id, piernaProd.nombre, 18.00, "Cajero Planta", "pos_planta");
  // Colorada
  if (coloradaProd) await insertPedidoConItem(coloradaProd.id, coloradaProd.nombre, 12.50, "Cajero Planta", "pos_planta");
  // Pechuga
  if (pechugaProd) await insertPedidoConItem(pechugaProd.id, pechugaProd.nombre, 28.00, "Cajero Planta", "pos_planta");
  // Menudencia
  if (menudenciaProd) await insertPedidoConItem(menudenciaProd.id, menudenciaProd.nombre, 9.00, "Cajero Planta", "pos_planta");

  console.log("¡Seed de datos de prueba completos para mermas terminado con éxito!");
}

main().catch(err => {
  console.error("Error en el seed script:", err);
  process.exit(1);
});
