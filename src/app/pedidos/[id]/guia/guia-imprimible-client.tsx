// src/app/pedidos/[id]/guia/guia-imprimible-client.tsx
// Componente cliente: render HTML de la "orden de pedido" + botón "Imprimir / Guardar PDF".
// Usa window.print() del navegador — sin librerías PDF, $0 costo.
//
// DOS formatos de impresión (el usuario elige; por defecto TICKET):
//   • Ticket (80mm): para impresora térmica / ticketera. Monocromo (las térmicas
//     no imprimen color), compacto, una columna, separadores punteados.
//   • A4: el documento completo de toda la vida (logo, tabla, etc.).
// El tamaño de página (@page size) se cambia según el formato elegido.
//
// Toggle "Incluir precios": cada cliente maneja precios distintos, así que al
// imprimir el usuario decide si la orden lleva precios o solo cantidades.
"use client";

import { useEffect, useState } from "react";
import { FiPrinter, FiShare2 } from "react-icons/fi";

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
  const puedeCompartir =
    mounted && typeof navigator !== "undefined" && "share" in navigator;

  const esTicket = formato === "ticket";

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
              onClick={() => window.print()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 flex items-center gap-2 transition-transform active:scale-[0.98]"
            >
              <FiPrinter />
              Imprimir
            </button>
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
              Listo para <strong>impresora de tickets (80mm)</strong>. En el
              diálogo de impresión elige tu ticketera; o{" "}
              <strong>&quot;Guardar como PDF&quot;</strong> para enviarlo por WhatsApp.
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
          <TicketLayout {...props} incluirPrecios={incluirPrecios} />
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
            size: ${esTicket ? "80mm auto" : "A4"};
            margin: ${esTicket ? "0" : "1cm"};
          }
          body {
            background: white;
          }
          .orden-ticket {
            box-shadow: none !important;
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
}: Props & { incluirPrecios: boolean }) {
  const nombreEmpresa = empresa === "Transavic" ? "TRANSAVIC" : "AVÍCOLA DE TONY";
  const linea = "border-t border-dashed border-gray-500 my-2";
  return (
    <div
      className="orden-ticket bg-white text-black shadow-lg print:shadow-none"
      style={{ width: "80mm" }}
    >
      <div className="px-3 py-3" style={{ fontFamily: "Arial, Helvetica, sans-serif" }}>
        {/* Encabezado */}
        <div className="text-center leading-tight">
          <div className="text-lg font-extrabold tracking-wide">{nombreEmpresa}</div>
          <div className="text-[13px] font-bold mt-0.5">ORDEN DE PEDIDO</div>
          <div className="text-[16px] font-extrabold">N° {numero}</div>
          <div className="text-[11px]">{fecha}</div>
        </div>

        <div className={linea} />

        {/* Datos del cliente */}
        <div className="text-[12px] leading-snug space-y-0.5">
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
        <div className="text-[12px]">
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
            <div className="flex justify-between items-baseline font-extrabold text-[16px]">
              <span>TOTAL</span>
              <span className="font-mono">S/ {total.toFixed(2)}</span>
            </div>
          </>
        )}

        {notas && (
          <>
            <div className={linea} />
            <div className="text-[12px]">
              <span className="font-bold">Notas: </span>
              <span className="whitespace-pre-wrap break-words">{notas}</span>
            </div>
          </>
        )}

        {/* Firma del cliente */}
        <div className="mt-12 text-center text-[12px]">
          <div className="border-t border-black mx-3 pt-1">
            <div className="font-semibold">Firma del cliente</div>
            <div className="text-[10px]">Recibí conforme</div>
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
