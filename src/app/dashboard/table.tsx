// src/app/dashboard/table.tsx
'use client';

import { useState } from 'react';
import { Pedido } from "@/lib/types";
import { FiTruck, FiUser, FiCalendar, FiSave, FiFileText } from 'react-icons/fi';

type PesoInputProps = {
    pedido: Pedido;
};

// El componente PesoInput se mantiene igual, no necesita cambios.
function PesoInput({ pedido }: PesoInputProps) {
    const [peso, setPeso] = useState<string>(pedido.peso_exacto?.toString() ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const pesoValue = peso === '' ? null : parseFloat(peso);
            if (isNaN(pesoValue as number)) {
                throw new Error('Valor de peso inválido.');
            }
            const response = await fetch(`/api/pedidos/${pedido.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pesoExacto: pesoValue }),
            });

            if (!response.ok) throw new Error('No se pudo guardar.');
            // En lugar de alert, podrías mostrar un toast o un mensaje más sutil.
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : 'Error al guardar';
            setError(errorMessage);
            console.error(err);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <input
                type="number"
                step="0.01"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="0.00 kg"
                className="w-24 p-2 border rounded-md text-sm text-center bg-gray-50 focus:ring-2 focus:ring-blue-500"
                disabled={isSaving}
            />
            <button
                onClick={handleSave}
                disabled={isSaving}
                className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 transition-colors"
                aria-label="Guardar peso"
            >
                <FiSave />
            </button>
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
    );
}

// ✅ NUEVO: Componente para la vista de tarjeta en móvil
type PedidoCardProps = {
    pedido: Pedido;
};

function PedidoCard({ pedido }: PedidoCardProps) {
    return (
        <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 text-lg font-bold text-gray-800">
                    <FiUser />
                    <span>{pedido.cliente}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FiCalendar />
                    <span>{pedido.fecha_pedido}</span>
                </div>
            </div>
            
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                <FiTruck />
                <span>{pedido.empresa}</span>
            </div>

            <div className="mt-4 p-3 bg-gray-50 rounded-md">
                <div className="flex items-start gap-2 text-sm text-gray-800">
                    <FiFileText className="mt-0.5 flex-shrink-0" />
                    <p className="break-words">{pedido.detalle}</p>
                </div>
            </div>
            
            <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">Peso Exacto (kg)</label>
                <PesoInput pedido={pedido} />
            </div>
        </div>
    );
}

// ✅ MEJORA: Componente principal que renderiza Cards o Tabla según el tamaño
type PedidosTableProps = {
    pedidos: Pedido[];
};

export default function PedidosTable({ pedidos }: PedidosTableProps) {
    if (pedidos.length === 0) {
        return <p className="mt-8 text-center text-gray-500">No se encontraron pedidos con los filtros actuales.</p>;
    }

    return (
        <>
            {/* Vista para Móvil: Lista de Cards (Visible por defecto, oculto en sm y más grandes) */}
            <div className="space-y-4 sm:hidden">
                {pedidos.map((pedido) => (
                    <PedidoCard key={pedido.id} pedido={pedido} />
                ))}
            </div>

            {/* Vista para Escritorio: Tabla (Oculta por defecto, visible en sm y más grandes) */}
            <div className="hidden sm:block overflow-x-auto bg-white rounded-lg shadow border border-gray-200">
                <table className="min-w-full text-gray-900">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Cliente</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Empresa</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Detalle</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Peso Exacto</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {pedidos.map((pedido) => (
                            <tr key={pedido.id} className="hover:bg-gray-50">
                                <td className="px-4 py-4 whitespace-nowrap"><div className="flex items-center gap-2"><FiUser />{pedido.cliente}</div></td>
                                <td className="px-4 py-4 whitespace-nowrap"><div className="flex items-center gap-2"><FiTruck />{pedido.empresa}</div></td>
                                <td className="px-4 py-4 whitespace-nowrap"><div className="flex items-center gap-2"><FiCalendar />{pedido.fecha_pedido}</div></td>
                                <td className="px-4 py-4 max-w-sm"><div className="flex items-start gap-2"><FiFileText className="mt-1 flex-shrink-0" /><p className="truncate" title={pedido.detalle}>{pedido.detalle}</p></div></td>
                                <td className="px-4 py-4 whitespace-nowrap"><PesoInput pedido={pedido} /></td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}