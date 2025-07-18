'use client';

import { useState } from 'react';
import { Pedido } from "@/lib/types";
import { FiTruck, FiUser, FiCalendar, FiFileText, FiPhone, FiEdit, FiSave, FiTrash2 } from 'react-icons/fi';

// ✅ TIPO DE PROPS PARA PesoInput ACTUALIZADO
type PesoInputProps = {
    pedido: Pedido;
    onDelete: (id: string) => void;
};

// ✅ COMPONENTE PesoInput REESCRITO CON LA NUEVA LÓGICA
function PesoInput({ pedido, onDelete }: PesoInputProps) {
    const [peso, setPeso] = useState<string>(pedido.peso_exacto?.toString() ?? '');
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSave = async () => {
        if (peso === (pedido.peso_exacto?.toString() ?? '')) {
            setIsEditing(false);
            return;
        }
        setIsSaving(true);
        setError(null);
        try {
            const pesoValue = peso === '' ? null : parseFloat(peso);
            if (isNaN(pesoValue as number)) throw new Error('Valor inválido.');

            const response = await fetch(`/api/pedidos/${pedido.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pesoExacto: pesoValue }),
            });
            if (!response.ok) throw new Error('No se pudo guardar.');
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error al guardar';
            setError(msg);
        } finally {
            setIsSaving(false);
            setIsEditing(false);
        }
    };

    const handleDelete = async () => {
        if (!window.confirm(`¿Seguro que quieres eliminar el pedido de "${pedido.cliente}"?`)) {
            return;
        }
        setIsSaving(true); // Deshabilitar botones mientras se borra
        try {
            const response = await fetch(`/api/pedidos/${pedido.id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Error al eliminar');
            // ✅ CORRECCIÓN: Se pasa el id (string) directamente, sin Number()
            onDelete(pedido.id);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Error desconocido';
            alert(`No se pudo eliminar el pedido: ${msg}`);
            setIsSaving(false);
        }
    };

    return (
        <div className="flex items-center gap-2 relative">
            <input
                type="number"
                step="0.01"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                placeholder="0.00 kg"
                className="w-24 p-2 border rounded-md text-sm text-center bg-gray-50 focus:ring-2 focus:ring-blue-500 disabled:bg-gray-200"
                disabled={!isEditing || isSaving}
            />
            {isEditing ? (
                <button
                    onClick={handleSave}
                    disabled={isSaving}
                    className="p-2 w-24 flex items-center justify-center gap-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-400 transition-colors"
                    aria-label="Guardar peso"
                >
                    <FiSave /> Guardar
                </button>
            ) : (
                <button
                    onClick={() => setIsEditing(true)}
                    disabled={isSaving}
                    className="p-2 w-24 flex items-center justify-center gap-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:bg-gray-400 transition-colors"
                    aria-label="Editar peso"
                >
                    <FiEdit /> Editar
                </button>
            )}
            <button
                onClick={handleDelete}
                disabled={isSaving}
                className="p-2 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors disabled:bg-gray-400"
                aria-label="Eliminar pedido"
            >
                <FiTrash2 />
            </button>
            {error && <p className="mt-1 text-xs text-red-500 absolute -bottom-5 left-0">{error}</p>}
        </div>
    );
}

// ✅ PROPS ACTUALIZADAS PARA PedidoCard Y PedidosTable
type PedidoCardProps = {
    pedido: Pedido;
    onPedidoDeleted: (id: string) => void;
};

type PedidosTableProps = {
    pedidos: Pedido[];
    onPedidoDeleted: (id: string) => void;
};

function PedidoCard({ pedido, onPedidoDeleted }: PedidoCardProps) {
    const getWhatsAppLink = (numero: string | null | undefined) => {
        if (numero && numero.length === 9 && numero.startsWith('9')) return `https://wa.me/51${numero}`;
        if (numero) return `https://wa.me/${numero}`;
        return '#';
    };
    const whatsappLink = getWhatsAppLink(pedido.whatsapp);

    return (
        <div className="bg-white rounded-lg shadow-md p-4 border border-gray-200">
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 text-lg font-bold text-gray-800">
                    <FiUser /><span>{pedido.cliente}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <FiCalendar /><span>{pedido.fecha_pedido}</span>
                </div>
            </div>
            {pedido.whatsapp && (
                <div className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                    <FiPhone />
                    <a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{pedido.whatsapp}</a>
                </div>
            )}
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-700">
                <FiTruck /><span>{pedido.empresa}</span>
            </div>
            <div className="mt-4 p-3 bg-gray-50 rounded-md">
                <div className="flex items-start gap-2 text-sm text-gray-800">
                    <FiFileText className="mt-0.5 flex-shrink-0" />
                    <p className="break-words">{pedido.detalle}</p>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">Peso Exacto (kg)</label>
                <PesoInput pedido={pedido} onDelete={onPedidoDeleted} />
            </div>
        </div>
    );
}

export default function PedidosTable({ pedidos, onPedidoDeleted }: PedidosTableProps) {
    if (pedidos.length === 0) {
        return <p className="mt-8 text-center text-gray-500">No se encontraron pedidos con los filtros actuales.</p>;
    }
    const getWhatsAppLink = (numero: string | null | undefined) => {
        if (numero && numero.length === 9 && numero.startsWith('9')) return `https://wa.me/51${numero}`;
        if (numero) return `https://wa.me/${numero}`;
        return '#';
    };
    const formatPesoForPrint = (peso: number | string | null | undefined) => {
        if (peso === null || peso === undefined || peso === '') return 'N/A';
        const num = parseFloat(String(peso));
        if (isNaN(num)) return 'N/A';
        return `${num.toFixed(2)} kg`;
    };

    return (
        <>
            <div className="space-y-4 sm:hidden print:hidden">
                {pedidos.map((pedido) => (
                    <PedidoCard key={pedido.id} pedido={pedido} onPedidoDeleted={onPedidoDeleted} />
                ))}
            </div>
            <div className="hidden sm:block print:block overflow-x-auto print:overflow-visible bg-white rounded-lg shadow border border-gray-200">
                <table className="min-w-full text-gray-900">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Cliente</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Whatsapp</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Empresa</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Fecha</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Pedido</th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Peso</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {pedidos.map((pedido) => {
                            const whatsappLink = getWhatsAppLink(pedido.whatsapp);
                            return (
                                <tr key={pedido.id} className="hover:bg-gray-50 align-top">
                                    <td className="px-4 py-4 whitespace-nowrap"><div className="flex items-center gap-2"><FiUser />{pedido.cliente}</div></td>
                                    <td className="px-4 py-4 whitespace-nowrap">{pedido.whatsapp ? (<div className="flex items-center gap-2"><FiPhone /><a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{pedido.whatsapp}</a></div>) : (<span className="text-gray-400">N/A</span>)}</td>
                                    <td className="px-4 py-4 whitespace-nowrap"><div className="flex items-center gap-2"><FiTruck />{pedido.empresa}</div></td>
                                    <td className="px-4 py-4 whitespace-nowrap"><div className="flex items-center gap-2"><FiCalendar />{pedido.fecha_pedido}</div></td>
                                    <td className="px-4 py-4 max-w-sm print:max-w-none"><div className="flex items-start gap-2"><FiFileText className="mt-1 flex-shrink-0" /><p className="break-words print:whitespace-normal" title={pedido.detalle}>{pedido.detalle}</p></div></td>
                                    <td className="px-4 py-4 whitespace-nowrap">
                                        <div className="print:hidden">
                                            <PesoInput pedido={pedido} onDelete={onPedidoDeleted} />
                                        </div>
                                        <div className="hidden print:block">
                                            {formatPesoForPrint(pedido.peso_exacto)}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </>
    );
}