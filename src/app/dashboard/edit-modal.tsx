// src/app/dashboard/edit-modal.tsx
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Pedido } from '@/lib/types';
import { FiX, FiAlertTriangle, FiFileText } from 'react-icons/fi';
import MapInput from '@/components/MapInput';
import TimeRangePicker from '@/components/TimeRangePicker';
import ProductSelector, { SelectedItem } from '@/components/ProductSelector';

interface EditPedidoModalProps {
    pedido: Pedido;
    isOpen: boolean;
    onClose: () => void;
    onPedidoUpdated: (updatedPedido: Pedido) => void;
}

// P2.11 — Si el pedido ya tiene comprobante emitido (aceptado/pendiente),
// el comprobante no se modifica al editar el pedido. Avisamos arriba para
// que el usuario sepa que necesita emitir una Nota de Crédito si los datos
// del comprobante deben cambiar.
interface ComprobanteRefMini {
    id: string;
    serie_numero: string;
    tipo: string;
    estado: string;
}

const distritos = ['La Victoria', 'Lince', 'San Isidro', 'San Miguel', 'San Borja', 'Breña', 'Surquillo', 'Cercado de Lima', 'Miraflores', 'La Molina', 'Surco', 'Magdalena', 'Jesús María', 'Salamanca', 'Barranco', 'San Luis', 'Santa Beatriz', 'Pueblo Libre'];

export default function EditPedidoModal({ isOpen, onClose, pedido, onPedidoUpdated }: EditPedidoModalProps) {
    const [formData, setFormData] = useState(pedido);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // P2.11 — Comprobante existente para este pedido (si lo hay).
    const [comprobante, setComprobante] = useState<ComprobanteRefMini | null>(null);
    // M1 — Productos estructurados del pedido. Precargamos los pedido_items existentes
    // para que el selector arranque con ellos; al guardar se reemplazan en la DB y el
    // pedido vuelve a contar en el "Resumen del día" y reportes.
    const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
    const [itemsIniciales, setItemsIniciales] = useState<SelectedItem[] | null>(null); // null = cargando
    const [itemsError, setItemsError] = useState(false);

    useEffect(() => {
        if (pedido) {
            // ✅ CORRECCIÓN: Convertimos la fecha de DD/MM/YYYY a YYYY-MM-DD para el input
            const [day, month, year] = pedido.fecha_pedido.split('/');
            const formattedDateForInput = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

            setFormData({
                ...pedido,
                fecha_pedido: formattedDateForInput,
            });
        }
    }, [pedido]);

    // P2.11 — Cuando se abre el modal, consultamos si este pedido ya tiene
    // un comprobante emitido. El endpoint /api/comprobantes acepta pedido_id
    // y aplica scoping por rol; devuelve [] si no hay comprobante o si la
    // asesora no es dueña del pedido.
    useEffect(() => {
        if (!isOpen || !pedido?.id) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/comprobantes?pedido_id=${pedido.id}`);
                if (!res.ok) return;
                const json = await res.json();
                const arr = (json.data ?? []) as ComprobanteRefMini[];
                // Tomamos el más reciente "vivo" (no rechazado/error) — el primero
                // que devuelve la API ya viene ORDER BY created_at DESC.
                const vivo = arr.find(
                    (c) => c.estado !== 'RECHAZADA' && c.estado !== 'ERROR' && c.estado !== 'ANULADO'
                );
                if (!cancelled) setComprobante(vivo ?? null);
            } catch {
                /* silencioso — peor caso no mostramos el banner */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen, pedido?.id]);

    // M1 — Cargar los productos (pedido_items) del pedido para precargar el selector.
    useEffect(() => {
        if (!isOpen || !pedido?.id) return;
        let cancelled = false;
        setItemsIniciales(null);
        setItemsError(false);
        (async () => {
            try {
                const res = await fetch(`/api/pedidos/${pedido.id}`);
                if (!res.ok) throw new Error('No se pudieron cargar los productos');
                const json = await res.json();
                const raw = (json.items ?? []) as Array<{
                    producto_id: string | null;
                    producto_nombre: string;
                    cantidad: string | number;
                    unidad: string | null;
                }>;
                const mapped: SelectedItem[] = raw
                    .filter((it) => it.producto_id)
                    .map((it) => ({
                        productoId: it.producto_id as string,
                        nombre: it.producto_nombre,
                        cantidad: Number(it.cantidad) || 0,
                        unidad: (it.unidad || 'uni').trim(),
                    }))
                    .filter((it) => it.cantidad > 0);
                if (!cancelled) {
                    setItemsIniciales(mapped);
                    setSelectedItems(mapped);
                }
            } catch {
                // Si falla, NO tocaremos pedido_items al guardar (se omite `items` del PATCH).
                if (!cancelled) {
                    setItemsError(true);
                    setItemsIniciales([]);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [isOpen, pedido?.id]);

    if (!isOpen) return null;

    const yaFacturado = !!comprobante;
    const tipoLabel: Record<string, string> = {
        '01': 'Factura',
        '03': 'Boleta',
        '07': 'Nota de Crédito',
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleLocationChange = (lat: number, lng: number) => {
        setFormData(prev => ({ ...prev, latitude: lat, longitude: lng }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSaving(true);
        setError(null);

        const payload: Record<string, unknown> = { ...formData };

        delete payload.id;
        delete payload.created_at;
        delete payload.asesor_name;

        // M1 — Si pudimos cargar los productos, los enviamos para sincronizar pedido_items.
        // Si la carga falló (itemsError), NO mandamos `items` → el PATCH no toca los productos
        // existentes (evita borrarlos por accidente).
        if (!itemsError) {
            payload.items = selectedItems.map((it) => ({
                productoId: it.productoId,
                nombre: it.nombre,
                cantidad: it.cantidad,
                unidad: it.unidad,
            }));
        }

        try {
            const response = await fetch(`/api/pedidos/${pedido.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.toString() || 'Error al guardar los cambios');
            }

            const [year, month, day] = formData.fecha_pedido.split('-');
            const displayDate = `${day}/${month}/${year}`;

            onPedidoUpdated({ ...formData, fecha_pedido: displayDate });
            onClose();

        } catch (err) {
            setError(err instanceof Error ? err.message : 'Ocurrió un error desconocido');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white z-10">
                    <h2 className="text-2xl font-bold text-gray-800">Editar Pedido</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <FiX size={24} />
                    </button>
                </div>

                {/* P2.11 — Aviso post-emisión: si el pedido ya tiene comprobante,
                    los cambios en los datos del cliente / detalle / fecha NO se
                    reflejan en el XML enviado a SUNAT. Para corregir un comprobante
                    se debe emitir una Nota de Crédito (botón directo al detalle). */}
                {yaFacturado && comprobante && (
                    <div className="px-6 pt-4">
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-3">
                            <FiAlertTriangle className="text-amber-600 mt-0.5 flex-shrink-0" size={18} />
                            <div className="text-xs text-amber-900 flex-1">
                                <div className="font-semibold mb-1">
                                    Este pedido ya tiene {tipoLabel[comprobante.tipo] ?? 'comprobante'} emitido ({comprobante.serie_numero}).
                                </div>
                                <p>
                                    Los cambios <strong>no se reflejarán</strong> en el comprobante
                                    enviado a SUNAT. Si necesitas corregir importes, cliente o
                                    detalle del comprobante, emite una <strong>Nota de Crédito</strong>
                                    y vuelve a emitir.
                                </p>
                                <Link
                                    href={`/dashboard/comprobantes?pedido_id=${pedido.id}`}
                                    className="inline-flex items-center gap-1 mt-2 text-amber-800 hover:text-amber-900 font-medium underline underline-offset-2"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <FiFileText size={12} /> Ver comprobante
                                </Link>
                            </div>
                        </div>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Empresa</label>
                        <select name="empresa" value={formData.empresa} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-white">
                            <option value="Transavic">Transavic</option>
                            <option value="Avícola de Tony">Avícola de Tony</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="fecha_pedido" className="block text-sm font-medium text-gray-700">Fecha de Entrega</label>
                        <input id="fecha_pedido" type="date" name="fecha_pedido" value={formData.fecha_pedido} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" required />
                    </div>
                    <div>
                        <label htmlFor="cliente" className="block text-sm font-medium text-gray-700">Cliente</label>
                        <input id="cliente" type="text" name="cliente" value={formData.cliente} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" required />
                    </div>
                    <div>
                        <label htmlFor="razon_social" className="block text-sm font-medium text-gray-700">Razón Social / Nombre Legal</label>
                        <input id="razon_social" type="text" name="razon_social" value={formData.razon_social ?? ''} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" />
                    </div>
                    <div>
                        <label htmlFor="ruc_dni" className="block text-sm font-medium text-gray-700">RUC / DNI</label>
                        <input id="ruc_dni" type="text" name="ruc_dni" value={formData.ruc_dni ?? ''} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" />
                    </div>
                    <div>
                        <label htmlFor="whatsapp" className="block text-sm font-medium text-gray-700">WhatsApp</label>
                        <input id="whatsapp" type="text" name="whatsapp" value={formData.whatsapp ?? ''} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" />
                    </div>
                    <div>
                        <label htmlFor="direccion" className="block text-sm font-medium text-gray-700">Dirección</label>
                        <input id="direccion" type="text" name="direccion" value={formData.direccion ?? ''} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700">Ubicación en Mapa</label>
                        <MapInput
                            onLocationChange={handleLocationChange}
                            initialLat={formData.latitude}
                            initialLng={formData.longitude}
                        />
                    </div>
                    <div>
                        <label htmlFor="distrito" className="block text-sm font-medium text-gray-700">Distrito</label>
                        <select id="distrito" name="distrito" value={formData.distrito ?? ''} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-white">
                            {distritos.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="tipo_cliente" className="block text-sm font-medium text-gray-700">Tipo Cliente</label>
                        <select id="tipo_cliente" name="tipo_cliente" value={formData.tipo_cliente ?? ''} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2 bg-white">
                            <option value="Frecuente">Frecuente</option>
                            <option value="Nuevo">Nuevo</option>
                        </select>
                    </div>
                    {/* M1 — Selección de productos del catálogo, integrada al editor.
                        Precargada con los productos actuales del pedido; al guardar se
                        sincronizan los pedido_items para que el pedido vuelva a contar en
                        el "Resumen del día" y los reportes. */}
                    {!itemsError && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Productos del Catálogo</label>
                            {itemsIniciales === null ? (
                                <div className="text-sm text-gray-400 py-3 px-1">Cargando productos…</div>
                            ) : (
                                <ProductSelector
                                    empresa={formData.empresa}
                                    initialItems={itemsIniciales}
                                    onChange={(items, detalleText) => {
                                        setSelectedItems(items);
                                        if (items.length > 0) {
                                            setFormData(prev => ({ ...prev, detalle: detalleText }));
                                        }
                                    }}
                                />
                            )}
                            <p className="text-xs text-gray-500 mt-1">
                                Elige productos del catálogo para que el pedido cuente en el <strong>Resumen del día</strong> y los reportes. El detalle de abajo se autocompleta; puedes ajustarlo a mano.
                            </p>
                        </div>
                    )}
                    <div>
                        <label htmlFor="detalle" className="block text-sm font-medium text-gray-700">Detalle del Pedido</label>
                        <textarea id="detalle" name="detalle" value={formData.detalle} onChange={handleChange} rows={4} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" required></textarea>
                    </div>
                    <div>
                        <TimeRangePicker
                            value={formData.hora_entrega ?? ''}
                            onChange={(val) => setFormData(prev => ({ ...prev, hora_entrega: val }))}
                        />
                    </div>
                    <div>
                        <label htmlFor="notas" className="block text-sm font-medium text-gray-700">Notas Adicionales</label>
                        <textarea id="notas" name="notas" value={formData.notas ?? ''} onChange={handleChange} rows={3} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2"></textarea>
                    </div>
                    <div>
                        <label htmlFor="detalle_final" className="block text-sm font-medium text-gray-700">Detalle Final (Peso, Observaciones, etc.)</label>
                        <textarea id="detalle_final" name="detalle_final" value={formData.detalle_final ?? ''} onChange={handleChange} rows={3} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2"></textarea>
                    </div>

                    {error && <p className="text-sm text-red-600 bg-red-100 p-3 rounded-md">{error}</p>}

                    <div className="pt-4 flex justify-end gap-3 sticky bottom-0 bg-white pb-6 px-6 -mx-6">
                        <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300">
                            Cancelar
                        </button>
                        <button type="submit" disabled={isSaving} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-blue-400 disabled:cursor-not-allowed">
                            {isSaving ? 'Guardando...' : 'Guardar Cambios'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}