// src/app/dashboard/clientes/clientes-client.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { FiSearch, FiEdit2, FiTrash2, FiSave, FiX, FiPlus, FiUsers, FiPhone, FiMapPin, FiMap, FiClock, FiInfo, FiTruck, FiClipboard, FiChevronUp, FiRepeat, FiUser, FiMoreVertical, FiMessageCircle, FiTag } from 'react-icons/fi';
import MapInput from '@/components/MapInput';
import TimeRangePicker from '@/components/TimeRangePicker';

const distritos = ['La Victoria', 'Lince', 'San Isidro', 'San Miguel', 'San Borja', 'Breña', 'Surquillo', 'Cercado de Lima', 'Miraflores', 'La Molina', 'Surco', 'Magdalena', 'Jesús María', 'Salamanca', 'Barranco', 'San Luis', 'Santa Beatriz', 'Pueblo Libre'];

// Rubro / giro del negocio del cliente. Lista FIJA (decisión de negocio). Independiente de
// `tipo_cliente` (Frecuente/Nuevo). El backfill (scripts/backfill-rubro.sql) escribe estos
// mismos strings. Vacío en el form = "Sin clasificar" (rubro NULL en DB).
const RUBROS = ['Restaurante', 'Cafetería', 'Avícola', 'Chifa', 'Fast food', 'Market / Minimarket', 'Tienda / Bodega', 'Casa / Hogar', 'Otro'];

// Link directo a WhatsApp (la asesora vive ahí). Limpia el número y antepone 51
// (Perú) si no lo trae. Devuelve null si no hay número usable.
function whatsappHref(numero: string | null | undefined): string | null {
  if (!numero) return null;
  const clean = numero.replace(/\D/g, '');
  if (clean.length < 7) return null;
  return `https://wa.me/${clean.startsWith('51') ? clean : `51${clean}`}`;
}

// Avatar de color por inicial — escaneo visual rápido en una lista larga.
// El color se deriva del nombre para que cada cliente tenga un tono estable.
const AVATAR_COLORS = [
  'bg-red-100 text-red-700', 'bg-amber-100 text-amber-700', 'bg-teal-100 text-teal-700',
  'bg-blue-100 text-blue-700', 'bg-purple-100 text-purple-700', 'bg-green-100 text-green-700',
  'bg-pink-100 text-pink-700', 'bg-indigo-100 text-indigo-700',
];
function avatarPara(nombre: string): { inicial: string; clase: string } {
  const inicial = (nombre.trim()[0] ?? '?').toUpperCase();
  let h = 0;
  for (let i = 0; i < nombre.length; i++) h = (h * 31 + nombre.charCodeAt(i)) >>> 0;
  return { inicial, clase: AVATAR_COLORS[h % AVATAR_COLORS.length] };
}

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
  rubro: string | null;
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

  // Consulta RUC/DNI (apisperu) → auto-llena razón social y dirección.
  const [consultandoDoc, setConsultandoDoc] = useState(false);
  const [docMsg, setDocMsg] = useState<string | null>(null);
  const [docMsgError, setDocMsgError] = useState(false);

  async function consultarDoc() {
    const numero = (form.ruc_dni ?? '').trim();
    if (!/^\d{8}$|^\d{11}$/.test(numero)) {
      setDocMsgError(true);
      setDocMsg('Ingresa un DNI (8) o RUC (11 dígitos).');
      return;
    }
    setConsultandoDoc(true);
    setDocMsg(null);
    try {
      const res = await fetch('/api/consulta-documento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: numero.length === 11 ? 'ruc' : 'dni', numero }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        const nombre = j.razonSocial || j.nombreCompleto || '';
        updateField('razon_social', nombre);
        if (numero.length === 11 && j.direccion) updateField('direccion', j.direccion);
        setDocMsgError(false);
        setDocMsg(`✓ ${nombre}${j.estado ? ` · ${j.estado}` : ''}`);
      } else {
        setDocMsgError(true);
        setDocMsg(j.error || 'No se encontró el documento.');
      }
    } catch {
      setDocMsgError(true);
      setDocMsg('No se pudo consultar. Escribe los datos a mano.');
    } finally {
      setConsultandoDoc(false);
    }
  }

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
          <div className="flex gap-1.5">
            <input value={form.ruc_dni ?? ''} onChange={e => updateField('ruc_dni', e.target.value.replace(/\D/g, ''))} maxLength={11} inputMode="numeric" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); consultarDoc(); } }} className="flex-1 min-w-0 p-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500" placeholder="RUC o DNI" />
            <button type="button" onClick={consultarDoc} disabled={consultandoDoc} title="Consultar en SUNAT / RENIEC" className="px-3 bg-gray-800 text-white rounded-lg text-xs font-medium hover:bg-gray-900 disabled:opacity-50 flex items-center">
              <FiSearch className={consultandoDoc ? 'animate-pulse' : ''} />
            </button>
          </div>
          {docMsg && <p className={`text-[11px] mt-1 ${docMsgError ? 'text-red-600' : 'text-green-600'}`}>{docMsg}</p>}
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
          <label className="block text-xs font-semibold text-gray-500 mb-1">Rubro</label>
          <select value={form.rubro ?? ''} onChange={e => updateField('rubro', e.target.value || null)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-red-500 focus:border-red-500">
            <option value="">Sin clasificar</option>
            {RUBROS.map(r => <option key={r} value={r}>{r}</option>)}
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
  const [filtroSinAsesora, setFiltroSinAsesora] = useState(false);
  const [filtroDistrito, setFiltroDistrito] = useState('');
  const [expandirDistritos, setExpandirDistritos] = useState(false);
  const TOP_DISTRITOS = 8;
  const [filtroRubro, setFiltroRubro] = useState('');
  const [expandirRubros, setExpandirRubros] = useState(false);
  const TOP_RUBROS = 8;
  const [resumen, setResumen] = useState<{
    porAsesora: { nombre: string; total: number }[];
    porDistrito: { distrito: string; total: number }[];
    porRubro: { rubro: string; total: number }[];
  }>({ porAsesora: [], porDistrito: [], porRubro: [] });
  // Dropdown "⋯" de acciones por tarjeta (Editar · Transferir · Eliminar · Pedidos).
  const [menuAbiertoId, setMenuAbiertoId] = useState<string | null>(null);
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
      if (isAdmin && filtroSinAsesora) params.set('sin_asesora', 'true');
      else if (isAdmin && filterAsesorId) params.set('asesor_id', filterAsesorId);
      if (filtroDistrito) params.set('distrito', filtroDistrito);
      if (filtroRubro) params.set('rubro', filtroRubro);
      const res = await fetch(`/api/clientes?${params}`);
      if (res.ok) {
        const json = await res.json();
        setClientes(json.data);
        setTotalPages(json.pagination.totalPages);
        setTotalClientes(json.pagination.total);
        setCurrentPage(json.pagination.currentPage);
        if (json.asesoras) setAsesoras(json.asesoras);
        if (json.resumen) setResumen(json.resumen);
      }
    } catch (err) {
      console.error('Error cargando clientes:', err);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, filterAsesorId, filtroSinAsesora, filtroDistrito, filtroRubro]);

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
        setCreateForm({ distrito: 'La Victoria', tipo_cliente: 'Frecuente', empresa: 'Transavic', asesor_id: userId, latitude: null, longitude: null, direccion_mapa: null });
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

  const maxAsesoraTotal = resumen.porAsesora.length > 0
    ? Math.max(...resumen.porAsesora.map(a => a.total))
    : 1;


  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-7">
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
      <div className="flex flex-col sm:flex-row gap-4 mb-4">
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

        <button
          onClick={() => setShowCreateForm(true)}
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

      {/* Distribución: mini-KPI cards (asesoras) + chips de distrito */}
      {(resumen.porDistrito.length > 0 || resumen.porRubro.length > 0 || (isAdmin && resumen.porAsesora.length > 0)) && (
        <div className="mb-5 space-y-4">
          {/* Por asesora — admin: tarjetas con número grande */}
          {isAdmin && resumen.porAsesora.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Por asesora</p>
              <div className="flex flex-wrap gap-2">
                {/* Tarjeta "Todas" */}
                <button
                  onClick={() => { setFilterAsesorId(''); setFiltroSinAsesora(false); setCurrentPage(1); }}
                  className={`flex-1 min-w-[110px] rounded-xl p-3 text-left border transition-all cursor-pointer active:scale-[0.97] ${!filterAsesorId && !filtroSinAsesora ? 'bg-red-600 border-red-600 shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}
                >
                  <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${!filterAsesorId && !filtroSinAsesora ? 'text-red-200' : 'text-gray-400'}`}>Todas</p>
                  <p className={`text-2xl font-bold tabular-nums leading-none ${!filterAsesorId && !filtroSinAsesora ? 'text-white' : 'text-gray-700'}`}>{totalClientes}</p>
                  <div className={`mt-2 h-1 rounded-full ${!filterAsesorId && !filtroSinAsesora ? 'bg-red-500/40' : 'bg-gray-100'}`} />
                </button>
                {/* Una tarjeta por asesora */}
                {resumen.porAsesora.map(a => {
                  const asesor = asesoras.find(x => x.name.trim() === a.nombre.trim());
                  const activa = !!asesor && filterAsesorId === asesor.id;
                  const pct = (a.total / maxAsesoraTotal) * 100;
                  return (
                    <button
                      key={a.nombre}
                      onClick={() => { if (asesor) { setFilterAsesorId(activa ? '' : asesor.id); setFiltroSinAsesora(false); setCurrentPage(1); } }}
                      className={`flex-1 min-w-[110px] rounded-xl p-3 text-left border transition-all cursor-pointer active:scale-[0.97] ${activa ? 'bg-red-600 border-red-600 shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}
                    >
                      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 truncate ${activa ? 'text-red-200' : 'text-gray-400'}`}>{a.nombre.trim()}</p>
                      <p className={`text-2xl font-bold tabular-nums leading-none ${activa ? 'text-white' : 'text-gray-700'}`}>{a.total}</p>
                      <div className={`mt-2 h-1 rounded-full ${activa ? 'bg-red-500/40' : 'bg-gray-100'}`}>
                        <div
                          className={`h-full rounded-full transition-all ${activa ? 'bg-white/60' : 'bg-red-400'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </button>
                  );
                })}
                {/* Tarjeta "Sin asesora" — clientes asignados al admin o sin asignar */}
                {(() => {
                  const sinAsesora = !filterAsesorId
                    ? totalClientes - resumen.porAsesora.reduce((s, a) => s + a.total, 0)
                    : 0;
                  return sinAsesora > 0 ? (
                    <button
                      onClick={() => { setFilterAsesorId(''); setFiltroSinAsesora(!filtroSinAsesora); setCurrentPage(1); }}
                      className={`flex-1 min-w-[110px] rounded-xl p-3 text-left border transition-all cursor-pointer active:scale-[0.97] ${filtroSinAsesora ? 'bg-red-600 border-red-600 shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'}`}
                    >
                      <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${filtroSinAsesora ? 'text-red-200' : 'text-gray-400'}`}>Sin asesora</p>
                      <p className={`text-2xl font-bold tabular-nums leading-none ${filtroSinAsesora ? 'text-white' : 'text-gray-400'}`}>{sinAsesora}</p>
                      <div className={`mt-2 h-1 rounded-full ${filtroSinAsesora ? 'bg-red-500/40' : 'bg-gray-100'}`} />
                    </button>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          {/* Por distrito — chips compactos, top 8 visible, "+ N más" para el resto */}
          {resumen.porDistrito.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Por distrito</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => { setFiltroDistrito(''); setCurrentPage(1); }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none ${!filtroDistrito ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  Todos
                </button>
                {(expandirDistritos ? resumen.porDistrito : resumen.porDistrito.slice(0, TOP_DISTRITOS)).map(d => (
                  <button
                    key={d.distrito}
                    onClick={() => { setFiltroDistrito(filtroDistrito === d.distrito ? '' : d.distrito); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none ${filtroDistrito === d.distrito ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {d.distrito} · {d.total}
                  </button>
                ))}
                {resumen.porDistrito.length > TOP_DISTRITOS && (
                  <button
                    onClick={() => setExpandirDistritos(v => !v)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-400 border border-dashed border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                    {expandirDistritos ? 'ver menos' : `+ ${resumen.porDistrito.length - TOP_DISTRITOS} más`}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Por rubro — chips compactos (igual que distrito); "Sin clasificar" para los pendientes */}
          {resumen.porRubro.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Por rubro</p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => { setFiltroRubro(''); setCurrentPage(1); }}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none ${!filtroRubro ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                >
                  Todos
                </button>
                {(expandirRubros ? resumen.porRubro : resumen.porRubro.slice(0, TOP_RUBROS)).map(r => (
                  <button
                    key={r.rubro}
                    onClick={() => { setFiltroRubro(filtroRubro === r.rubro ? '' : r.rubro); setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-full text-xs font-semibold transition-colors focus:outline-none ${filtroRubro === r.rubro ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    {r.rubro} · {r.total}
                  </button>
                ))}
                {resumen.porRubro.length > TOP_RUBROS && (
                  <button
                    onClick={() => setExpandirRubros(v => !v)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium text-gray-400 border border-dashed border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                    {expandirRubros ? 'ver menos' : `+ ${resumen.porRubro.length - TOP_RUBROS} más`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Resumen de filtros activos — sin este strip el usuario no sabe que hay filtros simultáneos */}
      {(filterAsesorId || filtroSinAsesora || filtroDistrito || filtroRubro) && (
        <div className="flex items-center gap-2 flex-wrap bg-gray-50 border-l-2 border-red-400 rounded-r-xl pl-3 pr-3 py-2 mb-4">
          <span className="text-xs text-gray-500 font-medium shrink-0">
            Mostrando <span className="font-bold text-gray-700 tabular-nums">{totalClientes}</span> {totalClientes === 1 ? 'cliente' : 'clientes'}:
          </span>
          {filterAsesorId && (
            <span className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-full px-2.5 py-0.5">
              <FiUser size={10} />
              {asesoras.find(x => x.id === filterAsesorId)?.name.trim()}
              <button
                onClick={() => { setFilterAsesorId(''); setCurrentPage(1); }}
                className="focus:outline-none hover:text-red-900 text-red-400 ml-0.5 leading-none"
              >×</button>
            </span>
          )}
          {filtroSinAsesora && (
            <span className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-full px-2.5 py-0.5">
              <FiUser size={10} />
              Sin asesora
              <button
                onClick={() => { setFiltroSinAsesora(false); setCurrentPage(1); }}
                className="focus:outline-none hover:text-red-900 text-red-400 ml-0.5 leading-none"
              >×</button>
            </span>
          )}
          {filtroDistrito && (
            <span className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-full px-2.5 py-0.5">
              <FiMapPin size={10} />
              {filtroDistrito}
              <button
                onClick={() => { setFiltroDistrito(''); setCurrentPage(1); }}
                className="focus:outline-none hover:text-red-900 text-red-400 ml-0.5 leading-none"
              >×</button>
            </span>
          )}
          {filtroRubro && (
            <span className="inline-flex items-center gap-1 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold rounded-full px-2.5 py-0.5">
              <FiTag size={10} />
              {filtroRubro}
              <button
                onClick={() => { setFiltroRubro(''); setCurrentPage(1); }}
                className="focus:outline-none hover:text-red-900 text-red-400 ml-0.5 leading-none"
              >×</button>
            </span>
          )}
          {[(filterAsesorId || filtroSinAsesora), filtroDistrito, filtroRubro].filter(Boolean).length >= 2 && (
            <button
              onClick={() => { setFilterAsesorId(''); setFiltroSinAsesora(false); setFiltroDistrito(''); setFiltroRubro(''); setCurrentPage(1); }}
              className="text-xs text-gray-400 hover:text-gray-600 focus:outline-none"
            >· Limpiar todo</button>
          )}
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
        <div className="space-y-5">
          {clientes.map((c) => {
            const { inicial, clase } = avatarPara(c.nombre);
            const wa = whatsappHref(c.whatsapp);
            const menuAbierto = menuAbiertoId === c.id;
            return (
            <div key={c.id} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-5">
                  {/* Avatar con inicial — identificación visual rápida */}
                  <Link
                    href={`/dashboard/clientes/${c.id}`}
                    className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0 ${clase} hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 transition-all`}
                    title="Ver perfil 360°"
                  >
                    {inicial}
                  </Link>

                  <div className="flex-1 min-w-0 space-y-3">
                    {/* Fila 1: nombre + badges */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <Link href={`/dashboard/clientes/${c.id}`} className="font-bold text-gray-800 text-lg leading-tight hover:text-indigo-700 transition-colors">
                        {c.nombre}
                      </Link>
                      <span className="px-2.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[11px] font-medium">{c.tipo_cliente || 'Frecuente'}</span>
                      {c.rubro && <span className="px-2.5 py-0.5 bg-teal-50 text-teal-700 rounded-full text-[11px] font-medium inline-flex items-center gap-1"><FiTag size={10} />{c.rubro}</span>}
                      {/* Badge de asesora — visible para admin */}
                      {isAdmin && c.asesor_name && (
                        <span className="px-2.5 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[11px] font-semibold flex items-center gap-1">
                          <FiUser size={10} /> {c.asesor_name}
                        </span>
                      )}
                      {(c.razon_social || c.ruc_dni) && (
                        <span className="text-xs text-gray-400">
                          {c.razon_social && <span>{c.razon_social}</span>}
                          {c.razon_social && c.ruc_dni && <span className="mx-1.5">·</span>}
                          {c.ruc_dni && <span className="font-mono">{c.ruc_dni}</span>}
                        </span>
                      )}
                    </div>

                    {/* Fila 2: contacto principal — WhatsApp (clic) + distrito */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                      {c.whatsapp && (
                        wa ? (
                          <a href={wa} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 text-green-600 hover:text-green-700 hover:underline font-semibold">
                            <FiMessageCircle size={15} />{c.whatsapp}
                          </a>
                        ) : (
                          <span className="flex items-center gap-1.5 text-gray-600 font-medium"><FiPhone size={15} />{c.whatsapp}</span>
                        )
                      )}
                      {c.distrito && <span className="flex items-center gap-1.5 text-gray-600"><FiMap size={15} className="text-gray-400" />{c.distrito}</span>}
                      {c.empresa && <span className="flex items-center gap-1.5 text-gray-600"><FiTruck size={15} className="text-gray-400" />{c.empresa}</span>}
                      {c.hora_entrega && <span className="flex items-center gap-1.5 text-gray-600"><FiClock size={15} className="text-gray-400" />{c.hora_entrega}</span>}
                    </div>

                    {/* Fila 3: dirección (secundaria, más sutil) */}
                    {c.direccion && (
                      <p className="flex items-start gap-1.5 text-xs text-gray-400">
                        <FiMapPin size={13} className="mt-0.5 flex-shrink-0" />
                        <span className="line-clamp-1">{c.direccion}</span>
                      </p>
                    )}

                    {c.notas && (
                      <p className="text-xs text-gray-500 flex items-start gap-1.5 bg-gray-50 rounded-lg px-3 py-2"><FiInfo size={13} className="mt-0.5 flex-shrink-0 text-gray-400" /><span className="line-clamp-2">{c.notas}</span></p>
                    )}
                  </div>

                  {/* Acciones: primaria "Ver perfil" + menú "⋯" con el resto */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Link
                      href={`/dashboard/clientes/${c.id}`}
                      className="px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg flex items-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <FiUser size={14} /> <span className="hidden sm:inline">Ver perfil</span>
                    </Link>
                    <div className="relative">
                      <button
                        onClick={() => setMenuAbiertoId(menuAbierto ? null : c.id)}
                        title="Más acciones"
                        aria-label="Más acciones"
                        className={`p-2 rounded-lg border transition-colors ${menuAbierto ? 'bg-gray-100 border-gray-300 text-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'}`}
                      >
                        <FiMoreVertical size={16} />
                      </button>
                      {menuAbierto && (
                        <>
                          <div className="fixed inset-0 z-30" onClick={() => setMenuAbiertoId(null)} />
                          <div className="absolute right-0 mt-1 w-52 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-40">
                            <button onClick={() => { setMenuAbiertoId(null); toggleHistory(c.id); }} className="w-full px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-gray-50 text-left text-gray-700">
                              <FiClipboard size={15} className="text-amber-600 flex-shrink-0" /> Últimos pedidos
                            </button>
                            <button onClick={() => { setMenuAbiertoId(null); startEdit(c); }} className="w-full px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-gray-50 text-left text-gray-700">
                              <FiEdit2 size={15} className="text-blue-600 flex-shrink-0" /> Editar datos
                            </button>
                            <button onClick={() => { setMenuAbiertoId(null); openTransferModal(c.id); }} className="w-full px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-gray-50 text-left text-gray-700">
                              <FiRepeat size={15} className="text-purple-600 flex-shrink-0" /> Transferir a otra asesora
                            </button>
                            <div className="my-1 border-t border-gray-100" />
                            <button onClick={() => { setMenuAbiertoId(null); handleDelete(c.id, c.nombre); }} className="w-full px-3 py-2 text-sm flex items-center gap-2.5 hover:bg-red-50 text-left text-red-600">
                              <FiTrash2 size={15} className="flex-shrink-0" /> Eliminar cliente
                            </button>
                          </div>
                        </>
                      )}
                    </div>
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
            </div>
            );
          })}
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

      {/* Modal: Nuevo Cliente (antes era un form inline que empujaba la lista) */}
      {showCreateForm && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FiPlus className="text-red-600" /> Nuevo cliente
              </h3>
              <button onClick={() => { setShowCreateForm(false); }} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700">
                <FiX size={20} />
              </button>
            </div>
            <div className="p-6">
              <ClienteFormFields form={createForm} setForm={setCreateForm} asesoras={asesoras} userRole={userRole} />
            </div>
            <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-100 flex justify-end gap-2 rounded-b-2xl">
              <button onClick={() => { setShowCreateForm(false); setCreateForm({ distrito: 'La Victoria', tipo_cliente: 'Frecuente', empresa: 'Transavic', asesor_id: userId, latitude: null, longitude: null, direccion_mapa: null }); }} className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Cancelar
              </button>
              <button onClick={handleCreate} disabled={creating} className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors text-sm disabled:bg-gray-300">
                <FiSave size={14} />{creating ? 'Guardando…' : 'Guardar cliente'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar Cliente (antes reemplazaba la tarjeta con un form gigante) */}
      {editingId && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 z-10 bg-white px-6 py-4 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                <FiEdit2 className="text-blue-600" /> Editar: {editForm.nombre}
              </h3>
              <button onClick={cancelEdit} aria-label="Cerrar" className="text-gray-400 hover:text-gray-700">
                <FiX size={20} />
              </button>
            </div>
            <div className="p-6">
              <ClienteFormFields form={editForm} setForm={setEditForm} asesoras={asesoras} userRole={userRole} />
            </div>
            <div className="sticky bottom-0 bg-white px-6 py-4 border-t border-gray-100 flex justify-end gap-2 rounded-b-2xl">
              <button onClick={cancelEdit} className="px-5 py-2.5 bg-gray-100 text-gray-700 font-medium rounded-lg hover:bg-gray-200 transition-colors text-sm">
                Cancelar
              </button>
              <button onClick={saveEdit} disabled={saving} className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:bg-gray-300">
                <FiSave size={14} />{saving ? 'Guardando…' : 'Guardar cambios'}
              </button>
            </div>
          </div>
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
