// src/app/dashboard/table.tsx
'use client';

import { useState } from 'react';
import { Pedido } from "@/lib/types";
// ✅ CORRECCIÓN 1: Se reincorporan los íconos para el estado en la vista móvil
import { FiTruck, FiUser, FiCalendar, FiFileText, FiPhone, FiEdit, FiTrash2, FiMapPin, FiMap, FiTag, FiClock, FiInfo, FiShare2, FiCheckCircle, FiUserCheck, FiXCircle, FiArchive } from 'react-icons/fi';

type Column = 'distrito' | 'tipo_cliente' | 'hora_entrega' | 'notas' | 'empresa' | 'asesor' | 'entregado' | 'navegacion' | 'fecha' | 'detalle_final';

type ActionsCellProps = {
    pedido: Pedido;
    onDelete: (id: string) => void;
    onUpdateStatus: (pedido: Pedido) => void;
    onEdit: (pedido: Pedido) => void;
    onShare: (pedido: Pedido) => void;
    userRole: string;
};

function ActionsCell({ pedido, onDelete, onUpdateStatus, onEdit, onShare, userRole }: ActionsCellProps) {
    const [isProcessing, setIsProcessing] = useState(false);

    const handleDelete = async () => {
        if (!window.confirm(`¿Seguro que quieres eliminar el pedido de "${pedido.cliente}"?`)) return;
        setIsProcessing(true);
        try {
            const response = await fetch(`/api/pedidos/${pedido.id}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Error al eliminar');
            onDelete(pedido.id);
        } catch (err) {
            alert(`No se pudo eliminar el pedido: ${err instanceof Error ? err.message : 'Error'}`);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleToggleDelivery = async () => {
        if (isProcessing) return;
        setIsProcessing(true);
        const newStatus = !pedido.entregado;
        try {
            const response = await fetch(`/api/pedidos/${pedido.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ entregado: newStatus }),
            });
            if (!response.ok) throw new Error('Error al actualizar');
            onUpdateStatus({ ...pedido, entregado: newStatus });
        } catch {
            alert("No se pudo actualizar el estado del pedido.");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
            <button onClick={handleToggleDelivery} disabled={isProcessing} className={`p-2 w-full sm:w-auto flex items-center justify-center gap-2 text-white rounded-lg transition-colors text-xs sm:text-sm ${pedido.entregado ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-teal-500 hover:bg-teal-600'}`}>
                {pedido.entregado ? <FiXCircle /> : <FiCheckCircle />}
                <span>{pedido.entregado ? 'Anular' : 'Entregar'}</span>
            </button>
            {userRole !== 'repartidor' && (
                <button onClick={() => onEdit(pedido)} disabled={isProcessing} className="p-2 w-full sm:w-auto flex items-center justify-center gap-2 text-white rounded-lg bg-blue-500 hover:bg-blue-600 transition-colors text-xs sm:text-sm">
                    <FiEdit /><span>Editar</span>
                </button>
            )}
            <button onClick={() => onShare(pedido)} disabled={isProcessing} className="p-2 w-full sm:w-auto flex items-center justify-center gap-2 text-white rounded-lg bg-green-500 hover:bg-green-600 transition-colors text-xs sm:text-sm">
                <FiShare2 /><span>Compartir</span>
            </button>
            {userRole !== 'repartidor' && (
                <button onClick={handleDelete} disabled={isProcessing} className="p-2 w-full sm:w-auto flex items-center justify-center text-white rounded-lg bg-red-500 hover:bg-red-600 transition-colors">
                    <FiTrash2 />
                </button>
            )}
        </div>
    );
}

type PedidoCardProps = {
    pedido: Pedido;
    onPedidoDeleted: (id: string) => void;
    onPedidoUpdated: (pedido: Pedido) => void;
    onEditClick: (pedido: Pedido) => void;
    onShareClick: (pedido: Pedido) => void;
    visibleColumns: Record<Column, boolean>;
    userRole: string;
};

type PedidosTableProps = {
    pedidos: Pedido[];
    onPedidoDeleted: (id: string) => void;
    onPedidoUpdated: (pedido: Pedido) => void;
    onEditClick: (pedido: Pedido) => void;
    onShareClick: (pedido: Pedido) => void;
    visibleColumns: Record<Column, boolean>;
    userRole: string;
};

function PedidoCard({ pedido, onPedidoDeleted, onPedidoUpdated, onEditClick, onShareClick, visibleColumns, userRole }: PedidoCardProps) {
    const getWhatsAppLink = (numero: string | null | undefined) => {
        if (!numero) return '#';
        return `https://wa.me/${numero.replace(/[^0-9]/g, '')}`;
    };
    const whatsappLink = getWhatsAppLink(pedido.whatsapp);

    return (
        <div className={`bg-white rounded-lg shadow-md p-4 border border-gray-200 transition-all ${pedido.entregado ? 'bg-green-50' : ''}`}>
            <div className="flex justify-between items-start">
                <div className="flex items-center gap-2 text-lg font-bold text-gray-800"><FiUser /><span>{pedido.cliente}</span></div>
                <div className="flex items-center gap-2 text-sm text-gray-600"><FiCalendar /><span>{pedido.fecha_pedido}</span></div>
            </div>
            {pedido.whatsapp && (<div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiPhone /><a href={whatsappLink} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{pedido.whatsapp}</a></div>)}
            <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiMapPin /><span>{pedido.direccion}</span></div>
            {visibleColumns.navegacion && pedido.latitude && pedido.longitude && (
                <div className="mt-3 flex items-center gap-4 text-sm">
                    <FiMap />
                    <a href={`https://www.google.com/maps/search/?api=1&query=${pedido.latitude},${pedido.longitude}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Google Maps</a>
                    <a href={`https://waze.com/ul?ll=${pedido.latitude},${pedido.longitude}&navigate=yes`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Waze</a>
                </div>
            )}
            {visibleColumns.empresa && <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiTruck /><span>{pedido.empresa}</span></div>}
            {visibleColumns.distrito && <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiMap /><span>{pedido.distrito}</span></div>}
            {visibleColumns.tipo_cliente && <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiTag /><span>{pedido.tipo_cliente}</span></div>}
            {visibleColumns.hora_entrega && <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiClock /><span>{pedido.hora_entrega}</span></div>}
            {visibleColumns.asesor && <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiUserCheck /><span>Asesor: {pedido.asesor_name ?? 'N/A'}</span></div>}

            {/* ✅ CORRECCIÓN 2: Se agrega el estado en la vista móvil con su condición de visibilidad */}
            {visibleColumns.entregado && (
                <div className="mt-3 flex items-center gap-2 text-sm font-medium">
                    {pedido.entregado ? <FiCheckCircle className="text-green-600" /> : <FiClock className="text-yellow-600" />}
                    <span className={pedido.entregado ? 'text-green-700' : 'text-yellow-700'}>
                        Estado: {pedido.entregado ? 'Entregado' : 'Pendiente'}
                    </span>
                </div>
            )}

            <div className="mt-4 p-3 bg-gray-50 rounded-md">
                <div className="flex items-start gap-2 text-sm text-gray-800"><FiFileText className="mt-0.5 flex-shrink-0" /><p className="break-words">{pedido.detalle}</p></div>
            </div>
            {visibleColumns.notas && pedido.notas && <div className="mt-3 flex items-start gap-2 text-sm text-gray-700"><FiInfo className="mt-0.5 flex-shrink-0" /><p className="whitespace-pre-wrap">{pedido.notas}</p></div>}

            {visibleColumns.detalle_final && pedido.detalle_final && (
                <div className="mt-4 p-3 bg-blue-50 rounded-md border-l-4 border-blue-400">
                    <div className="flex items-start gap-2 text-sm text-blue-800">
                        <FiArchive className="mt-0.5 flex-shrink-0" />
                        <div>
                            <p className="font-semibold">Detalle Final:</p>
                            <p className="whitespace-pre-wrap break-words">{pedido.detalle_final}</p>
                        </div>
                    </div>
                </div>
            )}

            <div className="mt-4 pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">Acciones</label>
                <ActionsCell pedido={pedido} onDelete={onPedidoDeleted} onUpdateStatus={onPedidoUpdated} onEdit={onEditClick} onShare={onShareClick} userRole={userRole} />
            </div>
        </div>
    );
}

export default function PedidosTable({ pedidos, onPedidoDeleted, onPedidoUpdated, onEditClick, onShareClick, visibleColumns, userRole }: PedidosTableProps) {
    if (pedidos.length === 0) {
        return <p className="mt-8 text-center text-gray-500">No se encontraron pedidos.</p>;
    }
    const getWhatsAppLink = (numero: string | null | undefined) => {
        if (!numero) return '#';
        return `https://wa.me/${numero.replace(/[^0-9]/g, '')}`;
    };

    return (
        <>
            <div className="space-y-4 sm:hidden print:hidden">
                {pedidos.map((pedido) => (
                    <PedidoCard key={pedido.id} pedido={pedido} onPedidoDeleted={onPedidoDeleted} onPedidoUpdated={onPedidoUpdated} onEditClick={onEditClick} onShareClick={onShareClick} visibleColumns={visibleColumns} userRole={userRole} />
                ))}
            </div>

            <div className="hidden sm:block print:block overflow-x-auto bg-white rounded-lg shadow border border-gray-200">
                <table className="min-w-full text-gray-900">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiUser />Cliente</div></th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiPhone />Whatsapp</div></th>
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiMapPin />Dirección</div></th>
                            {visibleColumns.navegacion && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiMap />Navegación</div></th>}
                            {visibleColumns.fecha && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiCalendar />Fecha</div></th>}
                            {visibleColumns.empresa && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiTruck />Empresa</div></th>}
                            {visibleColumns.distrito && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiMap />Distrito</div></th>}
                            {visibleColumns.tipo_cliente && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiTag />Tipo Cliente</div></th>}
                            {visibleColumns.hora_entrega && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiClock />Hora Entrega</div></th>}
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiFileText />Pedido</div></th>
                            {visibleColumns.notas && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiInfo />Notas</div></th>}
                            {visibleColumns.asesor && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiUserCheck />Asesor</div></th>}
                            {visibleColumns.detalle_final && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiArchive />Detalle Final</div></th>}

                            {/* ✅ CORRECCIÓN 3: El encabezado de la columna Estado ahora es condicional */}
                            {visibleColumns.entregado && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiCheckCircle />Estado</div></th>}

                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {pedidos.map((pedido) => (
                            <tr key={pedido.id} className={`hover:bg-gray-50 align-top transition-all ${pedido.entregado ? 'bg-green-50' : ''}`}>
                                <td className="px-4 py-4 whitespace-nowrap">{pedido.cliente}</td>
                                <td className="px-4 py-4 whitespace-nowrap">{pedido.whatsapp ? (<a href={getWhatsAppLink(pedido.whatsapp)} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">{pedido.whatsapp}</a>) : (<span className="text-gray-400">N/A</span>)}</td>
                                <td className="px-4 py-4 max-w-xs"><p className="break-words">{pedido.direccion}</p></td>
                                {visibleColumns.navegacion && <td className="px-4 py-4 whitespace-nowrap">{pedido.latitude && pedido.longitude && (<div className="flex gap-2"><a href={`https://www.google.com/maps/search/?api=1&query=${pedido.latitude},${pedido.longitude}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Maps</a><a href={`https://waze.com/ul?ll=${pedido.latitude},${pedido.longitude}&navigate=yes`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">Waze</a></div>)}</td>}
                                {visibleColumns.fecha && <td className="px-4 py-4 whitespace-nowrap">{pedido.fecha_pedido}</td>}
                                {visibleColumns.empresa && <td className="px-4 py-4 whitespace-nowrap">{pedido.empresa}</td>}
                                {visibleColumns.distrito && <td className="px-4 py-4 whitespace-nowrap">{pedido.distrito}</td>}
                                {visibleColumns.tipo_cliente && <td className="px-4 py-4 whitespace-nowrap">{pedido.tipo_cliente}</td>}
                                {visibleColumns.hora_entrega && <td className="px-4 py-4 whitespace-nowrap">{pedido.hora_entrega}</td>}
                                <td className="px-4 py-4 max-w-sm"><p className="break-words whitespace-pre-wrap">{pedido.detalle}</p></td>
                                {visibleColumns.notas && <td className="px-4 py-4 max-w-sm"><p className="break-words whitespace-pre-wrap">{pedido.notas}</p></td>}
                                {visibleColumns.asesor && <td className="px-4 py-4 whitespace-nowrap">{pedido.asesor_name ?? 'N/A'}</td>}
                                {visibleColumns.detalle_final && <td className="px-4 py-4 max-w-sm"><p className="break-words whitespace-pre-wrap">{pedido.detalle_final}</p></td>}

                                {/* ✅ CORRECCIÓN 3: La celda de la columna Estado ahora es condicional */}
                                {visibleColumns.entregado && <td className="px-4 py-4 whitespace-nowrap"><span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${pedido.entregado ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{pedido.entregado ? 'Entregado' : 'Pendiente'}</span></td>}

                                <td className="px-4 py-4 whitespace-nowrap">
                                    <div className="print:hidden">
                                        <ActionsCell pedido={pedido} onDelete={onPedidoDeleted} onUpdateStatus={onPedidoUpdated} onEdit={onEditClick} onShare={onShareClick} userRole={userRole} />
                                    </div>
                                    <div className="hidden print:block">{pedido.entregado ? 'Entregado' : 'Pendiente'}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}