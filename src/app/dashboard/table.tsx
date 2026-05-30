// src/app/dashboard/table.tsx
'use client';

import { useState, Suspense, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { Pedido, EstadoPedido } from "@/lib/types";
import { FiTruck, FiUser, FiCalendar, FiFileText, FiPhone, FiEdit, FiTrash2, FiMapPin, FiMap, FiTag, FiClock, FiInfo, FiShare2, FiCheckCircle, FiUserCheck, FiXCircle, FiArchive, FiNavigation, FiPackage, FiAlertTriangle, FiCopy, FiMoreVertical, FiChevronDown, FiDownload } from 'react-icons/fi';
import { useRouter } from 'next/navigation';
import ModalShell from "@/components/ModalShell";
import EmitirComprobanteClient from "./comprobantes/nuevo/emitir-client";
import { descargarPdfComprobante, descargarXmlComprobante, descargarCdrComprobante } from "@/lib/descargar-comprobante";

// Comprobante (forma reducida) que la lista de pedidos necesita para el menú
// "Facturado": id para descargar, serie/estado para mostrar.
type ComprobanteLite = {
    id: string;
    serie_numero: string;
    tipo: string;
    estado: string;
};

type Column = 'distrito' | 'tipo_cliente' | 'hora_entrega' | 'razon_social' | 'ruc_dni' | 'notas' | 'empresa' | 'asesor' | 'entregado' | 'navegacion' | 'fecha' | 'detalle_final';

// ── Estado Badge Helper ──
function getEstadoBadge(estado: EstadoPedido) {
    const configs: Record<EstadoPedido, { bg: string; text: string; label: string; icon: React.ReactNode }> = {
        Pendiente: { bg: 'bg-amber-100', text: 'text-amber-800', label: 'Pendiente', icon: <FiClock className="text-amber-600" /> },
        En_Produccion: { bg: 'bg-purple-100', text: 'text-purple-800', label: 'En Producción', icon: <FiPackage className="text-purple-600" /> },
        Listo_Para_Despacho: { bg: 'bg-teal-100', text: 'text-teal-800', label: 'Listo p/ Despacho', icon: <FiArchive className="text-teal-600" /> },
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
    userRole: string;
    userName: string;
    usuarios: string[];
};

function ActionsCell({ pedido, onDelete, onUpdateStatus, onEdit, onShare, userRole, userName, usuarios }: ActionsCellProps) {
    const router = useRouter();
    const [isProcessing, setIsProcessing] = useState(false);
    const [showDeliverySelector, setShowDeliverySelector] = useState(false);
    const [showEmitirModal, setShowEmitirModal] = useState(false);
    // Comprobantes VÁLIDOS del pedido (aceptado/observado). null = aún no chequeado.
    // Uno rechazado o con error NO cuenta como "Facturado".
    const [comprobantes, setComprobantes] = useState<ComprobanteLite[] | null>(null);
    const [showFacturado, setShowFacturado] = useState(false);
    const [descargando, setDescargando] = useState<string | null>(null);
    const [showMenu, setShowMenu] = useState(false);
    const isAvicola = (pedido.empresa || "").trim().toLowerCase().startsWith("av");
    const yaTieneComprobante = (comprobantes?.length ?? 0) > 0;

    // Trae los comprobantes VÁLIDOS del pedido. Lazy (hover/click) y se refresca
    // al cerrar el modal de emisión (así "Facturado" aparece solo si SUNAT aceptó).
    const cargarComprobantes = useCallback(async () => {
        try {
            const res = await fetch(`/api/comprobantes?pedido_id=${pedido.id}`);
            if (!res.ok) return;
            const j = await res.json();
            const validos: ComprobanteLite[] = (j.data ?? [])
                .filter((c: { estado?: string }) => c.estado === "aceptado" || c.estado === "observado")
                .map((c: ComprobanteLite) => ({
                    id: c.id,
                    serie_numero: c.serie_numero,
                    tipo: c.tipo,
                    estado: c.estado,
                }));
            setComprobantes(validos);
        } catch {
            /* silent */
        }
    }, [pedido.id]);
    const verificarComprobante = () => {
        if (comprobantes === null) void cargarComprobantes();
    };

    // Al montar, chequear el estado SOLO para pedidos facturables → "Facturado"
    // aparece de una al cargar la página (sin necesidad de hover/clic).
    useEffect(() => {
        const facturable =
            userRole !== "repartidor" &&
            ["Entregado", "Listo_Para_Despacho", "Asignado", "En_Produccion"].includes(pedido.estado);
        if (facturable) void cargarComprobantes();
    }, [cargarComprobantes, pedido.estado, userRole]);

    // Descarga PDF / XML / CDR de un comprobante (reusa el helper compartido).
    const descargarComprobante = async (c: ComprobanteLite, fmt: "pdf" | "xml" | "cdr") => {
        setDescargando(c.id + fmt);
        try {
            if (fmt === "pdf") await descargarPdfComprobante(c.id);
            else if (fmt === "xml") await descargarXmlComprobante(c.id, c.serie_numero);
            else await descargarCdrComprobante(c.id, c.serie_numero);
        } catch (e) {
            alert(e instanceof Error ? e.message : "No se pudo descargar");
        } finally {
            setDescargando(null);
        }
    };

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

            <div className="flex items-center justify-end gap-2 relative">
                {/* 1. Botón Principal: Entregar/Anular */}
                <button
                    onClick={handleToggleDelivery}
                    disabled={isProcessing}
                    className={`px-3 py-2 flex items-center justify-center gap-1.5 text-white rounded-lg transition-all text-xs font-bold shadow-sm active:scale-95 cursor-pointer ${
                        isDelivered 
                            ? 'bg-amber-500 hover:bg-amber-600' 
                            : 'bg-teal-600 hover:bg-teal-700'
                    }`}
                >
                    {isDelivered ? <FiXCircle /> : <FiCheckCircle />}
                    <span>{isDelivered ? 'Anular' : 'Entregar'}</span>
                </button>

                {/* 2. Botón Principal: Facturar / Facturado (con color de marca dinámico) */}
                {['Entregado', 'Listo_Para_Despacho', 'Asignado', 'En_Produccion'].includes(pedido.estado) && userRole !== 'repartidor' && (
                    yaTieneComprobante ? (
                        <div className="relative">
                            <button
                                onClick={() => setShowFacturado((v) => !v)}
                                className="px-2.5 py-2 flex items-center justify-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors whitespace-nowrap cursor-pointer"
                                title="Comprobante(s) de este pedido — descargar"
                            >
                                <FiFileText /> Facturado
                                <FiChevronDown size={12} className={`transition-transform ${showFacturado ? 'rotate-180' : ''}`} />
                            </button>
                            {showFacturado && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setShowFacturado(false)} />
                                    <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-gray-100 bg-white p-2 shadow-xl z-20 animate-fade-in origin-top-right">
                                        <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Comprobantes del pedido</p>
                                        {(comprobantes ?? []).map((c) => (
                                            <div key={c.id} className="px-2 py-2 rounded-lg hover:bg-gray-50">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className="text-xs font-bold text-gray-800">{c.serie_numero}</span>
                                                    <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-600"><FiCheckCircle size={11} /> Aceptado</span>
                                                </div>
                                                <div className="flex items-center gap-1 mt-1.5">
                                                    <button onClick={() => descargarComprobante(c, 'pdf')} disabled={descargando === c.id + 'pdf'} className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-bold px-2 py-1 rounded-md bg-red-50 text-red-700 hover:bg-red-100 active:scale-95 transition disabled:opacity-50"><FiDownload size={11} /> PDF</button>
                                                    <button onClick={() => descargarComprobante(c, 'xml')} disabled={descargando === c.id + 'xml'} className="flex-1 text-[11px] font-bold px-2 py-1 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100 active:scale-95 transition disabled:opacity-50">XML</button>
                                                    <button onClick={() => descargarComprobante(c, 'cdr')} disabled={descargando === c.id + 'cdr'} className="flex-1 text-[11px] font-bold px-2 py-1 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 active:scale-95 transition disabled:opacity-50">CDR</button>
                                                </div>
                                            </div>
                                        ))}
                                        <Link href={`/dashboard/comprobantes?pedido_id=${pedido.id}`} className="block mt-1 px-2 py-2 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-50 rounded-lg">Ver en comprobantes →</Link>
                                    </div>
                                </>
                            )}
                        </div>
                    ) : (
                        <button
                            onMouseEnter={verificarComprobante}
                            onClick={() => { verificarComprobante(); setShowEmitirModal(true); }}
                            disabled={isProcessing}
                            className={`px-3 py-2 flex items-center justify-center gap-1.5 text-white rounded-lg transition-all text-xs font-bold shadow-sm active:scale-95 cursor-pointer whitespace-nowrap ${
                                isAvicola 
                                    ? 'bg-amber-500 hover:bg-amber-600' 
                                    : 'bg-red-600 hover:bg-red-700'
                            }`}
                        >
                            <FiFileText /><span>Facturar</span>
                        </button>
                    )
                )}

                {/* 3. Menú de Acciones Secundarias (Stripe/Linear Style Dropdown) */}
                {userRole !== 'repartidor' && (
                    <div className="relative">
                        <button
                            onClick={() => setShowMenu(!showMenu)}
                            className={`p-2 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-all flex items-center justify-center cursor-pointer ${
                                showMenu ? 'bg-gray-100 text-gray-800' : ''
                            }`}
                            title="Acciones adicionales"
                        >
                            <FiMoreVertical size={16} />
                        </button>

                        {showMenu && (
                            <>
                                {/* Click-outside overlay backdrop */}
                                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                                <div className="absolute right-0 mt-1.5 w-44 rounded-xl border border-gray-100 bg-white p-1.5 shadow-xl z-20 flex flex-col gap-0.5 animate-fade-in origin-top-right">
                                    <button
                                        onClick={() => {
                                            setShowMenu(false);
                                            onEdit(pedido);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors text-left cursor-pointer"
                                    >
                                        <FiEdit className="text-gray-400" />
                                        <span>Editar datos</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setShowMenu(false);
                                            onShare(pedido);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors text-left cursor-pointer"
                                    >
                                        <FiShare2 className="text-gray-400" />
                                        <span>Compartir ticket</span>
                                    </button>

                                    <button
                                        onClick={() => {
                                            setShowMenu(false);
                                            const payload = {
                                                cliente: pedido.cliente,
                                                whatsapp: pedido.whatsapp,
                                                direccion: pedido.direccion,
                                                direccionMapa: pedido.direccion,
                                                distrito: pedido.distrito,
                                                tipoCliente: pedido.tipo_cliente,
                                                rucDni: pedido.ruc_dni,
                                                razonSocial: pedido.razon_social,
                                                notas: pedido.notas,
                                                empresa: pedido.empresa,
                                                detalle: pedido.detalle,
                                                latitude: pedido.latitude,
                                                longitude: pedido.longitude,
                                            };
                                            try {
                                                sessionStorage.setItem('transavic.duplicar', JSON.stringify(payload));
                                            } catch {}
                                            router.push('/dashboard/nuevo-pedido');
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors text-left cursor-pointer"
                                    >
                                        <FiCopy className="text-gray-400" />
                                        <span>Duplicar pedido</span>
                                    </button>

                                    {userRole === 'admin' && (
                                        <div className="h-px bg-gray-100 my-1" />
                                    )}

                                    {userRole === 'admin' && (
                                        <button
                                            onClick={() => {
                                                setShowMenu(false);
                                                handleDelete();
                                            }}
                                            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors text-left cursor-pointer"
                                        >
                                            <FiTrash2 className="text-red-400" />
                                            <span>Eliminar</span>
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Emitir comprobante desde el pedido: MISMA pantalla rediseñada que
                /dashboard/comprobantes/nuevo, embebida en un modal para poder
                facturar varios pedidos seguidos sin salir de la lista. */}
            {showEmitirModal && (
                <ModalShell onClose={() => { setShowEmitirModal(false); void cargarComprobantes(); }}>
                    <Suspense fallback={null}>
                        <EmitirComprobanteClient
                            pedidoIdProp={pedido.id}
                            onClose={() => { setShowEmitirModal(false); void cargarComprobantes(); }}
                        />
                    </Suspense>
                </ModalShell>
            )}
        </>
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
    userName: string;
    usuarios: string[];
};

type PedidosTableProps = {
    pedidos: Pedido[];
    onPedidoDeleted: (id: string) => void;
    onPedidoUpdated: (pedido: Pedido) => void;
    onEditClick: (pedido: Pedido) => void;
    onShareClick: (pedido: Pedido) => void;
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

function PedidoCard({ pedido, onPedidoDeleted, onPedidoUpdated, onEditClick, onShareClick, visibleColumns, userRole, userName, usuarios }: PedidoCardProps) {
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
            {visibleColumns.razon_social && pedido.razon_social && <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiArchive /><span>R. Social: {pedido.razon_social}</span></div>}
            {visibleColumns.ruc_dni && pedido.ruc_dni && <div className="mt-3 flex items-center gap-2 text-sm text-gray-700"><FiFileText /><span>RUC/DNI: {pedido.ruc_dni}</span></div>}
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
                <ActionsCell pedido={pedido} onDelete={onPedidoDeleted} onUpdateStatus={onPedidoUpdated} onEdit={onEditClick} onShare={onShareClick} userRole={userRole} userName={userName} usuarios={usuarios} />
            </div>
        </div>
    );
}

export default function PedidosTable({ pedidos, onPedidoDeleted, onPedidoUpdated, onEditClick, onShareClick, visibleColumns, userRole, userName, usuarios }: PedidosTableProps) {
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
                    <PedidoCard key={pedido.id} pedido={pedido} onPedidoDeleted={onPedidoDeleted} onPedidoUpdated={onPedidoUpdated} onEditClick={onEditClick} onShareClick={onShareClick} visibleColumns={visibleColumns} userRole={userRole} userName={userName} usuarios={usuarios} />
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
                            {visibleColumns.razon_social && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiArchive />Razón Social</div></th>}
                            {visibleColumns.ruc_dni && <th className="px-4 py-3 text-left text-sm font-semibold text-gray-600"><div className="flex items-center gap-2"><FiFileText />RUC/DNI</div></th>}
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
                                {visibleColumns.razon_social && <td className="px-4 py-4 whitespace-nowrap">{pedido.razon_social || <span className="text-gray-400">—</span>}</td>}
                                {visibleColumns.ruc_dni && <td className="px-4 py-4 whitespace-nowrap">{pedido.ruc_dni || <span className="text-gray-400">—</span>}</td>}
                                <td className="px-4 py-4 max-w-sm"><p className="break-words whitespace-pre-wrap line-clamp-3" title={pedido.detalle}>{pedido.detalle}</p></td>
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
                                        <ActionsCell pedido={pedido} onDelete={onPedidoDeleted} onUpdateStatus={onPedidoUpdated} onEdit={onEditClick} onShare={onShareClick} userRole={userRole} userName={userName} usuarios={usuarios} />
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