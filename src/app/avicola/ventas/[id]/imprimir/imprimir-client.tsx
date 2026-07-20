// src/app/avicola/ventas/[id]/imprimir/imprimir-client.tsx
// Componente cliente: render de la "Guía de Venta de Campo" para impresión en navegador (PC/A4)
// y envío por RawBT en Android (ticketera térmica Bluetooth).
"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { FiBluetooth, FiPrinter, FiShare2 } from "react-icons/fi";
import type { GuiaAvicolaData } from "@/lib/avicola/types";
import { formatNumeroGuia } from "@/lib/correlativos";

interface Props {
  data: GuiaAvicolaData;
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

function aplicarTamanoPaginaGuia(
  formato: Formato,
  ticketElement: HTMLElement | null
): void {
  if (typeof document === "undefined") return;

  let estilo = document.getElementById("page-size-guia") as HTMLStyleElement | null;
  if (!estilo) {
    estilo = document.createElement("style");
    estilo.id = "page-size-guia";
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
      const e = document.getElementById("page-size-guia");
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

function construirTicketCampoTexto(props: GuiaAvicolaData, incluirPrecios: boolean): string {
  const ancho = 42;
  const separador = "-".repeat(ancho);
  const numeroFormateado = formatNumeroGuia(props.numero_guia);

  const lineas: string[] = [
    centrar(props.cliente.empresa, ancho),
    centrar("GUIA DE VENTA", ancho),
    centrar(`Nro ${numeroFormateado}`, ancho),
    centrar(fechaLegible(props.fecha), ancho),
    separador,
    ...lineaDato("Cliente", props.cliente.nombre, ancho),
    ...lineaDato("Mercado", props.cliente.mercado, ancho),
  ];

  if (props.cliente.numero_puesto) {
    lineas.push(...lineaDato("Puesto", props.cliente.numero_puesto, ancho));
  }
  if (props.cliente.telefono) {
    lineas.push(...lineaDato("Telefono", props.cliente.telefono, ancho));
  }

  lineas.push(separador);

  if (incluirPrecios) {
    lineas.push("Cant/Peso          Precio      Importe");
    props.items.forEach((item) => {
      const prodLineas = cortarLinea(item.producto_nombre, ancho);
      const pesoStr = `${kilos(item.peso_kg)} kg`;
      const precioStr = soles(item.precio_kg);
      const subtotalStr = soles(item.subtotal);

      prodLineas.forEach((l) => lineas.push(l));
      lineas.push(`${pesoStr.padEnd(16).slice(0, 16)}${precioStr.padEnd(12).slice(0, 12)}${subtotalStr.padStart(14)}`);
    });

    lineas.push(separador);
    lineas.push(`TOTAL S/ ${props.total.toFixed(2)}`.padStart(ancho));

    // Estado de cuenta
    lineas.push(
      separador,
      centrar("ESTADO DE CUENTA", ancho),
      `Saldo anterior: ${soles(props.estado_cuenta.saldo_previo)}`.padStart(ancho),
      `Venta de hoy:   ${soles(props.estado_cuenta.total_venta)}`.padStart(ancho)
    );
    if (props.estado_cuenta.abonos_aplicados > 0) {
      lineas.push(`Abonos:        −${soles(props.estado_cuenta.abonos_aplicados)}`.padStart(ancho));
    }
    lineas.push(
      "-".repeat(ancho),
      `SALDO ACTUAL:   ${soles(props.estado_cuenta.saldo_actualizado)}`.padStart(ancho)
    );
  } else {
    lineas.push("Producto                     Cant/Peso");
    props.items.forEach((item) => {
      const prodLineas = cortarLinea(item.producto_nombre, 26);
      const pesoStr = `${kilos(item.peso_kg)} kg`.padStart(16);

      if (prodLineas.length > 0) {
        lineas.push(`${prodLineas[0].padEnd(26).slice(0, 26)}${pesoStr}`);
        for (let i = 1; i < prodLineas.length; i++) {
          lineas.push(prodLineas[i]);
        }
      }
    });
  }

  if (props.observaciones) {
    lineas.push(separador, ...lineaDato("Obs", props.observaciones, ancho));
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

export default function VentaImprimibleClient({ data }: Props) {
  const [mounted, setMounted] = useState(false);
  const [formato, setFormato] = useState<Formato>("ticket");
  const [incluirPrecios, setIncluirPrecios] = useState(true);
  const ticketRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  const puedeCompartir =
    mounted && typeof navigator !== "undefined" && "share" in navigator;

  const esTicket = formato === "ticket";

  const imprimirNavegador = () => {
    aplicarTamanoPaginaGuia(formato, ticketRef.current);
    window.setTimeout(() => window.print(), 50);
  };

  const imprimirBluetooth = () => {
    abrirRawBt(construirTicketCampoTexto(data, incluirPrecios));
  };

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white text-black">
      {/* Barra de herramientas superior (oculta al imprimir) */}
      <div className="print:hidden bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-gray-500">Guía de Venta (Campo)</div>
            <div className="font-bold text-gray-800">N.° {formatNumeroGuia(data.numero_guia)}</div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Alternador de Formato: Ticket vs A4 */}
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

            {/* Botones de acción */}
            <button
              onClick={imprimirNavegador}
              className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700 flex items-center gap-2 transition-transform active:scale-[0.98]"
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
                      title: `Guía de venta ${formatNumeroGuia(data.numero_guia)} - ${data.cliente.nombre}`,
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

      {/* Documento Imprimible */}
      {esTicket ? (
        <div className="flex justify-center py-6 print:py-0 print:block">
          <TicketLayout
            data={data}
            incluirPrecios={incluirPrecios}
            referencia={ticketRef}
          />
        </div>
      ) : (
        <div className="max-w-4xl mx-auto p-4 sm:p-8 print:p-0">
          <A4Layout data={data} incluirPrecios={incluirPrecios} />
        </div>
      )}

      {/* Estilos para ocultar la barra de herramientas al imprimir */}
      <style jsx global>{`
        @media print {
          @page {
            ${esTicket ? "" : "size: A4;"}
            margin: ${esTicket ? "0" : "1cm"};
          }
          body {
            background: white;
          }
          .guia-ticket {
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
  data,
  incluirPrecios,
  referencia,
}: {
  data: GuiaAvicolaData;
  incluirPrecios: boolean;
  referencia?: RefObject<HTMLDivElement | null>;
}) {
  const esTransavic = data.cliente.empresa === "Transavic";
  const logo = esTransavic ? "/transavic.jpg" : "/avicola.jpg";
  const linea = "border-t border-dashed border-black my-3";

  return (
    <div
      ref={referencia}
      className="guia-ticket bg-white text-black shadow-lg border border-gray-300 rounded print:border-none"
      style={{ width: "80mm" }}
    >
      <div className="px-4 py-4" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        {/* Logo */}
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
              alt={data.cliente.empresa}
              className="h-full w-full object-cover object-center"
            />
          </div>
          <p className="text-sm font-bold uppercase tracking-wider mt-1">
            {data.cliente.empresa}
          </p>
          <h1 className="text-xl font-black mt-1">GUÍA DE VENTA</h1>
          <p className="text-lg font-bold">N.º {formatNumeroGuia(data.numero_guia)}</p>
          <p className="text-xs font-semibold text-gray-700">{fechaLegible(data.fecha)}</p>
        </div>

        <div className={linea} />

        {/* Datos Cliente */}
        <div className="text-xs leading-normal">
          <p className="font-bold text-sm">{data.cliente.nombre}</p>
          <p className="mt-0.5">
            {data.cliente.mercado}
            {data.cliente.numero_puesto ? ` · Puesto ${data.cliente.numero_puesto}` : ""}
          </p>
          {data.cliente.telefono && <p>Teléfono: {data.cliente.telefono}</p>}
        </div>

        <div className={linea} />

        {/* Anulada */}
        {data.anulada && (
          <div className="border-2 border-red-600 text-red-600 font-bold text-center py-1 text-sm tracking-widest my-2">
            ANULADA
          </div>
        )}

        {/* Tabla de Productos */}
        <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="border-b border-black text-left">
              <th className="py-1 pr-1 font-bold">Prod.</th>
              <th className="py-1 px-1 font-bold text-right">Peso</th>
              {incluirPrecios && (
                <>
                  <th className="py-1 px-1 font-bold text-right">P/kg</th>
                  <th className="py-1 pl-1 font-bold text-right">Total</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={i} className="border-b border-gray-200 align-top">
                <td className="py-1 pr-1 break-words">{item.producto_nombre}</td>
                <td className="py-1 px-1 text-right whitespace-nowrap">
                  {kilos(item.peso_kg)} kg
                </td>
                {incluirPrecios && (
                  <>
                    <td className="py-1 px-1 text-right whitespace-nowrap">
                      {soles(item.precio_kg)}
                    </td>
                    <td className="py-1 pl-1 text-right whitespace-nowrap font-semibold">
                      {soles(item.subtotal)}
                    </td>
                  </>
                )}
              </tr>
            ))}

            {/* Total General */}
            {incluirPrecios && (
              <tr className="border-t border-black font-bold">
                <td className="py-1.5 pr-1" colSpan={3}>
                  TOTAL
                </td>
                <td className="py-1.5 pl-1 text-right whitespace-nowrap text-sm">
                  {soles(data.total)}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Estado de Cuenta */}
        {incluirPrecios && (
          <>
            <div className={linea} />
            <div className="bg-gray-50 border border-gray-200 rounded p-2 text-xs">
              <p className="font-bold text-gray-600 uppercase text-[10px] tracking-wide mb-1">
                Estado de Cuenta
              </p>
              <div className="flex justify-between py-0.5">
                <span>Saldo anterior:</span>
                <span className="font-semibold">{soles(data.estado_cuenta.saldo_previo)}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span>Venta de hoy:</span>
                <span className="font-semibold">{soles(data.estado_cuenta.total_venta)}</span>
              </div>
              {data.estado_cuenta.abonos_aplicados > 0 && (
                <div className="flex justify-between py-0.5">
                  <span>Abonos de hoy:</span>
                  <span className="font-semibold">−{soles(data.estado_cuenta.abonos_aplicados)}</span>
                </div>
              )}
              <div className="flex justify-between items-center border-t border-gray-300 mt-1.5 pt-1.5 font-bold">
                <span className="text-xs">SALDO ACTUAL:</span>
                <span className="text-sm">{soles(data.estado_cuenta.saldo_actualizado)}</span>
              </div>
            </div>
          </>
        )}

        {/* Observaciones */}
        {data.observaciones && (
          <div className="mt-3 text-xs leading-normal">
            <span className="font-bold">Obs:</span> {data.observaciones}
          </div>
        )}

        <div className={linea} />

        {/* Firmas */}
        <div className="text-center text-[10px] pt-4 pb-2">
          <div className="flex justify-between gap-4 mt-2">
            <div className="flex-1">
              <div className="border-t border-black pt-1 mx-2">Firma cliente</div>
            </div>
            <div className="flex-1">
              <div className="border-t border-black pt-1 mx-2">Recibí conforme</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Layout Formato A4 ──
function A4Layout({
  data,
  incluirPrecios,
}: {
  data: GuiaAvicolaData;
  incluirPrecios: boolean;
}) {
  const esTransavic = data.cliente.empresa === "Transavic";
  const logo = esTransavic ? "/transavic.jpg" : "/avicola.jpg";

  return (
    <div className="bg-white p-8 border border-gray-200 rounded-2xl shadow-sm print:border-none print:shadow-none min-h-[297mm]">
      {/* Encabezado */}
      <div className="flex justify-between items-start border-b-2 border-gray-100 pb-6">
        <div>
          <h1 className="text-3xl font-black text-amber-600 tracking-tight">
            GUÍA DE VENTA (CAMPO)
          </h1>
          <p className="text-lg font-bold text-gray-500 mt-1">
            N.º {formatNumeroGuia(data.numero_guia)}
          </p>
          <p className="text-sm text-gray-600 mt-0.5">{fechaLegible(data.fecha)}</p>
        </div>

        <div className="text-right">
          <div className="h-16 w-auto flex justify-end">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt={data.cliente.empresa} className="h-full object-contain" />
          </div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
            {data.cliente.empresa}
          </p>
        </div>
      </div>

      {/* Datos Cliente */}
      <div className="grid grid-cols-2 gap-8 py-6 border-b border-gray-100">
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
            Cliente
          </h2>
          <p className="text-lg font-bold text-gray-900">{data.cliente.nombre}</p>
          <p className="text-sm text-gray-600 mt-0.5">
            Mercado: {data.cliente.mercado}
            {data.cliente.numero_puesto ? ` · Puesto ${data.cliente.numero_puesto}` : ""}
          </p>
        </div>

        {data.cliente.telefono && (
          <div>
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
              Contacto
            </h2>
            <p className="text-base text-gray-800">{data.cliente.telefono}</p>
          </div>
        )}
      </div>

      {/* Anulada */}
      {data.anulada && (
        <div className="border-4 border-red-600 text-red-600 font-black text-center py-2 text-xl tracking-widest my-4">
          VENTA ANULADA
        </div>
      )}

      {/* Tabla de Productos */}
      <table className="w-full mt-6 text-sm text-left">
        <thead>
          <tr className="border-b-2 border-gray-200 font-bold text-gray-500">
            <th className="py-3">Producto</th>
            <th className="py-3 text-right">Peso (kg)</th>
            {incluirPrecios && (
              <>
                <th className="py-3 text-right">Precio/kg</th>
                <th className="py-3 text-right">Importe</th>
              </>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.items.map((item, i) => (
            <tr key={i} className="align-middle">
              <td className="py-3.5 font-semibold text-gray-900">{item.producto_nombre}</td>
              <td className="py-3.5 text-right font-medium">{kilos(item.peso_kg)} kg</td>
              {incluirPrecios && (
                <>
                  <td className="py-3.5 text-right">{soles(item.precio_kg)}</td>
                  <td className="py-3.5 text-right font-bold text-gray-900">
                    {soles(item.subtotal)}
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
              <td className="py-4 text-right text-lg text-amber-600">{soles(data.total)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Estado de Cuenta */}
      {incluirPrecios && (
        <div className="mt-8 flex justify-end">
          <div className="w-80 bg-gray-50 border border-gray-200 rounded-2xl p-5 text-sm space-y-2.5">
            <h3 className="font-bold text-gray-500 uppercase text-xs tracking-wider mb-2">
              Resumen Estado de Cuenta
            </h3>
            <div className="flex justify-between">
              <span>Saldo previo:</span>
              <span className="font-semibold">{soles(data.estado_cuenta.saldo_previo)}</span>
            </div>
            <div className="flex justify-between">
              <span>Venta de hoy:</span>
              <span className="font-semibold text-gray-900">
                {soles(data.estado_cuenta.total_venta)}
              </span>
            </div>
            {data.estado_cuenta.abonos_aplicados > 0 && (
              <div className="flex justify-between text-gray-700">
                <span>Abonos de hoy:</span>
                <span className="font-semibold text-green-600">
                  −{soles(data.estado_cuenta.abonos_aplicados)}
                </span>
              </div>
            )}
            <div className="flex justify-between items-center border-t border-gray-200 pt-3 mt-3 font-bold text-base text-gray-900">
              <span>SALDO ACTUAL:</span>
              <span className="text-lg text-amber-700">
                {soles(data.estado_cuenta.saldo_actualizado)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Observaciones */}
      {data.observaciones && (
        <div className="mt-8 text-sm bg-gray-50 rounded-xl p-4 border border-gray-100">
          <span className="font-bold text-gray-700">Observaciones:</span>
          <p className="text-gray-600 mt-1">{data.observaciones}</p>
        </div>
      )}

      {/* Pie de página Firmas */}
      <div className="mt-24 border-t border-gray-100 pt-8">
        <div className="flex justify-around gap-12 text-center text-xs font-semibold text-gray-500">
          <div className="w-48">
            <div className="border-t border-dashed border-gray-300 pt-3">Firma del Cliente</div>
          </div>
          <div className="w-48">
            <div className="border-t border-dashed border-gray-300 pt-3">Recibí Conforme</div>
          </div>
        </div>
      </div>
    </div>
  );
}
