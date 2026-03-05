// src/app/dashboard/clientes/clientes-client.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import { FiSearch, FiEdit2, FiTrash2, FiSave, FiX, FiPlus, FiUsers, FiPhone, FiMapPin, FiMap, FiClock, FiInfo, FiTruck, FiClipboard, FiChevronUp, FiRepeat } from 'react-icons/fi';
import MapInput from '@/components/MapInput';
import TimeRangePicker from '@/components/TimeRangePicker';

const distritos = ['La Victoria', 'Lince', 'San Isidro', 'San Miguel', 'San Borja', 'Breña', 'Surquillo', 'Cercado de Lima', 'Miraflores', 'La Molina', 'Surco', 'Magdalena', 'Jesús María', 'Salamanca', 'Barranco', 'San Luis', 'Santa Beatriz', 'Pueblo Libre'];

interface Asesora {
  id: string;
  name: string;
}

interface Cliente {
  id: string;
  nombre: string;
  razon_social: string | null;
  ruc_dni: string | null;
  whatsapp: string | null;
  direccion: string | null;
  direccion_mapa: string | null;
  distrito: string | null;
  tipo_cliente: string | null;
  hora_entrega: string | null;
  notas: string | null;
  empresa: string | null;
  latitude: number | null;
  longitude: number | null;
  asesor_id: string | null;
  asesor_name: string | null;
  created_at: string;
  updated_at: string;
}

type ClienteForm = Partial<Cliente>;

interface ClientesClientProps {
  userId: string;
  userName: string;
  userRole: string;
}

// Extracted as a top-level component to prevent remounting on every keystroke
function ClienteFormFields({ form, setForm, asesoras, userRole }: { form: ClienteForm; setForm: React.Dispatch<React.SetStateAction<ClienteForm>>; asesoras: Asesora[]; userRole: string }) {
  // Use functional updater to avoid stale closures (critical for MapInput)
  const updateField = (field: string, value: unknown) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Nombre *</label>
          <input value={form.nombre ?? ''} onChange={e => updateField('nombre', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" placeholder="Nombre del cliente" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Razón Social</label>
          <input value={form.razon_social ?? ''} onChange={e => updateField('razon_social', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" placeholder="Razón Social / Nombre Legal" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">RUC / DNI</label>
          <input value={form.ruc_dni ?? ''} onChange={e => updateField('ruc_dni', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" placeholder="RUC o DNI" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">WhatsApp</label>
          <input type="tel" inputMode="numeric" value={form.whatsapp ?? ''} onChange={e => updateField('whatsapp', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" placeholder="Número de WhatsApp" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Dirección</label>
          <input value={form.direccion ?? ''} onChange={e => updateField('direccion', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" placeholder="Dirección de Entrega" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Distrito</label>
          <select value={form.distrito ?? 'La Victoria'} onChange={e => updateField('distrito', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500">
            {distritos.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Tipo de Cliente</label>
          <select value={form.tipo_cliente ?? 'Frecuente'} onChange={e => updateField('tipo_cliente', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500">
            <option value="Frecuente">Frecuente</option>
            <option value="Nuevo">Nuevo</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Empresa</label>
          <select value={form.empresa ?? 'Transavic'} onChange={e => updateField('empresa', e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500">
            <option value="Transavic">Transavic</option>
            <option value="Avícola de Tony">Avícola de Tony</option>
          </select>
        </div>
        {/* Selector de asesora — visible para admin */}
        {userRole === 'admin' && asesoras.length > 0 && (
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Asesora</label>
            <select
              value={form.asesor_id ?? ''}
              onChange={e => updateField('asesor_id', e.target.value || null)}
              className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500"
            >
              <option value="">Sin asignar</option>
              {asesoras.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
        <div>
          <TimeRangePicker
            value={form.hora_entrega ?? ''}
            onChange={(val) => updateField('hora_entrega', val)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Observaciones / Notas</label>
          <textarea value={form.notas ?? ''} onChange={e => updateField('notas', e.target.value)} rows={3} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" placeholder="Notas u observaciones sobre este cliente..." />
        </div>
      </div>
      <div className="mt-3">
        <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación en el Mapa (opcional)</label>
        <MapInput
          initialLat={form.latitude}
          initialLng={form.longitude}
          initialAddress={form.direccion_mapa}
          onLocationChange={(lat, lng) => setForm(prev => ({ ...prev, latitude: lat, longitude: lng }))}
          onAddressChange={(addr) => setForm(prev => ({ ...prev, direccion_mapa: addr, ...(!prev.direccion ? { direccion: addr } : {}) }))}
        />
      </div>
    </>
  );
}

export default function ClientesClient({ userId, userName, userRole }: ClientesClientProps) {
  const isAdmin = userRole === 'admin';
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [asesoras, setAsesoras] = useState<Asesora[]>([]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalClientes, setTotalClientes] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ClienteForm>({});
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState<ClienteForm>({ distrito: 'La Victoria', tipo_cliente: 'Frecuente', empresa: 'Transavic', asesor_id: userId });
  const [creating, setCreating] = useState(false);
  const [historyClienteId, setHistoryClienteId] = useState<string | null>(null);
  const [historyPedidos, setHistoryPedidos] = useState<Record<string, unknown[]>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [filterAsesorId, setFilterAsesorId] = useState<string>('');
  // Transfer modal
  const [transferClienteId, setTransferClienteId] = useState<string | null>(null);
  const [transferTargetId, setTransferTargetId] = useState<string>('');
  const [transferring, setTransferring] = useState(false);
  const ITEMS_PER_PAGE = 15;

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setCurrentPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const fetchClientes = useCallback(async (page: number, searchTerm: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(ITEMS_PER_PAGE) });
      if (searchTerm) params.set('search', searchTerm);
      if (isAdmin && filterAsesorId) params.set('asesor_id', filterAsesorId);
      const res = await fetch(`/api/clientes?${params}`);
      if (res.ok) {
        const json = await res.json();
        setClientes(json.data);
        setTotalPages(json.pagination.totalPages);
        setTotalClientes(json.pagination.total);
        setCurrentPage(json.pagination.currentPage);
        if (json.asesoras) setAsesoras(json.asesoras);
      }
    } catch (err) {
      console.error('Error cargando clientes:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, filterAsesorId]);

  useEffect(() => { fetchClientes(currentPage, debouncedSearch); }, [currentPage, debouncedSearch, fetchClientes]);

  const startEdit = (cliente: Cliente) => {
    setEditingId(cliente.id);
    setEditForm({ ...cliente });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/clientes/${editingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });
      if (res.ok) {
        const updated = await res.json();
        setClientes(prev => prev.map(c => c.id === editingId ? updated : c));
        setEditingId(null);
        setEditForm({});
      } else {
        const err = await res.json();
        alert(err.error || 'Error al guardar');
      }
    } catch {
      alert('Error de conexión');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (!window.confirm(`¿Eliminar al cliente "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      const res = await fetch(`/api/clientes/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setClientes(prev => prev.filter(c => c.id !== id));
      } else {
        const err = await res.json();
        alert(err.error || 'Error al eliminar');
      }
    } catch {
      alert('Error de conexión');
    }
  };

  const handleCreate = async () => {
    if (!createForm.nombre?.trim()) {
      alert('El nombre del cliente es obligatorio');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/clientes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });
      if (res.ok) {
        const newCliente = await res.json();
        setClientes(prev => [newCliente, ...prev]);
        setShowCreateForm(false);
        setCreateForm({ distrito: 'La Victoria', tipo_cliente: 'Frecuente', empresa: 'Transavic', asesor_id: userId });
      } else {
        alert('Error al crear cliente');
      }
    } catch {
      alert('Error de conexión');
    } finally {
      setCreating(false);
    }
  };

  const toggleHistory = async (clienteId: string) => {
    if (historyClienteId === clienteId) {
      setHistoryClienteId(null);
      return;
    }
    setHistoryClienteId(clienteId);
    if (historyPedidos[clienteId]) return;
    setLoadingHistory(true);
    try {
      const res = await fetch(`/api/clientes/${clienteId}/pedidos`);
      if (res.ok) {
        const data = await res.json();
        setHistoryPedidos(prev => ({ ...prev, [clienteId]: data }));
      }
    } catch {
      console.error('Error fetching history');
    } finally {
      setLoadingHistory(false);
    }
  };

  // ── Transferir cliente ──
  const handleTransfer = async () => {
    if (!transferClienteId || !transferTargetId) return;
    setTransferring(true);
    try {
      const res = await fetch(`/api/clientes/${transferClienteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asesor_id: transferTargetId }),
      });
      if (res.ok) {
        const updated = await res.json();
        // Si la asesora transfirió, el cliente desaparece de su vista
        if (!isAdmin) {
          setClientes(prev => prev.filter(c => c.id !== transferClienteId));
        } else {
          setClientes(prev => prev.map(c => c.id === transferClienteId ? updated : c));
        }
        setTransferClienteId(null);
        setTransferTargetId('');
      } else {
        const err = await res.json();
        alert(err.error || 'Error al transferir');
      }
    } catch {
      alert('Error de conexión');
    } finally {
      setTransferring(false);
    }
  };

  // Para transfer de asesoras no-admin, necesitamos la lista de asesoras
  // Se carga al primer intento de transfer si no es admin (admin ya la tiene)
  const [asesorasLoaded, setAsesorasLoaded] = useState(false);
  const loadAsesoras = async () => {
    if (asesorasLoaded || asesoras.length > 0) return;
    try {
      const res = await fetch('/api/users?role=asesor');
      if (res.ok) {
        const data = await res.json();
        setAsesoras(data);
      }
    } catch {
      console.error('Error loading asesoras');
    } finally {
      setAsesorasLoaded(true);
    }
  };

  const openTransferModal = (clienteId: string) => {
    setTransferClienteId(clienteId);
    setTransferTargetId('');
    if (!isAdmin) loadAsesoras();
  };

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <FiUsers className="text-red-600" size={28} />
          <h1 className="text-2xl font-bold text-gray-800">
            {isAdmin ? 'Todos los Clientes' : 'Mis Clientes Frecuentes'}
          </h1>
        </div>
        <p className="text-gray-500 text-sm">
          {isAdmin
            ? 'Gestiona la base de datos de clientes de todas las asesoras.'
            : `Clientes asignados a ${userName}. Los datos guardados aquí se auto-llenarán al crear pedidos.`
          }
        </p>
      </div>

      {/* Search + Create + Stats + Filter */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <FiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, RUC, WhatsApp o distrito..."
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl bg-white text-gray-900 font-medium placeholder:text-gray-400 shadow-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all"
          />
        </div>
        {/* Admin: filtro por asesora */}
        {isAdmin && asesoras.length > 0 && (
          <select
            value={filterAsesorId}
            onChange={(e) => { setFilterAsesorId(e.target.value); setCurrentPage(1); }}
            className="px-4 py-3 border border-gray-300 rounded-xl bg-white text-sm font-medium text-gray-700 shadow-sm focus:ring-2 focus:ring-red-500 focus:border-red-500"
          >
            <option value="">Todas las asesoras</option>
            {asesoras.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center justify-center gap-2 px-5 py-3 bg-red-600 text-white font-semibold rounded-xl hover:bg-red-700 transition-colors shadow-sm whitespace-nowrap"
        >
          <FiPlus size={18} />
          Nuevo Cliente
        </button>
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-xl text-red-700 font-semibold text-sm whitespace-nowrap">
          <FiUsers size={16} />
          {totalClientes} cliente{totalClientes !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <div className="mb-6 bg-white border-2 border-red-200 rounded-xl shadow-md p-5">
          <h3 className="text-sm font-bold text-red-700 mb-3 flex items-center gap-2"><FiPlus size={16} /> Nuevo Cliente Frecuente</h3>
          <ClienteFormFields form={createForm} setForm={setCreateForm} asesoras={asesoras} userRole={userRole} />
          <div className="flex gap-2 mt-4">
            <button onClick={handleCreate} disabled={creating} className="flex items-center gap-2 px-5 py-2.5 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors text-sm disabled:bg-gray-300">
              <FiSave size={14} />{creating ? 'Guardando...' : 'Guardar Cliente'}
            </button>
            <button onClick={() => { setShowCreateForm(false); setCreateForm({ distrito: 'La Victoria', tipo_cliente: 'Frecuente', empresa: 'Transavic', asesor_id: userId }); }} className="flex items-center gap-2 px-5 py-2.5 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors text-sm">
              <FiX size={14} />Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Cargando clientes...</div>
      ) : clientes.length === 0 ? (
        <div className="text-center py-12">
          <FiUsers className="mx-auto text-gray-300 mb-3" size={48} />
          <p className="text-gray-500">{search ? 'No se encontraron clientes' : 'Aún no hay clientes guardados'}</p>
          <p className="text-gray-400 text-sm mt-1">Usa el botón &quot;Nuevo Cliente&quot; para agregar uno, o guárdalos desde el formulario de pedidos</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clientes.map((c) => (
            <div key={c.id} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
              {editingId === c.id ? (
                <div>
                  <h3 className="text-sm font-bold text-blue-700 mb-3 flex items-center gap-2"><FiEdit2 size={14} /> Editando: {c.nombre}</h3>
                  <ClienteFormFields form={editForm} setForm={setEditForm} asesoras={asesoras} userRole={userRole} />
                  <div className="flex gap-2 mt-4">
                    <button onClick={saveEdit} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 transition-colors text-sm disabled:bg-gray-300">
                      <FiSave size={14} />{saving ? 'Guardando...' : 'Guardar'}
                    </button>
                    <button onClick={cancelEdit} className="flex items-center gap-2 px-5 py-2.5 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors text-sm">
                      <FiX size={14} />Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-bold text-gray-800 text-lg">{c.nombre}</h3>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[11px] font-medium">{c.tipo_cliente || 'Frecuente'}</span>
                      {/* Badge de asesora — visible para admin */}
                      {isAdmin && c.asesor_name && (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[11px] font-semibold flex items-center gap-1">
                          👤 {c.asesor_name}
                        </span>
                      )}
                    </div>
                    {(c.razon_social || c.ruc_dni) && (
                      <p className="text-xs text-gray-500 mb-1.5">
                        {c.razon_social && <span>🏢 {c.razon_social}</span>}
                        {c.razon_social && c.ruc_dni && <span className="mx-1.5">·</span>}
                        {c.ruc_dni && <span>🆔 {c.ruc_dni}</span>}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                      {c.whatsapp && <span className="flex items-center gap-1"><FiPhone size={13} />{c.whatsapp}</span>}
                      {c.direccion && <span className="flex items-center gap-1"><FiMapPin size={13} /><span className="truncate max-w-[200px]">{c.direccion}</span></span>}
                      {c.distrito && <span className="flex items-center gap-1"><FiMap size={13} />{c.distrito}</span>}
                      {c.empresa && <span className="flex items-center gap-1"><FiTruck size={13} />{c.empresa}</span>}
                      {c.hora_entrega && <span className="flex items-center gap-1"><FiClock size={13} />{c.hora_entrega}</span>}
                    </div>
                    {c.notas && (
                      <p className="mt-1.5 text-xs text-gray-500 flex items-start gap-1"><FiInfo size={12} className="mt-0.5 flex-shrink-0" /><span className="line-clamp-2">{c.notas}</span></p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button onClick={() => toggleHistory(c.id)} className={`p-2 rounded-lg transition-colors ${historyClienteId === c.id ? 'text-amber-600 bg-amber-50' : 'text-amber-500 hover:bg-amber-50'}`} title="Ver Pedidos">
                      <FiClipboard size={16} />
                    </button>
                    <button onClick={() => openTransferModal(c.id)} className="p-2 text-purple-500 hover:bg-purple-50 rounded-lg transition-colors" title="Transferir Cliente">
                      <FiRepeat size={16} />
                    </button>
                    <button onClick={() => startEdit(c)} className="p-2 text-blue-500 hover:bg-blue-50 rounded-lg transition-colors" title="Editar">
                      <FiEdit2 size={16} />
                    </button>
                    <button onClick={() => handleDelete(c.id, c.nombre)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar">
                      <FiTrash2 size={16} />
                    </button>
                  </div>
                </div>
                {/* Order History Panel */}
                {historyClienteId === c.id && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex items-center gap-2 mb-2">
                      <FiClipboard size={14} className="text-amber-600" />
                      <h4 className="text-sm font-bold text-gray-700">Historial de Pedidos</h4>
                      <button onClick={() => setHistoryClienteId(null)} className="ml-auto text-gray-400 hover:text-gray-600"><FiChevronUp size={16} /></button>
                    </div>
                    {loadingHistory ? (
                      <p className="text-xs text-gray-400 py-2">Cargando pedidos...</p>
                    ) : (historyPedidos[c.id]?.length ?? 0) === 0 ? (
                      <p className="text-xs text-gray-400 py-2">No hay pedidos registrados para este cliente</p>
                    ) : (
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {(historyPedidos[c.id] as Array<{id: string; fecha_pedido: string; detalle: string; empresa: string; estado: string; distrito: string; detalle_final: string | null}>)?.map((p) => (
                          <div key={p.id} className="flex items-start gap-3 p-2.5 bg-gray-50 rounded-lg text-sm">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-semibold text-gray-700">{p.fecha_pedido}</span>
                                <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                                  p.estado === 'Entregado' ? 'bg-green-100 text-green-700' :
                                  p.estado === 'En_Camino' ? 'bg-blue-100 text-blue-700' :
                                  p.estado === 'Asignado' ? 'bg-yellow-100 text-yellow-700' :
                                  p.estado === 'Fallido' ? 'bg-red-100 text-red-700' :
                                  'bg-gray-100 text-gray-600'
                                }`}>{p.estado?.replace('_', ' ') || 'Pendiente'}</span>
                                <span className="text-[10px] text-gray-400">{p.empresa}</span>
                              </div>
                              <p className="text-gray-600 text-xs line-clamp-2">{p.detalle_final || p.detalle}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            ← Anterior
          </button>
          <span className="text-sm text-gray-600">
            Página <span className="font-bold text-gray-800">{currentPage}</span> de <span className="font-bold text-gray-800">{totalPages}</span>
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Siguiente →
          </button>
        </div>
      )}

      {/* Transfer Modal */}
      {transferClienteId && (
        <>
          <div className="fixed inset-0 bg-black/40 z-50" onClick={() => setTransferClienteId(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 w-full max-w-sm pointer-events-auto">
              <h3 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
                <FiRepeat className="text-purple-600" size={20} />
                Transferir Cliente
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Transfiere a <strong>{clientes.find(c => c.id === transferClienteId)?.nombre}</strong> a otro asesor.
              </p>
              <select
                value={transferTargetId}
                onChange={(e) => setTransferTargetId(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 mb-4"
              >
                <option value="">Selecciona un asesor</option>
                {asesoras
                  .filter(a => a.id !== (clientes.find(c => c.id === transferClienteId)?.asesor_id))
                  .map(a => <option key={a.id} value={a.id}>{a.name}</option>)
                }
              </select>
              <div className="flex gap-2">
                <button
                  onClick={handleTransfer}
                  disabled={!transferTargetId || transferring}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 transition-colors text-sm disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  <FiRepeat size={14} />
                  {transferring ? 'Transfiriendo...' : 'Transferir'}
                </button>
                <button
                  onClick={() => setTransferClienteId(null)}
                  className="px-4 py-2.5 bg-gray-200 text-gray-700 font-semibold rounded-lg hover:bg-gray-300 transition-colors text-sm"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
