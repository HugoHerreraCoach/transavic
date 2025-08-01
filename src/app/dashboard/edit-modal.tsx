// src/app/dashboard/edit-modal.tsx
'use client';

import { useState, useEffect } from 'react';
import { Pedido } from '@/lib/types';
import { FiX } from 'react-icons/fi';
import MapInput from '@/components/MapInput';

interface EditPedidoModalProps {
    pedido: Pedido;
    isOpen: boolean;
    onClose: () => void;
    onPedidoUpdated: (updatedPedido: Pedido) => void;
}

const distritos = ['La Victoria', 'Lince', 'San Isidro', 'San Miguel', 'San Borja', 'Breña', 'Surquillo', 'Cercado de Lima', 'Miraflores', 'La Molina', 'Surco', 'Magdalena', 'Jesús María', 'Salamanca', 'Barranco', 'San Luis', 'Santa Beatriz', 'Pueblo Libre'];

export default function EditPedidoModal({ isOpen, onClose, pedido, onPedidoUpdated }: EditPedidoModalProps) {
    const [formData, setFormData] = useState(pedido);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

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

    if (!isOpen) return null;

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

        const payload: Partial<Pedido> = { ...formData };

        delete payload.id;
        delete payload.created_at;
        delete payload.asesor_name;

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
                    <div>
                        <label htmlFor="detalle" className="block text-sm font-medium text-gray-700">Detalle del Pedido</label>
                        <textarea id="detalle" name="detalle" value={formData.detalle} onChange={handleChange} rows={4} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" required></textarea>
                    </div>
                    <div>
                        <label htmlFor="hora_entrega" className="block text-sm font-medium text-gray-700">Hora de Entrega</label>
                        <input id="hora_entrega" type="text" name="hora_entrega" value={formData.hora_entrega ?? ''} onChange={handleChange} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm p-2" />
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