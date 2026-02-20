// src/app/dashboard/productos/productos-client.tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Producto } from '@/lib/types';
import { FiPlus, FiEdit2, FiTrash2, FiCheck, FiX, FiSearch, FiPackage } from 'react-icons/fi';

const DEFAULT_EMOJIS: Record<string, string> = {
  Pollo: '🐔',
  Carnes: '🥩',
  Huevos: '🥚',
};

const DEFAULT_COLORS: Record<string, { badge: string }> = {
  Pollo: { badge: 'bg-amber-100 text-amber-700' },
  Carnes: { badge: 'bg-red-100 text-red-700' },
  Huevos: { badge: 'bg-yellow-100 text-yellow-700' },
};

const COMMON_UNITS = ['uni', 'kg', 'plancha', 'caja'];

export default function ProductosClient() {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoriaActiva, setCategoriaActiva] = useState('Todos');
  const [busqueda, setBusqueda] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ nombre: '', unidad: '', categoria: '' });
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ nombre: '', categoria: '', customCategoria: '' });
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const customUnitRef = useRef<HTMLInputElement>(null);

  // Derive categories dynamically from products
  const allCategories = Array.from(new Set(productos.map(p => p.categoria))).sort();

  const fetchProductos = useCallback(async () => {
    try {
      const res = await fetch('/api/productos');
      const { data } = await res.json();
      setProductos(data);
    } catch (err) {
      console.error('Error al cargar productos:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProductos(); }, [fetchProductos]);

  const filteredProducts = productos.filter(p => {
    const matchCategoria = categoriaActiva === 'Todos' || p.categoria === categoriaActiva;
    const matchBusqueda = !busqueda || p.nombre.toLowerCase().includes(busqueda.toLowerCase());
    return matchCategoria && matchBusqueda;
  });

  const conteos: Record<string, number> = {
    Todos: productos.length,
    ...Object.fromEntries(allCategories.map(cat => [cat, productos.filter(p => p.categoria === cat).length])),
  };

  const startEdit = (p: Producto) => {
    setEditingId(p.id);
    setEditForm({ nombre: p.nombre, unidad: p.unidad, categoria: p.categoria });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({ nombre: '', unidad: '', categoria: '' });
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/productos/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Error desconocido');
      }
      const { data } = await res.json();
      setProductos(prev => prev.map(p => p.id === id ? data : p));
      setEditingId(null);
    } catch (err) {
      alert('Error al guardar: ' + (err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const deleteProduct = async (product: Producto) => {
    if (!confirm(`¿Desactivar "${product.nombre}"? No aparecerá más en el catálogo.`)) return;
    try {
      const res = await fetch(`/api/productos/${product.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error || 'Error desconocido');
      }
      setProductos(prev => prev.filter(p => p.id !== product.id));
    } catch (err) {
      alert('Error al desactivar: ' + (err instanceof Error ? err.message : err));
    }
  };

  const addProduct = async () => {
    const unidadFinal = selectedUnits.join('/');
    const categoriaFinal = newProduct.categoria === '__custom__' ? newProduct.customCategoria.trim() : newProduct.categoria;
    if (!newProduct.nombre.trim() || !unidadFinal || !categoriaFinal) {
      alert('Nombre, unidad y categoría son obligatorios.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/productos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: newProduct.nombre, unidad: unidadFinal, categoria: categoriaFinal }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(typeof errBody.error === 'string' ? errBody.error : JSON.stringify(errBody.error));
      }
      const { data } = await res.json();
      setProductos(prev => [...prev, data]);
      setShowAddModal(false);
      setNewProduct({ nombre: '', categoria: allCategories[0] || 'Pollo', customCategoria: '' });
      setSelectedUnits([]);
    } catch (err) {
      alert('Error al agregar: ' + (err instanceof Error ? err.message : err));
    } finally {
      setSaving(false);
    }
  };

  const addCustomUnit = () => {
    const val = customUnitRef.current?.value.trim().toLowerCase();
    if (val && !selectedUnits.includes(val)) {
      setSelectedUnits(prev => [...prev, val]);
      if (customUnitRef.current) customUnitRef.current.value = '';
    }
  };

  const getEmoji = (cat: string) => DEFAULT_EMOJIS[cat] || '📦';
  const getBadgeClass = (cat: string) => DEFAULT_COLORS[cat]?.badge || 'bg-gray-100 text-gray-700';

  // Initialize default category when modal opens
  const openAddModal = () => {
    setNewProduct({ nombre: '', categoria: allCategories[0] || 'Pollo', customCategoria: '' });
    setSelectedUnits([]);
    setShowAddModal(true);
  };

  if (loading) {
    return (
      <main className="bg-white max-w-[1200px] mx-auto p-4 sm:p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-48" />
          <div className="h-12 bg-gray-200 rounded" />
          <div className="space-y-3">{[1, 2, 3, 4, 5].map(i => <div key={i} className="h-16 bg-gray-100 rounded" />)}</div>
        </div>
      </main>
    );
  }

  return (
    <main className="bg-white max-w-[1200px] mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 flex items-center gap-2">
            <FiPackage className="text-red-600" />
            Catálogo de Productos
          </h1>
          <p className="text-gray-500 mt-1">{productos.length} productos en total</p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center justify-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-lg hover:bg-red-700 transition-colors font-medium shadow-sm"
        >
          <FiPlus />
          Agregar Producto
        </button>
      </div>

      {/* Search + Dynamic Category Tabs */}
      <div className="space-y-4 mb-6">
        <div className="relative">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar producto..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none text-gray-900"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {['Todos', ...allCategories].map(cat => (
            <button
              key={cat}
              onClick={() => setCategoriaActiva(cat)}
              className={`px-4 py-2 rounded-lg font-medium text-sm transition-all ${
                categoriaActiva === cat
                  ? 'bg-red-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {cat !== 'Todos' && <span className="mr-1">{getEmoji(cat)}</span>}
              {cat}
              <span className="ml-1.5 text-xs opacity-80">({conteos[cat] || 0})</span>
            </button>
          ))}
        </div>
      </div>

      {/* Products Table */}
      {filteredProducts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <FiPackage className="mx-auto mb-3" size={48} />
          <p className="text-lg">No se encontraron productos</p>
        </div>
      ) : (
        <>
          {/* Mobile Cards */}
          <div className="space-y-3 sm:hidden">
            {filteredProducts.map(p => (
              <div key={p.id} className="rounded-lg border p-4 bg-white border-gray-200">
                {editingId === p.id ? (
                  <div className="space-y-3">
                    <input
                      value={editForm.nombre}
                      onChange={e => setEditForm(prev => ({ ...prev, nombre: e.target.value }))}
                      className="w-full p-2 border rounded text-sm text-gray-900"
                    />
                    <div className="flex gap-2">
                      <input
                        value={editForm.unidad}
                        onChange={e => setEditForm(prev => ({ ...prev, unidad: e.target.value }))}
                        className="flex-1 p-2 border rounded text-sm text-gray-900"
                        placeholder="Unidad"
                      />
                      <select
                        value={editForm.categoria}
                        onChange={e => setEditForm(prev => ({ ...prev, categoria: e.target.value }))}
                        className="p-2 border rounded text-sm bg-white text-gray-900"
                      >
                        {allCategories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveEdit(p.id)} disabled={saving} className="flex-1 flex items-center justify-center gap-1 bg-green-600 text-white py-2 rounded text-sm">
                        <FiCheck /> Guardar
                      </button>
                      <button onClick={cancelEdit} className="flex-1 flex items-center justify-center gap-1 bg-gray-400 text-white py-2 rounded text-sm">
                        <FiX /> Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="font-medium text-gray-800">{getEmoji(p.categoria)} {p.nombre}</p>
                      <div className="flex gap-1.5 mt-1">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${getBadgeClass(p.categoria)}`}>
                          {p.categoria}
                        </span>
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                          {p.unidad}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(p)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"><FiEdit2 size={16} /></button>
                      <button onClick={() => deleteProduct(p)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg"><FiTrash2 size={16} /></button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Producto</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Categoría</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Unidad</th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProducts.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    {editingId === p.id ? (
                      <>
                        <td className="px-6 py-3">
                          <input value={editForm.nombre} onChange={e => setEditForm(prev => ({ ...prev, nombre: e.target.value }))} className="w-full p-2 border rounded text-sm text-gray-900" />
                        </td>
                        <td className="px-6 py-3">
                          <select value={editForm.categoria} onChange={e => setEditForm(prev => ({ ...prev, categoria: e.target.value }))} className="p-2 border rounded text-sm bg-white text-gray-900">
                            {allCategories.map(cat => (
                              <option key={cat} value={cat}>{getEmoji(cat)} {cat}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-6 py-3">
                          <input value={editForm.unidad} onChange={e => setEditForm(prev => ({ ...prev, unidad: e.target.value }))} className="w-full p-2 border rounded text-sm text-gray-900" />
                        </td>
                        <td className="px-6 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button onClick={() => saveEdit(p.id)} disabled={saving} className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-sm hover:bg-green-700">
                              <FiCheck size={14} /> {saving ? '...' : 'Guardar'}
                            </button>
                            <button onClick={cancelEdit} className="flex items-center gap-1 px-3 py-1.5 bg-gray-400 text-white rounded text-sm hover:bg-gray-500">
                              <FiX size={14} /> Cancelar
                            </button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-6 py-4 text-sm text-gray-900 font-medium">
                          <span className="mr-2">{getEmoji(p.categoria)}</span>
                          {p.nombre}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-medium ${getBadgeClass(p.categoria)}`}>
                            {p.categoria}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{p.unidad}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1">
                            <button onClick={() => startEdit(p)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                              <FiEdit2 size={16} />
                            </button>
                            <button onClick={() => deleteProduct(p)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="Desactivar">
                              <FiTrash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Add Product Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex justify-center items-center p-4" onClick={() => setShowAddModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b flex justify-between items-center sticky top-0 bg-white rounded-t-xl">
              <h2 className="text-xl font-bold text-gray-800">Agregar Producto</h2>
              <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-gray-800"><FiX size={22} /></button>
            </div>
            <div className="p-6 space-y-5">
              {/* Nombre */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre del producto *</label>
                <input
                  type="text"
                  value={newProduct.nombre}
                  onChange={e => setNewProduct(prev => ({ ...prev, nombre: e.target.value }))}
                  placeholder="Ej: Pollo entero con menudencia"
                  className="w-full p-3 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400"
                  autoFocus
                />
              </div>

              {/* Categoría */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Categoría *</label>
                <select
                  value={newProduct.categoria}
                  onChange={e => setNewProduct(prev => ({ ...prev, categoria: e.target.value }))}
                  className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-900"
                >
                  {allCategories.map(cat => (
                    <option key={cat} value={cat}>{getEmoji(cat)} {cat}</option>
                  ))}
                  <option value="__custom__">➕ Nueva categoría...</option>
                </select>
                {newProduct.categoria === '__custom__' && (
                  <input
                    type="text"
                    value={newProduct.customCategoria}
                    onChange={e => setNewProduct(prev => ({ ...prev, customCategoria: e.target.value }))}
                    placeholder="Nombre de la nueva categoría"
                    className="w-full mt-2 p-3 border border-gray-300 rounded-lg text-gray-900 placeholder:text-gray-400"
                    autoFocus
                  />
                )}
              </div>

              {/* Unidades */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Unidades de venta *</label>
                <p className="text-xs text-gray-400 mb-2">Selecciona una o más. Toca para agregar/quitar.</p>
                <div className="flex flex-wrap gap-2">
                  {COMMON_UNITS.map(unit => {
                    const isActive = selectedUnits.includes(unit);
                    return (
                      <button
                        key={unit}
                        type="button"
                        onClick={() => {
                          setSelectedUnits(prev =>
                            isActive ? prev.filter(u => u !== unit) : [...prev, unit]
                          );
                        }}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                          isActive
                            ? 'bg-red-600 text-white border-red-600 shadow-md'
                            : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                        }`}
                      >
                        {isActive && <span className="mr-1">✓</span>}
                        {unit}
                      </button>
                    );
                  })}
                  {/* Custom units already added */}
                  {selectedUnits.filter(u => !COMMON_UNITS.includes(u)).map(unit => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => setSelectedUnits(prev => prev.filter(u => u !== unit))}
                      className="px-4 py-2 rounded-lg text-sm font-medium border-2 bg-red-600 text-white border-red-600 shadow-md transition-all hover:bg-red-700"
                      title="Click para quitar"
                    >
                      ✓ {unit} ×
                    </button>
                  ))}
                </div>
                {/* Custom unit input */}
                <div className="flex gap-2 mt-2">
                  <input
                    ref={customUnitRef}
                    type="text"
                    placeholder="Otra unidad..."
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder:text-gray-400"
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addCustomUnit();
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={addCustomUnit}
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 border border-gray-300 transition-colors"
                  >
                    + Agregar
                  </button>
                </div>
                {selectedUnits.length > 0 && (
                  <p className="mt-2 text-xs text-green-600 font-medium">
                    Se guardará como: <span className="font-bold">{selectedUnits.join('/')}</span>
                  </p>
                )}
              </div>
            </div>
            <div className="p-6 border-t flex gap-3 justify-end sticky bottom-0 bg-white rounded-b-xl">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2.5 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium">
                Cancelar
              </button>
              <button onClick={addProduct} disabled={saving} className="px-6 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:bg-gray-400">
                {saving ? 'Guardando...' : 'Agregar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
