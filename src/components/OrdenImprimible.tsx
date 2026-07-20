// src/components/OrdenImprimible.tsx
// Componente de impresión unificado y escalable para las 3 operaciones de venta:
//   1. Asesoras (Pedidos)
//   2. Producción (Pesos reales de pedidos)
//   3. Campo (Guías de Venta del módulo Clientes Avícola)
//
// Soporta formatos Ticket (80mm) y A4, toggle de precios (oculta todo rastro financiero),
// impresión Bluetooth nativa con RawBT y un solo bloque de firma unificada ("Firma del cliente / Recibí conforme").
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FiBluetooth, FiPrinter, FiShare2 } from "react-icons/fi";

export interface ItemOrden {
  producto: string;
  cantidad: number;
  unidad: string;
  precio?: number;
  subtotal?: number;
}

export interface EstadoCuentaOrden {
  saldoPrevio: number;
  totalVenta: number;
  abonosAplicados: number;
  saldoActualizado: number;
}

export interface OrdenImprimibleProps {
  tipoDocumento: "Orden de Pedido" | "Guía de Venta";
  numero: string;
  fecha: string;
  empresa: string;
  clienteNombre: string;
  clienteDetalle?: string;
  clienteDireccion?: string;
  clienteDistrito?: string;
  clienteTelefono?: string;
  clienteWhatsapp?: string;
  asesorNombre?: string;
  notas?: string;
  items: ItemOrden[];
  total: number;
  anulada?: boolean;
  estadoCuenta?: EstadoCuentaOrden;
}

type Formato = "ticket" | "a4";

const PX_A_MM = 25.4 / 96;
const COLCHON_TICKET_MM = 6;
const RAWBT_PACKAGE = "ru.a402d.rawbtprinter";
const RAWBT_PLAY_STORE =
  "https://play.google.com/store/apps/details?id=ru.a402d.rawbtprinter";

const formatoMonto = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function soles(monto: number): string {
  return `S/ ${formatoMonto.format(monto)}`;
}

function kilos(peso: number): string {
  return formatoMonto.format(peso);
}

function fechaLegible(fecha: string): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;
  const texto = new Date(anio, mes - 1, dia).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

function aplicarTamanoPagina(
  formato: Formato,
  ticketElement: HTMLElement | null
): void {
  if (typeof document === "undefined") return;

  let estilo = document.getElementById("page-size-orden-unificada") as HTMLStyleElement | null;
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "page-size-orden-unificada";
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
      const e = document.getElementById("page-size-orden-unificada");
      if (e) e.textContent = "";
    },
    { once: true }
  );
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

function construirTextoPlanoTicket(props: OrdenImprimibleProps, incluirPrecios: boolean): string {
  const ancho = 42;
  const separador = "-".repeat(ancho);

  const lineas: string[] = [
    centrar(props.empresa, ancho),
    centrar(props.tipoDocumento.toUpperCase(), ancho),
    centrar(`Nro ${props.numero}`, ancho),
    centrar(props.fecha, ancho),
    separador,
    ...lineaDato("Cliente", props.clienteNombre, ancho),
  ];

  if (props.clienteDetalle) lineas.push(...lineaDato("Detalle", props.clienteDetalle, ancho));
  if (props.clienteDireccion) lineas.push(...lineaDato("Dirección", props.clienteDireccion, ancho));
  if (props.clienteDistrito) lineas.push(...lineaDato("Distrito", props.clienteDistrito, ancho));
  if (props.clienteTelefono) lineas.push(...lineaDato("Teléfono", props.clienteTelefono, ancho));
  if (props.clienteWhatsapp) lineas.push(...lineaDato("WhatsApp", props.clienteWhatsapp, ancho));
  if (props.asesorNombre) lineas.push(...lineaDato("Asesor", props.asesorNombre, ancho));

  lineas.push(separador);

  if (incluirPrecios) {
    lineas.push("Cant.        Producto              Importe");
    props.items.forEach((item) => {
      const cantStr = `${kilos(item.cantidad)} ${item.unidad}`.trim();
      const importeStr = item.subtotal != null && item.subtotal > 0 ? item.subtotal.toFixed(2) : "—";
      
      lineas.push(`${cantStr.padEnd(12).slice(0, 12)}${item.producto.padEnd(18).slice(0, 18)}${importeStr.padStart(12)}`);
      if (item.producto.length > 18) {
        cortarLinea(item.producto, ancho).forEach((linea) => lineas.push(linea));
      }
    });

    lineas.push(separador);
    lineas.push(`TOTAL S/ ${props.total.toFixed(2)}`.padStart(ancho));


  } else {
    lineas.push("Cant.        Producto");
    props.items.forEach((item) => {
      const cantStr = `${kilos(item.cantidad)} ${item.unidad}`.trim();
      cortarLinea(`${cantStr.padEnd(12).slice(0, 12)} ${item.producto}`, ancho).forEach((linea) =>
        lineas.push(linea)
      );
    });
  }

  if (props.notas) {
    lineas.push(separador, ...lineaDato("Notas", props.notas, ancho));
  }

  lineas.push(
    "",
    "",
    "______________________________",
    centrar("Firma del cliente", ancho),
    centrar("Recibí conforme", ancho),
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

export default function OrdenImprimible(props: OrdenImprimibleProps) {
  const [mounted, setMounted] = useState(false);
  const [formato, setFormato] = useState<Formato>("ticket");
  const [incluirPrecios, setIncluirPrecios] = useState(true);
  const ticketRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const puedeCompartir =
    mounted && typeof navigator !== "undefined" && "share" in navigator;

  const esTicket = formato === "ticket";

  const imprimirNavegador = () => {
    aplicarTamanoPagina(formato, ticketRef.current);
    window.setTimeout(() => window.print(), 50);
  };

  const imprimirBluetooth = () => {
    imprimirNavegador();
    // Enviar a RawBT en Android
    abrirRawBt(construirTextoPlanoTicket(props, incluirPrecios));
  };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white text-black">
      {/* Barra de herramientas superior (se oculta al imprimir) */}
      <div className="print:hidden bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-500">{props.tipoDocumento}</div>
            <div className="font-bold text-gray-800">N° {props.numero}</div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Formato: Ticket vs A4 */}
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

            {/* Toggle de Precios */}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50 transition-colors active:scale-[0.98]">
              <input
                type="checkbox"
                checked={incluirPrecios}
                onChange={(e) => setIncluirPrecios(e.target.checked)}
                className="h-4 w-4 accent-amber-600"
              />
              Precios
            </label>

            {/* Botón Imprimir */}
            <button
              onClick={imprimirNavegador}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 flex items-center gap-2 transition-transform active:scale-[0.98]"
            >
              <FiPrinter />
              Imprimir
            </button>

            {/* Botón Bluetooth */}
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

            {/* Compartir Enlace */}
            {puedeCompartir ? (
              <button
                onClick={async () => {
                  try {
                    await navigator.share({
                      title: `${props.tipoDocumento} ${props.numero} - ${props.clienteNombre}`,
                      url: window.location.href,
                    });
                  } catch {
                    /* cancelado por el usuario */
                  }
                }}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 flex items-center gap-2 transition-transform active:scale-[0.98]"
              >
                <FiShare2 />
                Compartir Enlace
              </button>
            ) : null}
          </div>
        </div>

        <div className="max-w-4xl mx-auto px-4 pb-2 text-xs text-gray-500">
          {esTicket ? (
            <>
              Impresión en formato <strong>Ticket (80mm)</strong>. En celular Android usa <strong>Bluetooth (RawBT)</strong>. En PC/PDF usa <strong>Imprimir</strong>.
            </>
          ) : (
            <>
              Impresión en formato <strong>A4</strong>. En el diálogo del navegador selecciona <strong>&quot;Guardar como PDF&quot;</strong> para archivarlo o enviarlo.
            </>
          )}
        </div>
      </div>

      {/* Layout de Impresión */}
      {esTicket ? (
        <div className="flex justify-center py-6 print:py-0 print:block">
          <TicketLayout
            props={props}
            incluirPrecios={incluirPrecios}
            referencia={ticketRef}
          />
        </div>
      ) : (
        <div className="max-w-4xl mx-auto p-4 sm:p-8 print:p-0">
          <A4Layout props={props} incluirPrecios={incluirPrecios} />
        </div>
      )}

      {/* Estilos globales de impresión */}
      <style jsx global>{`
        @media print {
          @page {
            ${esTicket ? "" : "size: A4;"}
            margin: ${esTicket ? "0" : "1cm"};
          }
          body {
            background: white;
          }
          .orden-ticket-unificado {
            box-shadow: none !important;
            border: none !important;
          }
          img {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  );
}

// ── Layout Formato TICKET (80mm térmico) ──
function TicketLayout({
  props,
  incluirPrecios,
  referencia,
}: {
  props: OrdenImprimibleProps;
  incluirPrecios: boolean;
  referencia?: RefObject<HTMLDivElement | null>;
}) {
  const esTransavic = props.empresa === "Transavic";
  const logo = esTransavic ? "/transavic.jpg" : "/avicola.jpg";
  const linea = "border-t border-dashed border-black my-3";

  return (
    <div
      ref={referencia}
      className="orden-ticket-unificado bg-white text-black shadow-lg border border-gray-200 rounded print:border-none print:shadow-none"
      style={{ width: "80mm" }}
    >
      <div className="px-4 py-4" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        {/* Encabezado: Logo */}
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
              alt={props.empresa}
              className="h-full w-full object-cover object-center"
            />
          </div>
          <p className="text-sm font-bold uppercase tracking-wider mt-1">
            {props.empresa}
          </p>
        </div>

        <div className={linea} />

        {/* Tipo de Documento y Números */}
        <div className="text-center leading-tight">
          <div className="text-[20px] font-bold uppercase tracking-wide">{props.tipoDocumento}</div>
          <div className="text-[24px] font-black">N° {props.numero}</div>
          <div className="text-[14px] font-semibold mt-0.5">{fechaLegible(props.fecha)}</div>
        </div>

        <div className={linea} />

        {/* Datos del Cliente */}
        <div className="text-[16px] leading-snug space-y-1.5">
          <TicketRow label="Cliente" value={props.clienteNombre} />
          {props.clienteDetalle && <TicketRow label="Detalle" value={props.clienteDetalle} />}
          {props.clienteDireccion && <TicketRow label="Dirección" value={props.clienteDireccion} />}
          {props.clienteDistrito && <TicketRow label="Distrito" value={props.clienteDistrito} />}
          {props.clienteTelefono && <TicketRow label="Teléfono" value={props.clienteTelefono} />}
          {props.clienteWhatsapp && <TicketRow label="WhatsApp" value={props.clienteWhatsapp} />}
          {props.asesorNombre && <TicketRow label="Asesor" value={props.asesorNombre} />}
        </div>

        <div className={linea} />

        {/* Anulada */}
        {props.anulada && (
          <div className="border-4 border-red-600 text-red-600 font-bold text-center py-1.5 text-base tracking-widest my-3">
            ANULADA / CANCELADA
          </div>
        )}

        {/* Tabla de Productos */}
        <div className="text-[16px]">
          <div className="flex font-bold border-b border-black pb-1.5 mb-1.5">
            <span className="w-24 flex-shrink-0">Cant.</span>
            <span className="flex-1">Producto</span>
            {incluirPrecios && <span className="w-20 text-right">Importe</span>}
          </div>
          {props.items.map((it, i) => (
            <div key={i} className="flex py-1 leading-snug border-b border-gray-100 last:border-0 align-top">
              <span className="w-24 flex-shrink-0 font-mono font-bold">
                {kilos(it.cantidad)}
                {it.unidad ? ` ${it.unidad}` : ""}
              </span>
              <span className="flex-1 break-words pr-1 font-bold text-gray-900">{it.producto}</span>
              {incluirPrecios && (
                <span className="w-20 text-right font-mono font-bold">
                  {it.subtotal != null && it.subtotal > 0 ? it.subtotal.toFixed(2) : "—"}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Total General */}
        {incluirPrecios && (
          <>
            <div className={linea} />
            <div className="flex justify-between items-baseline font-black text-[22px]">
              <span>TOTAL</span>
              <span className="font-mono">S/ {props.total.toFixed(2)}</span>
            </div>
          </>
        )}



        {/* Notas / Observaciones */}
        {props.notas && (
          <>
            <div className={linea} />
            <div className="text-[16px] bg-yellow-50/50 p-2.5 rounded border border-gray-200">
              <span className="font-bold">Notas: </span>
              <span className="whitespace-pre-wrap break-words font-bold text-gray-900">{props.notas}</span>
            </div>
          </>
        )}

        {/* Firma Única del Cliente / Recibí conforme */}
        <div className="mt-14 text-center text-[16px]">
          <div className="border-t border-black mx-3 pt-2">
            <div className="font-bold text-gray-800">Firma del cliente</div>
            <div className="text-[13px] text-gray-500 font-medium">Recibí conforme</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Layout Formato A4 ──
function A4Layout({
  props,
  incluirPrecios,
}: {
  props: OrdenImprimibleProps;
  incluirPrecios: boolean;
}) {
  const esTransavic = props.empresa === "Transavic";
  const logo = esTransavic ? "/transavic.jpg" : "/avicola.jpg";

  return (
    <div className="bg-white p-10 border border-gray-200 rounded-2xl shadow-sm print:border-none print:shadow-none min-h-[297mm]">
      {/* Cabecera A4 */}
      <div className="flex justify-between items-start border-b-2 border-gray-100 pb-6">
        <div>
          <h1 className="text-3xl font-black text-amber-600 tracking-tight uppercase">
            {props.tipoDocumento}
          </h1>
          <p className="text-lg font-bold text-gray-500 mt-1">
            N.º {props.numero}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">{fechaLegible(props.fecha)}</p>
        </div>

        <div className="text-right">
          <div className="h-16 w-auto flex justify-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt={props.empresa} className="h-full object-contain" />
          </div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
            {props.empresa}
          </p>
        </div>
      </div>

      {/* Datos Cliente y Metadatos */}
      <div className="grid grid-cols-2 gap-8 py-6 border-b border-gray-100">
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
            Cliente
          </h2>
          <p className="text-lg font-bold text-gray-900">{props.clienteNombre}</p>
          
          <div className="text-sm text-gray-600 space-y-0.5 mt-1.5">
            {props.clienteDetalle && <p>{props.clienteDetalle}</p>}
            {props.clienteDireccion && <p>Dirección: {props.clienteDireccion}</p>}
            {props.clienteDistrito && <p>Distrito: {props.clienteDistrito}</p>}
          </div>
        </div>

        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
            Información del Pedido
          </h2>
          <div className="text-sm text-gray-700 space-y-1 mt-1.5">
            {props.clienteTelefono && <p><span className="font-bold text-gray-500">Teléfono:</span> {props.clienteTelefono}</p>}
            {props.clienteWhatsapp && <p><span className="font-bold text-gray-500">WhatsApp:</span> {props.clienteWhatsapp}</p>}
            {props.asesorNombre && <p><span className="font-bold text-gray-500">Asesor:</span> {props.asesorNombre}</p>}
          </div>
        </div>
      </div>

      {/* Anulada */}
      {props.anulada && (
        <div className="border-4 border-red-600 text-red-600 font-black text-center py-2.5 text-xl tracking-widest my-5">
          ANULADA / CANCELADA
        </div>
      )}

      {/* Tabla de Productos */}
      <table className="w-full mt-6 text-sm text-left">
        <thead>
          <tr className="border-b-2 border-gray-200 font-bold text-gray-500">
            <th className="py-3">Producto</th>
            <th className="py-3 text-right">Peso/Cant.</th>
            {incluirPrecios && (
              <>
                <th className="py-3 text-right">Precio/kg</th>
                <th className="py-3 text-right">Importe</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {props.items.map((item, i) => (
            <tr key={i} className="align-middle">
              <td className="py-4 font-semibold text-gray-900">{item.producto}</td>
              <td className="py-4 text-right font-bold text-gray-900">
                {kilos(item.cantidad)}
                {item.unidad ? ` ${item.unidad}` : ""}
              </td>
              {incluirPrecios && (
                <>
                  <td className="py-4 text-right">{item.precio ? soles(item.precio) : "—"}</td>
                  <td className="py-4 text-right font-black text-gray-900">
                    {item.subtotal ? soles(item.subtotal) : "—"}
                  </td>
                </>
              )}
            </tr>
          ))}

          {/* Fila Total */}
          {incluirPrecios && (
            <tr className="font-bold text-base">
              <td className="py-4" colSpan={3}>
                TOTAL
              </td>
              <td className="py-4 text-right text-lg text-amber-600">{soles(props.total)}</td>
            </tr>
          )}
        </tbody>
      </table>



      {/* Notas / Observaciones */}
      {props.notas && (
        <div className="mt-8 text-sm bg-gray-50 rounded-xl p-4 border border-gray-100">
          <span className="font-bold text-gray-700">Notas / Observaciones:</span>
          <p className="text-gray-600 mt-1 whitespace-pre-wrap">{props.notas}</p>
        </div>
      )}

      {/* Firma Única del Cliente / Recibí conforme */}
      <div className="mt-28 border-t border-gray-100 pt-8 flex justify-center">
        <div className="text-center w-72 max-w-full">
          <div className="border-t border-gray-800 pt-2.5">
            <div className="text-xs text-gray-600 uppercase tracking-wider font-bold">
              Firma del cliente
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5 font-medium">Recibí conforme</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TicketRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="break-words">
      <span className="font-bold text-gray-500 text-[14px] uppercase tracking-wide">{label}: </span>
      <span className="font-bold text-gray-900">{value}</span>
    </div>
  );
}


