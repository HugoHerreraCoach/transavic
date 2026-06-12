// src/app/pedidos/[id]/guia/guia-imprimible-client.tsx
// Componente cliente: render HTML de la "orden de pedido" + botón "Imprimir / Guardar PDF".
// Usa window.print() del navegador — sin librerías PDF, $0 costo.
//
// DOS formatos de impresión (el usuario elige; por defecto TICKET):
//   • Ticket (80mm): para impresora térmica / ticketera. Monocromo (las térmicas
//     no imprimen color), compacto, una columna, separadores punteados.
//   • A4: el documento completo de toda la vida (logo, tabla, etc.).
// El tamaño de página (@page size) se calcula justo antes de imprimir en Ticket.
// En celular Android con ticketera Bluetooth, el botón Bluetooth manda texto directo
// a RawBT para evitar el paginado HTML/PDF del navegador.
//
// Toggle "Incluir precios": cada cliente maneja precios distintos, así que al
// imprimir el usuario decide si la orden lleva precios o solo cantidades.
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FiBluetooth, FiPrinter, FiShare2 } from "react-icons/fi";

interface Item {
  producto: string;
  cantidad: number;
  unidad: string;
  precio: number;
  subtotal: number;
}

interface Props {
  numero: string;
  empresa: string;
  cliente: string;
  razonSocial: string;
  rucDni: string;
  direccion: string;
  distrito: string;
  whatsapp: string;
  fecha: string;
  asesor: string;
  notas: string;
  items: Item[];
  total: number;
}

type Formato = "ticket" | "a4";

const PX_A_MM = 25.4 / 96;
const COLCHON_TICKET_MM = 6;
const RAWBT_PACKAGE = "ru.a402d.rawbtprinter";
const RAWBT_PLAY_STORE =
  "https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter";

function aplicarTamanoPaginaOrden(
  formato: Formato,
  ticketElement: HTMLElement | null
): void {
  if (typeof document === "undefined") return;

  let estilo = document.getElementById("page-size-orden") as HTMLStyleElement | null;
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "page-size-orden";
    document.head.appendChild(estilo);
  }

  if (formato === "ticket" && ticketElement) {
    const altoMm = Math.ceil(ticketElement.scrollHeight * PX_A_MM) + COLCHON_TICKET_MM;
    estilo.textContent = `@media print { @page { size: 80mm ${altoMm}mm; margin: 0; } }`;
  } else if (formato === "a4") {
    estilo.textContent = "@media print { @page { size: A4; margin: 1cm; } }";
  } else {
    estilo.textContent = "@media print { @page { margin: 0; } }";
  }

  window.addEventListener(
    "afterprint",
    () => {
      const e = document.getElementById("page-size-orden");
      if (e) e.textContent = "";
    },
    { once: true }
  );
}

function formatearCantidad(cantidad: number): string {
  return Number.isInteger(cantidad)
    ? String(cantidad)
    : cantidad.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function limpiarTexto(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}

function cortarLinea(texto: string, ancho: number): string[] {
  const palabras = limpiarTexto(texto).split(" ").filter(Boolean);
  const lineas: string[] = [];
  let actual = "";

  for (const palabra of palabras) {
    if (!actual) {
      actual = palabra;
    } else if (`${actual} ${palabra}`.length <= ancho) {
      actual += ` ${palabra}`;
    } else {
      lineas.push(actual);
      actual = palabra;
    }

    while (actual.length > ancho) {
      lineas.push(actual.slice(0, ancho));
      actual = actual.slice(ancho);
    }
  }

  if (actual) lineas.push(actual);
  return lineas.length > 0 ? lineas : [""];
}

function centrar(texto: string, ancho: number): string {
  const limpio = limpiarTexto(texto);
  if (limpio.length >= ancho) return limpio.slice(0, ancho);
  const izquierda = Math.floor((ancho - limpio.length) / 2);
  return `${" ".repeat(izquierda)}${limpio}`;
}

function lineaDato(label: string, value: string, ancho: number): string[] {
  if (!value) return [];
  return cortarLinea(`${label}: ${value}`, ancho);
}

function construirTicketTexto(props: Props, incluirPrecios: boolean): string {
  const ancho = 42;
  const separador = "-".repeat(ancho);
  const lineas: string[] = [
    centrar(props.empresa, ancho),
    centrar("ORDEN DE PEDIDO", ancho),
    centrar(`Nro ${props.numero}`, ancho),
    centrar(props.fecha, ancho),
    separador,
    ...lineaDato("Cliente", props.cliente, ancho),
    ...lineaDato("Razon social", props.razonSocial, ancho),
    ...lineaDato("RUC/DNI", props.rucDni, ancho),
    ...lineaDato("WhatsApp", props.whatsapp, ancho),
    ...lineaDato("Direccion", props.direccion, ancho),
    ...lineaDato("Distrito", props.distrito, ancho),
    ...lineaDato("Asesor", props.asesor, ancho),
    separador,
    incluirPrecios ? "Cant.        Importe" : "Cant. Producto",
  ];

  props.items.forEach((item) => {
    const cantidad = `${formatearCantidad(item.cantidad)} ${item.unidad}`.trim();
    if (incluirPrecios) {
      const importe = item.subtotal > 0 ? item.subtotal.toFixed(2) : "-";
      lineas.push(`${cantidad.padEnd(13).slice(0, 13)}${importe.padStart(12)}`);
      cortarLinea(item.producto, ancho).forEach((linea) => lineas.push(linea));
    } else {
      cortarLinea(`${cantidad} ${item.producto}`, ancho).forEach((linea) =>
        lineas.push(linea)
      );
    }
  });

  if (incluirPrecios) {
    lineas.push(separador);
    lineas.push(`TOTAL S/ ${props.total.toFixed(2)}`.padStart(ancho));
  }

  if (props.notas) {
    lineas.push(separador);
    lineas.push(...lineaDato("Notas", props.notas, ancho));
  }

  lineas.push(
    "",
    "",
    "______________________________",
    centrar("Firma del cliente", ancho),
    centrar("Recibi conforme", ancho),
    "",
    "",
    ""
  );

  return lineas.join("\n");
}

function abrirRawBt(texto: string): void {
  const fallback = encodeURIComponent(RAWBT_PLAY_STORE);
  const payload = encodeURIComponent(texto);
  window.location.href = `intent:${payload}#Intent;scheme=rawbt;package=${RAWBT_PACKAGE};S.browser_fallback_url=${fallback};end;`;
}

export default function GuiaImprimibleClient(props: Props) {
  // El botón "Compartir" depende del navegador (navigator.share), que no existe
  // en el servidor. Lo mostramos solo tras montar en el cliente para evitar el
  // desajuste de hidratación (server HTML ≠ client HTML).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Por defecto TICKET (lo más común: el motorizado/almacén imprime en ticketera).
  const [formato, setFormato] = useState<Formato>("ticket");
  // Cada cliente maneja precios distintos → el usuario decide si la orden muestra
  // precios o solo cantidades. Por defecto los incluye.
  const [incluirPrecios, setIncluirPrecios] = useState(true);
  const ticketRef = useRef<HTMLDivElement>(null);
  const puedeCompartir =
    mounted && typeof navigator !== "undefined" && "share" in navigator;

  const esTicket = formato === "ticket";
  const imprimirNavegador = () => {
    aplicarTamanoPaginaOrden(formato, ticketRef.current);
    window.setTimeout(() => window.print(), 50);
  };
  const imprimirBluetooth = () => {
    abrirRawBt(construirTicketTexto(props, incluirPrecios));
  };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barra de acciones (no se imprime) */}
      <div className="print:hidden bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-500">Orden de Pedido</div>
            <div className="font-bold text-gray-800">N° {props.numero}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Formato: Ticket (default) | A4 */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm font-medium">
              <button
                onClick={() => setFormato("ticket")}
                className={`px-3 py-2 transition-colors active:scale-[0.98] ${
                  esTicket
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Ticket
              </button>
              <button
                onClick={() => setFormato("a4")}
                className={`px-3 py-2 transition-colors active:scale-[0.98] border-l border-gray-200 ${
                  !esTicket
                    ? "bg-gray-900 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                A4
              </button>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors active:scale-[0.98]">
              <input
                type="checkbox"
                checked={incluirPrecios}
                onChange={(e) => setIncluirPrecios(e.target.checked)}
                className="h-4 w-4 accent-red-600"
              />
              Precios
            </label>

            <button
              onClick={imprimirNavegador}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 flex items-center gap-2 transition-transform active:scale-[0.98]"
            >
              <FiPrinter />
              Imprimir
            </button>
            {esTicket ? (
              <button
                onClick={imprimirBluetooth}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 flex items-center gap-2 transition-transform active:scale-[0.98]"
                title="Imprimir con RawBT en Android"
              >
                <FiBluetooth />
                Bluetooth
              </button>
            ) : null}
            {puedeCompartir ? (
              <button
                onClick={async () => {
                  try {
                    await navigator.share({
                      title: `Orden de pedido ${props.numero} - ${props.cliente}`,
                      url: window.location.href,
                    });
                  } catch {
                    /* user canceled */
                  }
                }}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 flex items-center gap-2 transition-transform active:scale-[0.98]"
              >
                <FiShare2 />
                Compartir
              </button>
            ) : null}
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-2 text-xs text-gray-500">
          {esTicket ? (
            <>
              En celular con ticketera Bluetooth usa <strong>Bluetooth</strong>.
              En PC o para PDF usa <strong>Imprimir</strong>.
            </>
          ) : (
            <>
              Formato <strong>A4</strong>. En el diálogo elige{" "}
              <strong>&quot;Guardar como PDF&quot;</strong> para enviarlo por WhatsApp.
            </>
          )}
        </div>
      </div>

      {/* Documento imprimible */}
      {esTicket ? (
        <div className="flex justify-center py-6 print:py-0 print:block">
          <TicketLayout
            {...props}
            incluirPrecios={incluirPrecios}
            referencia={ticketRef}
          />
        </div>
      ) : (
        <div className="max-w-4xl mx-auto p-4 sm:p-8 print:p-0">
          <A4Layout {...props} incluirPrecios={incluirPrecios} />
        </div>
      )}

      {/* Estilos de impresión — el TAMAÑO de página depende del formato elegido. */}
      <style jsx global>{`
        @media print {
          @page {
            ${esTicket ? "" : "size: A4;"}
            margin: ${esTicket ? "0" : "1cm"};
          }
          body {
            background: white;
          }
          .orden-ticket {
            box-shadow: none !important;
          }
          /* Conservar el color del logo al imprimir / guardar como PDF. */
          img {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}

// ── Formato TICKET (80mm térmico): monocromo, compacto, una columna ──
function TicketLayout({
  numero,
  empresa,
  cliente,
  razonSocial,
  rucDni,
  direccion,
  distrito,
  whatsapp,
  fecha,
  asesor,
  notas,
  items,
  total,
  incluirPrecios,
  referencia,
}: Props & { incluirPrecios: boolean; referencia?: RefObject<HTMLDivElement | null> }) {
  const esTransavic = empresa === "Transavic";
  const logo = esTransavic ? "/transavic.jpg" : "/avicola.jpg";
  const linea = "border-t border-dashed border-gray-500 my-2";
  return (
    <div
      ref={referencia}
      className="orden-ticket bg-white text-black shadow-lg print:shadow-none"
      style={{ width: "80mm" }}
    >
      <div className="px-3 py-3" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        {/* Encabezado: logo a color + datos del emisor (como un ticket real).
            El JPG de Transavic trae aire arriba/abajo dentro del cuadrado 600×600;
            lo recortamos con un contenedor más bajo (aspect 3/2) + object-cover,
            sin cortar el arte. El de Avícola llena el cuadrado → se muestra entero. */}
        <div className="text-center leading-tight">
          <div
            className="mx-auto overflow-hidden"
            style={{
              width: esTransavic ? "72%" : "56%",
              aspectRatio: esTransavic ? "3 / 2" : "1 / 1",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logo}
              alt={empresa}
              className="h-full w-full object-cover object-center"
            />
          </div>
        </div>

        <div className={linea} />

        {/* Tipo de documento — tamaños alineados al REPORTE del día (la asesora
            reportó que el ticket salía con letra muy pequeña en la ticketera) */}
        <div className="text-center leading-tight">
          <div className="text-[16px] font-bold">ORDEN DE PEDIDO</div>
          <div className="text-[18px] font-extrabold">N° {numero}</div>
          <div className="text-[12px]">{fecha}</div>
        </div>

        <div className={linea} />

        {/* Datos del cliente */}
        <div className="text-[14px] leading-snug space-y-0.5">
          <TicketRow label="Cliente" value={cliente} />
          {razonSocial && <TicketRow label="Razón social" value={razonSocial} />}
          {rucDni && <TicketRow label="RUC/DNI" value={rucDni} />}
          {whatsapp && <TicketRow label="WhatsApp" value={whatsapp} />}
          {direccion && <TicketRow label="Dirección" value={direccion} />}
          {distrito && <TicketRow label="Distrito" value={distrito} />}
          {asesor && <TicketRow label="Asesor" value={asesor} />}
        </div>

        <div className={linea} />

        {/* Ítems — en ticket mostramos Cant · Producto · Importe (sin P. Unit. por el ancho) */}
        <div className="text-[14px]">
          <div className="flex font-bold border-b border-black pb-1 mb-1">
            <span className="w-14 flex-shrink-0">Cant.</span>
            <span className="flex-1">Producto</span>
            {incluirPrecios && <span className="w-16 text-right">Importe</span>}
          </div>
          {items.map((it, i) => (
            <div key={i} className="flex py-0.5 leading-snug">
              <span className="w-14 flex-shrink-0 font-mono">
                {it.cantidad}
                {it.unidad ? ` ${it.unidad}` : ""}
              </span>
              <span className="flex-1 break-words pr-1">{it.producto}</span>
              {incluirPrecios && (
                <span className="w-16 text-right font-mono">
                  {it.subtotal > 0 ? it.subtotal.toFixed(2) : "—"}
                </span>
              )}
            </div>
          ))}
        </div>

        {incluirPrecios && (
          <>
            <div className={linea} />
            <div className="flex justify-between items-baseline font-extrabold text-[18px]">
              <span>TOTAL</span>
              <span className="font-mono">S/ {total.toFixed(2)}</span>
            </div>
          </>
        )}

        {notas && (
          <>
            <div className={linea} />
            <div className="text-[14px]">
              <span className="font-bold">Notas: </span>
              <span className="whitespace-pre-wrap break-words">{notas}</span>
            </div>
          </>
        )}

        {/* Firma del cliente */}
        <div className="mt-12 text-center text-[14px]">
          <div className="border-t border-black mx-3 pt-1">
            <div className="font-semibold">Firma del cliente</div>
            <div className="text-[11px]">Recibí conforme</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="break-words">
      <span className="font-bold">{label}: </span>
      <span>{value}</span>
    </div>
  );
}

// ── Formato A4: el documento completo (logo, tabla, acentos de marca) ──
function A4Layout({
  numero,
  empresa,
  cliente,
  razonSocial,
  rucDni,
  direccion,
  distrito,
  whatsapp,
  fecha,
  asesor,
  notas,
  items,
  total,
  incluirPrecios,
}: Props & { incluirPrecios: boolean }) {
  return (
    <div className="bg-white print:bg-transparent shadow-lg print:shadow-none rounded-lg print:rounded-none p-6 sm:p-10 print:p-6">
      {/* Header */}
      <div className="flex items-start justify-between border-b-2 border-red-700 pb-4 mb-6">
        <div className="flex items-center">
          {/* Logo real de la marca (el mismo de /dashboard/nuevo-pedido) */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={empresa === "Transavic" ? "/transavic.jpg" : "/avicola.jpg"}
            alt={empresa}
            className="h-20 w-auto max-w-[230px] object-contain"
          />
        </div>
        <div className="text-right">
          <div className="border-2 border-red-700 rounded px-3 py-1.5 text-xs font-bold text-red-700">
            ORDEN DE PEDIDO
          </div>
          <div className="mt-2 text-2xl font-bold text-red-700">N° {numero}</div>
          <div className="text-xs text-gray-500 mt-1">{fecha}</div>
        </div>
      </div>

      {/* Datos del cliente */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-sm">
        <Field label="Señor(a)" value={cliente} />
        {razonSocial && <Field label="Razón Social" value={razonSocial} />}
        {rucDni && <Field label="RUC / DNI" value={rucDni} />}
        {whatsapp && <Field label="WhatsApp" value={whatsapp} />}
        <Field label="Dirección" value={direccion} className="sm:col-span-2" />
        {distrito && <Field label="Distrito" value={distrito} />}
        {asesor && <Field label="Asesor" value={asesor} />}
      </div>

      {/* Tabla de productos */}
      <table className="w-full border border-gray-300 text-sm mb-4">
        <thead className="bg-red-700 text-white">
          <tr>
            <th className="p-2 text-left">Cant.</th>
            <th className="p-2 text-left">Producto</th>
            {incluirPrecios && <th className="p-2 text-right">P. Unit.</th>}
            {incluirPrecios && <th className="p-2 text-right">Importe</th>}
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t border-gray-200">
              <td className="p-2 font-mono">
                {it.cantidad} {it.unidad}
              </td>
              <td className="p-2">{it.producto}</td>
              {incluirPrecios && (
                <td className="p-2 text-right font-mono">
                  {it.precio > 0 ? `S/ ${it.precio.toFixed(2)}` : "—"}
                </td>
              )}
              {incluirPrecios && (
                <td className="p-2 text-right font-mono font-semibold">
                  {it.subtotal > 0 ? `S/ ${it.subtotal.toFixed(2)}` : "—"}
                </td>
              )}
            </tr>
          ))}
          {/* Filas vacías para que la orden se vea ordenada aunque tenga pocos ítems */}
          {Array.from({ length: Math.max(0, 6 - items.length) }).map((_, i) => (
            <tr key={`empty-${i}`} className="border-t border-gray-200">
              {Array.from({ length: incluirPrecios ? 4 : 2 }).map((__, j) => (
                <td key={j} className="p-2">
                  &nbsp;
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {incluirPrecios && (
          <tfoot>
            <tr className="bg-gray-100 border-t-2 border-red-700">
              <td colSpan={3} className="p-2 text-right font-bold">
                TOTAL S/
              </td>
              <td className="p-2 text-right font-bold text-lg text-red-700">
                {total.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>

      {notas && (
        <div className="mb-6 text-sm">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Notas</div>
          <div className="bg-yellow-50 border-l-4 border-yellow-400 px-3 py-2 text-gray-700">
            {notas}
          </div>
        </div>
      )}

      {/* Firma del cliente (un solo espacio: confirma la recepción) */}
      <div className="mt-16 pt-4 flex justify-center">
        <div className="text-center w-72 max-w-full">
          <div className="border-t border-gray-800 pt-2">
            <div className="text-xs text-gray-600 uppercase tracking-wide">
              Firma del cliente
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">Recibí conforme</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="font-medium text-gray-800 mt-0.5">{value}</div>
    </div>
  );
}
