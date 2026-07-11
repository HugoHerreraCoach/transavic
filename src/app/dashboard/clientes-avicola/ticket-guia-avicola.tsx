// src/app/dashboard/clientes-avicola/ticket-guia-avicola.tsx
// Ticket de la GUÍA DE VENTA del módulo "Clientes Avícola" (venta en campo).
// Layout HTML de ancho fijo ~500px pensado para ser FOTOGRAFIADO con
// html-to-image (toJpeg) desde guia-avicola-modal.tsx y compartido por
// WhatsApp. Documento informal, NO es la GRE legal de SUNAT.
"use client";

import type { GuiaAvicolaData } from "@/lib/avicola/types";
import { formatNumeroGuia } from "@/lib/correlativos";

const formatoMonto = new Intl.NumberFormat("es-PE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formato soles: "S/ 1,234.56" (2 decimales + separador de miles). */
function soles(monto: number): string {
  return `S/ ${formatoMonto.format(monto)}`;
}

/** Peso en kilos con 2 decimales: "12.50". */
function kilos(peso: number): string {
  return formatoMonto.format(peso);
}

/**
 * La fecha llega como "YYYY-MM-DD" (a veces con hora ISO detrás).
 * NUNCA `new Date(str)` directo: el navegador lo interpreta como medianoche
 * UTC y en Lima (UTC-5) la fecha se corre UN DÍA hacia atrás. Se parsean las
 * partes y se construye la fecha en hora LOCAL.
 */
function fechaLegible(fecha: string): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number);
  if (!anio || !mes || !dia) return fecha;
  const texto = new Date(anio, mes - 1, dia).toLocaleDateString("es-PE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  // "lunes, 7 de julio de 2026" → "Lunes, 7 de julio de 2026"
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

interface TicketGuiaAvicolaProps {
  data: GuiaAvicolaData;
  /**
   * true  → tabla con columna "Precio/kg" (Opción 1).
   * false → se oculta ÚNICAMENTE el precio por kilo (req. §8, Opción 2);
   *          el importe por producto y el total SIEMPRE se muestran.
   */
  incluirPrecios: boolean;
  /** Logo ya convertido a dataURL (lo prepara el modal, con cache-bust). */
  logoDataUrl?: string | null;
}

export default function TicketGuiaAvicola({
  data,
  incluirPrecios,
  logoDataUrl,
}: TicketGuiaAvicolaProps) {
  const esTransavic = data.cliente.empresa === "Transavic";
  const numeroFormateado = formatNumeroGuia(data.numero_guia);

  return (
    <div
      className="relative overflow-hidden bg-white text-black border-2 border-gray-300 rounded-lg"
      style={{ width: "500px", fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {/* Banda diagonal cuando la venta está ANULADA */}
      {data.anulada && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
          <div
            className="border-4 border-red-600 text-red-600 font-black text-5xl tracking-widest px-10 py-2 bg-white"
            style={{ transform: "rotate(-18deg)", opacity: 0.9 }}
          >
            ANULADA
          </div>
        </div>
      )}

      <div className="p-8">
        {/* Encabezado: logo + empresa + título + número + fecha.
            El JPG de Transavic trae aire arriba/abajo dentro del cuadrado;
            se recorta con un contenedor 3/2 + object-cover (mismo criterio
            que TicketPedido/guia-imprimible). El de Avícola llena el
            cuadrado → se muestra entero (1/1). */}
        <div className="text-center pb-4 border-b-2 border-dashed border-gray-400">
          {logoDataUrl && (
            <div
              className="mx-auto overflow-hidden"
              style={{
                width: esTransavic ? "180px" : "140px",
                aspectRatio: esTransavic ? "3 / 2" : "1 / 1",
              }}
            >
              {/* NO agregar crossOrigin: el src es un data: URL (mismo origen).
                  En WebKit/iOS ese atributo fuerza una petición CORS que falla para
                  data: URLs → la imagen no carga y la guía sale SIN logo. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoDataUrl}
                alt={`Logo de ${data.cliente.empresa}`}
                className="h-full w-full object-cover object-center"
                style={{ display: "block" }}
              />
            </div>
          )}
          <p className="text-lg font-bold uppercase tracking-wide mt-1">
            {data.cliente.empresa}
          </p>
          <h1 className="text-3xl font-black text-red-600 mt-1">
            GUÍA DE VENTA
          </h1>
          <p className="text-2xl font-black mt-1">N.º {numeroFormateado}</p>
          <p className="text-gray-700 text-base font-semibold mt-1">
            {fechaLegible(data.fecha)}
          </p>
        </div>

        {/* Datos del cliente */}
        <div className="mt-5 pb-4 border-b-2 border-dashed border-gray-400">
          <p className="text-2xl font-bold break-words">{data.cliente.nombre}</p>
          <p className="text-lg text-gray-700 mt-1">
            {data.cliente.mercado}
            {data.cliente.numero_puesto
              ? ` · Puesto ${data.cliente.numero_puesto}`
              : ""}
          </p>
          {data.cliente.telefono && (
            <p className="text-lg text-gray-700 mt-1">
              Teléfono: {data.cliente.telefono}
            </p>
          )}
        </div>

        {/* Tabla de productos: Producto | Peso (kg) | [Precio/kg] | Importe */}
        <table className="w-full mt-5 text-base" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="py-2 pr-2 font-bold">Producto</th>
              <th className="py-2 px-2 font-bold text-right whitespace-nowrap">
                Peso (kg)
              </th>
              {incluirPrecios && (
                <th className="py-2 px-2 font-bold text-right whitespace-nowrap">
                  Precio/kg
                </th>
              )}
              <th className="py-2 pl-2 font-bold text-right whitespace-nowrap">
                Importe
              </th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item, i) => (
              <tr key={i} className="border-b border-gray-300 align-top">
                <td className="py-2 pr-2 break-words">{item.producto_nombre}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap">
                  {kilos(item.peso_kg)}
                </td>
                {incluirPrecios && (
                  <td className="py-2 px-2 text-right whitespace-nowrap">
                    {soles(item.precio_kg)}
                  </td>
                )}
                <td className="py-2 pl-2 text-right whitespace-nowrap font-semibold">
                  {soles(item.subtotal)}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 border-black font-bold text-lg">
              <td className="py-2 pr-2" colSpan={incluirPrecios ? 3 : 2}>
                TOTAL
              </td>
              <td className="py-2 pl-2 text-right whitespace-nowrap">
                {soles(data.total)}
              </td>
            </tr>
          </tbody>
        </table>

        {/* Observaciones de la venta (si el Gerente anotó algo) */}
        {data.observaciones && (
          <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap break-words">
            <span className="font-semibold">Obs.:</span> {data.observaciones}
          </p>
        )}

        {/* Bloque ESTADO DE CUENTA (req. §9) — recuadro gris */}
        <div className="mt-5 bg-gray-100 border border-gray-300 rounded-md p-4">
          <p className="text-sm font-bold uppercase tracking-wide text-gray-600 mb-2">
            Estado de cuenta
          </p>
          <div className="flex justify-between text-base py-0.5">
            <span>Saldo anterior:</span>
            <span className="font-semibold whitespace-nowrap">
              {soles(data.estado_cuenta.saldo_previo)}
            </span>
          </div>
          <div className="flex justify-between text-base py-0.5">
            <span>Venta de hoy:</span>
            <span className="font-semibold whitespace-nowrap">
              {soles(data.estado_cuenta.total_venta)}
            </span>
          </div>
          {data.estado_cuenta.abonos_aplicados > 0 && (
            <div className="flex justify-between text-base py-0.5">
              <span>Abonos:</span>
              <span className="font-semibold whitespace-nowrap">
                −{soles(data.estado_cuenta.abonos_aplicados)}
              </span>
            </div>
          )}
          <div className="flex justify-between items-center border-t-2 border-gray-400 mt-2 pt-2">
            <span className="text-lg font-black">SALDO ACTUAL:</span>
            <span className="text-2xl font-black whitespace-nowrap">
              {soles(data.estado_cuenta.saldo_actualizado)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
