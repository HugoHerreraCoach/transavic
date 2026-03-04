// src/components/VistaImpresion.tsx
import { Pedido } from '@/lib/types';

interface VistaImpresionProps {
  pedidos: Pedido[];
  formato: 'A4' | 'Ticket';
}

export default function VistaImpresion({ pedidos, formato }: VistaImpresionProps) {
  // Solo se imprimen los que NO están fallidos
  const pedidosImprimibles = pedidos.filter(p => p.estado !== 'Fallido');

  if (pedidosImprimibles.length === 0) {
    return <div className="p-4 text-center">No hay pedidos para imprimir.</div>;
  }

  return (
    <div className={`impresion-container bg-white text-black p-4 ${formato === 'Ticket' ? 'formato-ticket' : 'formato-a4'}`}>
      <div className="text-center mb-6">
        <h1 className="text-xl font-bold">REPORTE DE PEDIDOS</h1>
        <p className="text-sm text-gray-600">Total: {pedidosImprimibles.length} pedidos</p>
        <p className="text-xs text-gray-500">{new Date().toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
      </div>

      <div className={`grid gap-4 ${formato === 'A4' ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {pedidosImprimibles.map((pedido, index) => (
          <div key={pedido.id} className="border-b-2 border-dashed border-gray-400 pb-4 mb-2 break-inside-avoid">
            <div className="flex justify-between items-start mb-1">
              <h2 className="text-lg font-bold uppercase leading-tight">
                {index + 1}. {pedido.cliente}
              </h2>
              <span className="border border-black px-1 text-xs uppercase font-bold">
                {pedido.estado === 'Entregado' ? 'Entregado' : '   '}
              </span>
            </div>
            
            <div className="mb-2 text-sm">
              <span className="font-semibold px-2 py-0.5 bg-gray-200 rounded text-black text-xs uppercase mr-2">
                {pedido.distrito || 'Sin Distrito'}
              </span>
              {pedido.hora_entrega && (
                <span className="font-semibold text-xs">
                  ⏰ {pedido.hora_entrega}
                </span>
              )}
            </div>

            {pedido.asesor_name && (
              <div className="mb-1 text-xs">
                <span className="font-bold">Asesor:</span> {pedido.asesor_name}
              </div>
            )}

            {pedido.notas && (
              <div className="mb-2 text-xs">
                <span className="font-bold">Obs:</span>{' '}
                <span className="italic">{pedido.notas}</span>
              </div>
            )}

            <div className="mt-2 text-sm leading-snug">
              <div className="font-bold underline mb-1">Pedido:</div>
              <div className="whitespace-pre-wrap ml-2 mb-2 p-1 border-l-2 border-black bg-gray-50">
                {pedido.detalle}
              </div>
              
              {pedido.detalle_final && (
                <div className="mt-2 font-bold text-sm bg-gray-100 p-1 border border-black inline-block">
                  ⚖ {pedido.detalle_final}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 text-center text-xs">
        --- Fin del Reporte ---
      </div>
    </div>
  );
}
