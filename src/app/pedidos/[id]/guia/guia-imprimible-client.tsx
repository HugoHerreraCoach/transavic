// src/app/pedidos/[id]/guia/guia-imprimible-client.tsx
// Componente cliente: render HTML de la guía + botón "Imprimir / Guardar PDF"
// usa window.print() del navegador — sin librerías PDF, $0 costo.
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

export default function GuiaImprimibleClient(props: Props) {
  // El botón "Compartir" depende del navegador (navigator.share), que no existe
  // en el servidor. Lo mostramos solo tras montar en el cliente para evitar el
  // desajuste de hidratación (server HTML ≠ client HTML).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const puedeCompartir =
    mounted && typeof navigator !== "undefined" && "share" in navigator;

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white">
      {/* Barra de acciones (no se imprime) */}
      <div className="print:hidden bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">Guía de Remisión</div>
            <div className="font-bold text-gray-800">N° {props.numero}</div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => window.print()}
              className="px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 flex items-center gap-2"
            >
              <FiPrinter />
              Imprimir / Guardar PDF
            </button>
            {puedeCompartir ? (
              <button
                onClick={async () => {
                  try {
                    await navigator.share({
                      title: `Guía ${props.numero} - ${props.cliente}`,
                      url: window.location.href,
                    });
                  } catch {
                    /* user canceled */
                  }
                }}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 flex items-center gap-2"
              >
                <FiShare2 />
                Compartir
              </button>
            ) : null}
          </div>
        </div>
        <div className="max-w-4xl mx-auto px-4 pb-2 text-xs text-gray-500">
          Sugerencia: en el diálogo de impresión elegí <strong>&quot;Guardar como PDF&quot;</strong> para enviarlo por WhatsApp.
        </div>
      </div>

      {/* Documento imprimible */}
      <div className="max-w-4xl mx-auto p-4 sm:p-8 print:p-0">
        <div className="bg-white print:bg-transparent shadow-lg print:shadow-none rounded-lg print:rounded-none p-6 sm:p-10 print:p-6">
          {/* Header */}
          <div className="flex items-start justify-between border-b-2 border-red-700 pb-4 mb-6">
            <div className="flex items-center">
              {/* Logo real de la marca (el mismo de /dashboard/nuevo-pedido) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={props.empresa === "Transavic" ? "/transavic.jpg" : "/avicola.jpg"}
                alt={props.empresa}
                className="h-20 w-auto max-w-[230px] object-contain"
              />
            </div>
            <div className="text-right">
              <div className="border-2 border-red-700 rounded px-3 py-1.5 text-xs font-bold text-red-700">
                ORDEN DE PEDIDO
              </div>
              <div className="mt-2 text-2xl font-bold text-red-700">
                N° {props.numero}
              </div>
              <div className="text-xs text-gray-500 mt-1">{props.fecha}</div>
            </div>
          </div>

          {/* Datos del cliente */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6 text-sm">
            <Field label="Señor(a)" value={props.cliente} />
            {props.razonSocial && <Field label="Razón Social" value={props.razonSocial} />}
            {props.rucDni && <Field label="RUC / DNI" value={props.rucDni} />}
            {props.whatsapp && <Field label="WhatsApp" value={props.whatsapp} />}
            <Field label="Dirección" value={props.direccion} className="sm:col-span-2" />
            {props.distrito && <Field label="Distrito" value={props.distrito} />}
            {props.asesor && <Field label="Asesor" value={props.asesor} />}
          </div>

          {/* Tabla de productos */}
          <table className="w-full border border-gray-300 text-sm mb-4">
            <thead className="bg-red-700 text-white">
              <tr>
                <th className="p-2 text-left">Cant.</th>
                <th className="p-2 text-left">Producto</th>
                <th className="p-2 text-right">P. Unit.</th>
                <th className="p-2 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {props.items.map((it, i) => (
                <tr key={i} className="border-t border-gray-200">
                  <td className="p-2 font-mono">
                    {it.cantidad} {it.unidad}
                  </td>
                  <td className="p-2">{it.producto}</td>
                  <td className="p-2 text-right font-mono">
                    {it.precio > 0 ? `S/ ${it.precio.toFixed(2)}` : "—"}
                  </td>
                  <td className="p-2 text-right font-mono font-semibold">
                    {it.subtotal > 0 ? `S/ ${it.subtotal.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
              {/* Filas vacías para que se vea como guía real */}
              {Array.from({ length: Math.max(0, 6 - props.items.length) }).map((_, i) => (
                <tr key={`empty-${i}`} className="border-t border-gray-200">
                  <td className="p-2">&nbsp;</td>
                  <td className="p-2">&nbsp;</td>
                  <td className="p-2">&nbsp;</td>
                  <td className="p-2">&nbsp;</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 border-t-2 border-red-700">
                <td colSpan={3} className="p-2 text-right font-bold">
                  TOTAL S/
                </td>
                <td className="p-2 text-right font-bold text-lg text-red-700">
                  {props.total.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>

          {props.notas && (
            <div className="mb-6 text-sm">
              <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Notas
              </div>
              <div className="bg-yellow-50 border-l-4 border-yellow-400 px-3 py-2 text-gray-700">
                {props.notas}
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
      </div>

      {/* Estilos de impresión */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 1cm;
          }
          body {
            background: white;
          }
        }
      `}</style>
    </div>
  );
}

function Field({ label, value, className = "" }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
      <div className="font-medium text-gray-800 mt-0.5">{value}</div>
    </div>
  );
}
