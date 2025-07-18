// src/app/dashboard/table.tsx
'use client';

import { useState } from 'react';
import { Pedido } from "@/lib/types";
import { FiTruck, FiUser, FiCalendar, FiSave, FiFileText } from 'react-icons/fi';

// Pequeño componente para manejar la lógica del input
function PesoInput({ pedido }: { pedido: Pedido }) {
    const [peso, setPeso] = useState<string>(pedido.peso_exacto?.toString() ?? '');
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        try {
            const pesoValue = peso === '' ? null : parseFloat(peso);
            const response = await fetch(`/api/pedidos/${pedido.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pesoExacto: pesoValue }),
            });

            if (!response.ok) throw new Error('No se pudo guardar.');

            alert('¡Peso guardado con éxito!');

        } catch (err) {
            setError('Error al guardar');
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
                placeholder="0.00"
                className="w-24 p-1 border rounded-md text-sm text-center"
                disabled={isSaving}
            />
            <button
                onClick={handleSave}
                disabled={isSaving}
                className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:bg-gray-400"
                aria-label="Guardar peso"
            >
                <FiSave />
            </button>
            {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
    );
}

// Componente principal de la tabla
export default function PedidosTable({ pedidos }: { pedidos: Pedido[] }) {
    if (pedidos.length === 0) {
        return <p className="text-center text-gray-500 mt-8">No se encontraron pedidos.</p>;
    }

    return (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
            <table className="min-w-full text-gray-900">
                <thead className="bg-gray-100 border-b">
                    <tr>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Cliente</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Empresa</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Fecha</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Detalle</th>
                        <th className="px-4 py-3 text-left text-sm font-semibold">Peso Exacto</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                    {pedidos.map((pedido) => (
                        <tr key={pedido.id} className="hover:bg-gray-50">
                            <td className="px-4 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                    <FiUser className="text-gray-500 mr-2" />
                                    {pedido.cliente}
                                </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                    <FiTruck className="text-gray-500 mr-2" />
                                    {pedido.empresa}
                                </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                                <div className="flex items-center">
                                    <FiCalendar className="text-gray-500 mr-2" />
                                    {pedido.fecha_pedido}
                                </div>

                            </td>
                            <td className="px-4 py-4 max-w-sm">
                                {/* ✅ Mejora: Se añadió un ícono para consistencia */}
                                <div className="flex items-center">
                                    <FiFileText className="text-gray-500 mr-2 flex-shrink-0" />
                                    <p className="truncate" title={pedido.detalle}>{pedido.detalle}</p>
                                </div>
                            </td>
                            <td className="px-4 py-4 whitespace-nowrap">
                                <PesoInput pedido={pedido} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}