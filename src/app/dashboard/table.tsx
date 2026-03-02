// src/app/dashboard/table.tsx
'use client';

import { useState } from 'react';
import { Pedido, EstadoPedido } from "@/lib/types";
import { FiTruck, FiUser, FiCalendar, FiFileText, FiPhone, FiEdit, FiTrash2, FiMapPin, FiMap, FiTag, FiClock, FiInfo, FiShare2, FiCheckCircle, FiUserCheck, FiXCircle, FiArchive, FiNavigation, FiPackage, FiAlertTriangle } from 'react-icons/fi';

type Column = 'distrito' | 'tipo_cliente' | 'hora_entrega' | 'notas' | 'empresa' | 'asesor' | 'entregado' | 'navegacion' | 'fecha' | 'detalle_final';

// ── Estado Badge Helper ──
function getEstadoBadge(estado: EstadoPedido) {
    const configs: Record<EstadoPedido, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
        Pendiente: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pendiente', icon: <FiClock className="text-amber-600" /> },
        Asignado: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Asignado', icon: <FiPackage className="text-blue-600" /> },
        En_Camino: { bg: 'bg-indigo-100', text: 'text-indigo-800', label: 'En Camino', icon: <FiNavigation className="text-indigo-600" /> },
        Entregado: { bg: 'bg-green-100', text: 'text-green-800', label: 'Entregado', icon: <FiCheckCircle className="text-green-600" /> },
        Fallido: { bg: 'bg-red-100', text: 'text-red-800', label: 'No Entregado', icon: <FiXCircle className="text-red-600" /> },
    };
    return configs[estado] || configs.Pendiente;
}

function EstadoBadge({ estado, repartidorName, razonFallo }: { estado: EstadoPedido; repartidorName?: string | null; razonFallo?: string | null }) {
    const config = getEstadoBadge(estado);
    return (
        <div>
            <span className={`px-2.5 py-1 inline-flex items-center gap-1.5 text-xs leading-5 font-semibold rounded-full ${config.bg} ${config.text}`}>
                {config.icon}
                {config.label}
            </span>
            {repartidorName && (estado === 'Asignado' || estado === 'En_Camino') && (
                <span className="block text-xs text-gray-500 mt-1">🏍️ {repartidorName}</span>
            )}
            {estado === 'Entregado' && repartidorName && (
                <span className="block text-xs text-gray-500 mt-1">por {repartidorName}</span>
            )}
            {estado === 'Fallido' && razonFallo && (
                <span className="block text-xs text-red-500 mt-1" title={razonFallo}>
                    <FiAlertTriangle className="inline mr-1" size={10} />
                    {razonFallo.length > 30 ? razonFallo.substring(0, 30) + '...' : razonFallo}
                </span>
            )}
        </div>
    );
}

type ActionsCellProps = {
    pedido: Pedido;
    onDelete: (id: string) => void;
    onUpdateStatus: (pedido: Pedido) => void;
    onEdit: (pedido: Pedido) => void;
    onShare: (pedido: Pedido) => void;
    onPesoClick: (pedido: Pedido) => void;
    userRole: string;
    userName: string;
    usuarios: string[];
};

function ActionsCell({ pedido, onDelete, onUpdateStatus, onEdit, onShare, onPesoClick, userRole, userName, usuarios }: ActionsCellProps) {
    const [isProcessing, setIsProcessing] = useState(false);
    const [showDeliverySelector, setShowDeliverySelector] = useState(false);

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

    const executeDelivery = async (deliveredBy?: string) => {
        setIsProcessing(true);
        setShowDeliverySelector(false);
        const isCurrentlyDelivered = pedido.estado === 'Entregado';
        const newEstado = isCurrentlyDelivered ? 'Pendiente' : 'Entregado';
        const finalName = deliveredBy || userName;

        try {
            const body: Record<string, unknown> = { estado: newEstado };
            if (newEstado === 'Entregado' && deliveredBy) {
                body.entregado_por = deliveredBy;
            }
            const response = await fetch(`/api/pedidos/${pedido.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!response.ok) throw new Error('Error al actualizar');
            onUpdateStatus({
                ...pedido,
                estado: newEstado as EstadoPedido,
                entregado: newEstado === 'Entregado',
                entregado_por: newEstado === 'Entregado' ? finalName : null,
                entregado_at: newEstado === 'Entregado' ? new Date().toISOString() : null,
            });
        } catch {
            alert("No se pudo actualizar el estado del pedido.");
        } finally {
            setIsProcessing(false);
        }
    };

    const handleToggleDelivery = () => {
        if (isProcessing) return;
        if (userRole === 'admin' && pedido.estado !== 'Entregado') {
            setShowDeliverySelector(true);
        } else {
            executeDelivery();
        }
    };

    const isDelivered = pedido.estado === 'Entregado';

    return (
        <>
            {/* Modal selector de repartidor para admin */}
            {showDeliverySelector && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setShowDeliverySelector(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <div className="px-5 pt-5 pb-3">
                            <h3 className="text-base font-bold text-gray-800">¿Quién realizó la entrega?</h3>
                            <p className="text-xs text-gray-500 mt-0.5">Pedido de <span className="font-semibold">{pedido.cliente}</span></p>
                        </div>
                        <div className="px-3 pb-2 max-h-64 overflow-y-auto">
                            {usuarios.map((nombre) => (
                                <button
                                    key={nombre}
                                    onClick={() => executeDelivery(nombre)}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-teal-50 transition-colors group"
                                >
                                    <span className="flex-shrink-0 w-9 h-9 rounded-full bg-teal-100 text-teal-700 font-bold text-sm flex items-center justify-center group-hover:bg-teal-200 transition-colors">
                                        {nombre.charAt(0).toUpperCase()}
                                    </span>
                                    <span className="text-sm font-medium text-gray-700 group-hover:text-teal-700 transition-colors">{nombre}</span>
                                </button>
                            ))}
                        </div>
                        <div className="px-5 py-3 border-t border-gray-100">
                            <button
                                onClick={() => setShowDeliverySelector(false)}
                                className="w-full py-2 text-sm font-medium text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
                <button onClick={handleToggleDelivery} disabled={isProcessing} className={`p-2 w-full sm:w-auto flex items-center justify-center gap-2 text-white rounded-lg transition-colors text-xs sm:text-sm ${isDelivered ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-teal-500 hover:bg-teal-600'}`}>
                    {isDelivered ? <FiXCircle /> : <FiCheckCircle />}
                    <span>{isDelivered ? 'Anular' : 'Entregar'}</span>
                </button>
                {userRole !== 'repartidor' && (
                    <button onClick={() => onEdit(pedido)} disabled={isProcessing} className="p-2 w-full sm:w-auto flex items-center justify-center gap-2 text-white rounded-lg bg-blue-500 hover:bg-blue-600 transition-colors text-xs sm:text-sm">
                        <FiEdit /><span>Editar</span>
                    </button>
                )}
                <button onClick={() => onShare(pedido)} disabled={isProcessing} className="p-2 w-full sm:w-auto flex items-center justify-center gap-2 text-white rounded-lg bg-green-500 hover:bg-green-600 transition-colors text-xs sm:text-sm">
                    <FiShare2 /><span>Compartir</span>
                </button>
                <button onClick={() => onPesoClick(pedido)} disabled={isProcessing} className="p-2 w-full sm:w-auto flex items-center justify-center gap-2 text-white rounded-lg bg-orange-500 hover:bg-orange-600 transition-colors text-xs sm:text-sm">
                    <span>⚖️ Peso</span>
                </button>
                {userRole !== 'repartidor' && (
                    <button onClick={handleDelete} disabled={isProcessing} className="p-2 w-full sm:w-auto flex items-center justify-center text-white rounded-lg bg-red-500 hover:bg-red-600 transition-colors">
                        <FiTrash2 />
                    </button>
                )}
            </div>
        </>
    );
}

type PedidoCardProps = {
    pedido: Pedido;
    onPedidoDeleted: (id: string) => void;
    onPedidoUpdated: (pedido: Pedido) => void;
    onEditClick: (pedido: Pedido) => void;
    onShareClick: (pedido: Pedido) => void;
    onPesoClick: (pedido: Pedido) => void;
    visibleColumns: Record<Column, boolean>;
    userRole: string;
    userName: string;
    usuarios: string[];
};

type PedidosTableProps = {
    pedidos: Pedido[];
    onPedidoDeleted: (id: string) => void;
    onPedidoUpdated: (pedido: Pedido) => void;
    onEditClick: (pedido: Pedido) => void;
    onShareClick: (pedido: Pedido) => void;
    onPesoClick: (pedido: Pedido) => void;
    visibleColumns: Record<Column, boolean>;
    userRole: string;
    userName: string;
    usuarios: string[];
};

function getRowBgClass(estado: EstadoPedido): string {
    switch (estado) {
        case 'Entregado': return 'bg-green-50';
        case 'Fallido': return 'bg-red-50';
        case 'En_Camino': return 'bg-indigo-50';
        case 'Asignado': return 'bg-blue-50';
        default: return '';
    }
}

function PedidoCard({ pedido, onPedidoDeleted, onPedidoUpdated, onEditClick, onShareClick, onPesoClick, visibleColumns, userRole, userName, usuarios }: PedidoCardProps) {
    const getWhatsAppLink = (numero: string | null | undefined) => {
        if (!numero) return '#';
        return `https://wa.me/${numero.replace(/[^0-9]/g, '')}`;
    };
    const whatsappLink = getWhatsAppLink(pedido.whatsapp);

    return (
        <div className={`bg-white rounded-lg shadow-md p-4 border border-gray-200 transition-all ${getRowBgClass(pedido.estado)}`}>
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

            {/* Estado con badge de 5 estados */}
            {visibleColumns.entregado && (
                <div className="mt-3">
                    <EstadoBadge
                        estado={pedido.estado}
                        repartidorName={pedido.repartidor_name || pedido.entregado_por}
                        razonFallo={pedido.razon_fallo}
                    />
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
                <ActionsCell pedido={pedido} onDelete={onPedidoDeleted} onUpdateStatus={onPedidoUpdated} onEdit={onEditClick} onShare={onShareClick} onPesoClick={onPesoClick} userRole={userRole} userName={userName} usuarios={usuarios} />
            </div>
        </div>
    );
}

export default function PedidosTable({ pedidos, onPedidoDeleted, onPedidoUpdated, onEditClick, onShareClick, onPesoClick, visibleColumns, userRole, userName, usuarios }: PedidosTableProps) {
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
                    <PedidoCard key={pedido.id} pedido={pedido} onPedidoDeleted={onPedidoDeleted} onPedidoUpdated={onPedidoUpdated} onEditClick={onEditClick} onShareClick={onShareClick} onPesoClick={onPesoClick} visibleColumns={visibleColumns} userRole={userRole} userName={userName} usuarios={usuarios} />
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
                            {visibleColumns.entregado && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiCheckCircle />Estado</div></th>}
                            <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600">Acciones</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                        {pedidos.map((pedido) => (
                            <tr key={pedido.id} className={`hover:bg-gray-50 align-top transition-all ${getRowBgClass(pedido.estado)}`}>
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

                                {visibleColumns.entregado && (
                                    <td className="px-4 py-4 whitespace-nowrap">
                                        <EstadoBadge
                                            estado={pedido.estado}
                                            repartidorName={pedido.repartidor_name || pedido.entregado_por}
                                            razonFallo={pedido.razon_fallo}
                                        />
                                    </td>
                                )}

                                <td className="px-4 py-4 whitespace-nowrap">
                                    <div className="print:hidden">
                                        <ActionsCell pedido={pedido} onDelete={onPedidoDeleted} onUpdateStatus={onPedidoUpdated} onEdit={onEditClick} onShare={onShareClick} onPesoClick={onPesoClick} userRole={userRole} userName={userName} usuarios={usuarios} />
                                    </div>
                                    <div className="hidden print:block">{pedido.estado}</div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </>
    );
}