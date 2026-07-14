// Fixture visual del PDF de proveedores. No usa datos reales.
//   node --no-warnings scripts/generate-test-estado-cuenta-proveedor-pdf.mjs
//   pdftoppm -png tmp/pdfs/estado-cuenta-proveedor-qa.pdf tmp/pdfs/proveedor-qa
import { mkdir, writeFile } from "node:fs/promises";
import { construirEstadoCuentaProveedor } from "../src/lib/proveedores/estado-cuenta.ts";
import { generarPdfEstadoCuentaProveedor } from "../src/lib/reportes/pdf-estado-cuenta-proveedor.ts";

const proveedor = {
  id: "00000000-0000-4000-8000-000000000001",
  razon_social: "AVICOLA EL RICO - PROVEEDOR DE PRUEBA CON NOMBRE EXTENSO",
  ruc: "20123456789",
  telefono: "999 888 777",
  direccion: "Av. Prueba 123, San Juan de Lurigancho, Lima",
  activo: true,
  plazo_pago_dias: 30,
};

const movimientos = [];
let pagoNumero = 0;
for (let i = 1; i <= 16; i += 1) {
  const deudaId = `deuda-${String(i).padStart(2, "0")}`;
  const monto = 420 + i * 37.45;
  movimientos.push({
    id: deudaId,
    tipo: "deuda",
    fecha: `2026-06-${String(Math.min(28, i)).padStart(2, "0")}`,
    created_at: `2026-06-${String(Math.min(28, i)).padStart(2, "0")}T06:30:00-05:00`,
    monto,
    documento: `Boleta T008-${String(16000 + i)}`,
    concepto: "Compra de mercaderia",
    cuenta_nombre: null,
    notas: null,
    items: [
      {
        id: `item-${i}-1`,
        producto_nombre: "Pollo entero con menudencia seleccionado",
        peso_neto: 31.25 + i,
        jabas: 3,
        costo_unitario: 8.9,
        subtotal: 278.13 + i * 8.9,
        tipo: "ingreso",
      },
      {
        id: `item-${i}-2`,
        producto_nombre: "Pechuga deshuesada especial",
        peso_neto: 12.4,
        jabas: 1,
        costo_unitario: 14.2,
        subtotal: 176.08,
        tipo: "ingreso",
      },
    ],
    aplicaciones: [],
  });
  if (i % 2 === 0) {
    pagoNumero += 1;
    movimientos.push({
      id: `pago-${pagoNumero}`,
      tipo: "pago",
      fecha: `2026-06-${String(Math.min(28, i)).padStart(2, "0")}`,
      created_at: `2026-06-${String(Math.min(28, i)).padStart(2, "0")}T${String(9 + (pagoNumero % 3)).padStart(2, "0")}:15:00-05:00`,
      monto: 500,
      documento: null,
      concepto: "Pago al proveedor",
      cuenta_nombre: pagoNumero % 2 ? "BBVA Antonio" : "Caja Efectivo Planta",
      notas: `Operacion QA ${100000 + pagoNumero}`,
      items: [],
      aplicaciones: [
        {
          id: `app-${pagoNumero}`,
          pago_id: `pago-${pagoNumero}`,
          deuda_id: deudaId,
          monto: 500,
          origen: "pago",
          fecha_aplicacion: `2026-06-${String(Math.min(28, i)).padStart(2, "0")}`,
          documento: `Boleta T008-${String(16000 + i)}`,
        },
      ],
    });
  }
}

// Caso visual de auditoria: el pago no desaparece al anularse y el documento
// muestra el contraasiento en una fila posterior con efecto financiero inverso.
const aplicacionesPagoAnulado = [
  {
    id: "app-pago-anulado",
    pago_id: "pago-anulado",
    deuda_id: "deuda-12",
    monto: 350,
    origen: "pago",
    fecha_aplicacion: "2026-06-27",
    documento: "Boleta T008-16012",
  },
];
movimientos.push(
  {
    id: "pago-anulado",
    tipo: "pago",
    fecha: "2026-06-27",
    created_at: "2026-06-27T11:40:00-05:00",
    monto: 350,
    documento: null,
    concepto: "Pago al proveedor",
    cuenta_nombre: "BBVA Antonio",
    notas: "Operacion QA anulada 200001",
    items: [],
    aplicaciones: aplicacionesPagoAnulado,
  },
  {
    id: "pago-anulado-contraasiento",
    tipo: "contraasiento",
    fecha: "2026-06-28",
    created_at: "2026-06-28T08:10:00-05:00",
    monto: 350,
    documento: null,
    concepto: "Contraasiento de pago anulado",
    cuenta_nombre: "BBVA Antonio",
    notas: "Referencia bancaria incorrecta",
    items: [],
    aplicaciones: aplicacionesPagoAnulado,
  }
);

const estado = construirEstadoCuentaProveedor(movimientos);
const blob = await generarPdfEstadoCuentaProveedor(proveedor, estado);
await mkdir("tmp/pdfs", { recursive: true });
await writeFile("tmp/pdfs/estado-cuenta-proveedor-qa.pdf", Buffer.from(await blob.arrayBuffer()));
console.log("tmp/pdfs/estado-cuenta-proveedor-qa.pdf");
