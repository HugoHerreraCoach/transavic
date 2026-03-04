// src/components/ProductSelector.tsx
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Producto } from '@/lib/types';

export type SelectedItem = {
  productoId: string;
  nombre: string;
  cantidad: number;
  unidad: string;
};

// ── Inline SVG Icons ──
const IconSearch = () => <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>;
const IconPlus = ({ size = 14 }: { size?: number }) => <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>;
const IconMinus = () => <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/></svg>;
const IconX = ({ size = 14 }: { size?: number }) => <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>;
const IconChevron = () => <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>;
const IconCart = () => <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/></svg>;

const categoriaConfig: Record<string, { emoji: string; activeBg: string }> = {
  Pollo:  { emoji: '🐔', activeBg: '#f59e0b' },
  Carnes: { emoji: '🥩', activeBg: '#ef4444' },
  Huevos: { emoji: '🥚', activeBg: '#eab308' },
};

// Parse "uni/kg" -> ["uni", "kg"], "kg" -> ["kg"], "uni" -> ["uni"]
function parseUnidades(unidad: string): string[] {
  return unidad.split('/').map(u => u.trim()).filter(Boolean);
}

function hasMultipleUnits(unidad: string): boolean {
  return parseUnidades(unidad).length > 1;
}

interface ProductSelectorProps {
  onChange: (items: SelectedItem[], detalleText: string) => void;
  initialItems?: SelectedItem[];
}

export default function ProductSelector({ onChange, initialItems }: ProductSelectorProps) {
  const [productos, setProductos] = useState<Producto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<SelectedItem[]>(initialItems || []);
  const [categoriaActiva, setCategoriaActiva] = useState<string>('Todos');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchProductos = useCallback(async () => {
    try {
      const res = await fetch('/api/productos');
      const json = await res.json();
      setProductos(json.data || []);
    } catch (err) {
      console.error('Error loading products:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProductos(); }, [fetchProductos]);

  useEffect(() => {
    const detalleText = items
      .map(item => `${item.cantidad} ${item.unidad} - ${item.nombre}`)
      .join('\n');
    onChange(items, detalleText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addItem = (producto: Producto) => {
    setItems(prev => {
      const existing = prev.find(i => i.productoId === producto.id);
      if (existing) {
        return prev.map(i =>
          i.productoId === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i
        );
      }
      // Default to first unit option
      const defaultUnit = parseUnidades(producto.unidad)[0];
      return [...prev, { productoId: producto.id, nombre: producto.nombre, cantidad: 1, unidad: defaultUnit }];
    });
  };

  const updateQty = (productoId: string, delta: number) => {
    setItems(prev => prev
      .map(i => i.productoId === productoId ? { ...i, cantidad: Math.max(0, +(i.cantidad + delta).toFixed(1)) } : i)
      .filter(i => i.cantidad > 0));
  };

  const setQty = (productoId: string, qty: number) => {
    // Guard against NaN from empty/invalid input (common on mobile keyboards)
    if (isNaN(qty) || qty < 0) return;
    if (qty === 0) {
      setItems(prev => prev.filter(i => i.productoId !== productoId));
    } else {
      setItems(prev => prev.map(i => i.productoId === productoId ? { ...i, cantidad: qty } : i));
    }
  };

  const setUnit = (productoId: string, unidad: string) => {
    setItems(prev => prev.map(i => i.productoId === productoId ? { ...i, unidad } : i));
  };

  const removeItem = (productoId: string) => {
    setItems(prev => prev.filter(i => i.productoId !== productoId));
  };

  const getItemQty = (productoId: string): number => {
    return items.find(i => i.productoId === productoId)?.cantidad || 0;
  };

  const filteredProducts = productos.filter(p => {
    const matchCat = categoriaActiva === 'Todos' || p.categoria === categoriaActiva;
    const matchSearch = !search || p.nombre.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const groupedProducts = filteredProducts.reduce((acc, p) => {
    if (!acc[p.categoria]) acc[p.categoria] = [];
    acc[p.categoria].push(p);
    return acc;
  }, {} as Record<string, Producto[]>);

  // Build smart summary grouped by unit
  const unitSummary = (() => {
    const byUnit: Record<string, number> = {};
    for (const item of items) {
      const u = item.unidad;
      byUnit[u] = (byUnit[u] || 0) + item.cantidad;
    }
    return Object.entries(byUnit)
      .map(([unit, total]) => `${Number(total) % 1 === 0 ? total : total.toFixed(1)} ${unit}`)
      .join(' · ');
  })();

  // ── Loading State ──
  if (loading) {
    return (
      <div style={{ borderRadius: 12, padding: 20, border: '1px solid #e5e7eb', background: 'linear-gradient(135deg, #f9fafb, #f3f4f6)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ height: 20, width: 160, backgroundColor: '#e5e7eb', borderRadius: 8, animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[1, 2, 3, 4].map(i => <div key={i} style={{ height: 48, backgroundColor: '#e5e7eb', borderRadius: 8, animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite' }} />)}
          </div>
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%', maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
      {/* ── Selected Items Cart ── */}
      {items.length > 0 && (
        <div style={{
          background: 'linear-gradient(135deg, #ecfdf5, #f0fdf4)',
          borderRadius: 12, border: '1px solid #a7f3d0', padding: 16,
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)', boxSizing: 'border-box', overflow: 'hidden'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 28, height: 28, backgroundColor: '#059669', borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white'
              }}><IconCart /></div>
              <span style={{ fontWeight: 600, color: '#065f46', fontSize: 14 }}>
                {items.length} producto{items.length > 1 ? 's' : ''} · {unitSummary}
              </span>
            </div>
            <button type="button" onClick={() => setItems([])} style={{
              fontSize: 12, color: '#059669', background: 'none', border: 'none', cursor: 'pointer',
              fontWeight: 500, padding: '4px 8px', borderRadius: 6, transition: 'all 0.15s'
            }}
            onMouseOver={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.backgroundColor = '#fef2f2'; }}
            onMouseOut={e => { e.currentTarget.style.color = '#059669'; e.currentTarget.style.backgroundColor = 'transparent'; }}
            >Limpiar todo</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {items.map(item => {
              const prod = productos.find(p => p.id === item.productoId);
              const cat = prod?.categoria || 'Pollo';
              const unitOptions = prod ? parseUnidades(prod.unidad) : [item.unidad];
              const multiUnit = unitOptions.length > 1;

              return (
                <div key={item.productoId} style={{
                  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                  backgroundColor: 'white', borderRadius: 10, padding: '8px 12px',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.04)'
                }}>
                  {/* Name */}
                  <span style={{ fontSize: 15 }}>{categoriaConfig[cat]?.emoji}</span>
                  <span style={{ flex: 1, fontSize: 13, color: '#1f2937', fontWeight: 500, minWidth: 80, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', lineHeight: '1.3' }}>
                    {item.nombre}
                  </span>

                  {/* Controls row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {/* Quantity controls */}
                    <button type="button" onClick={() => updateQty(item.productoId, -1)} style={{
                      width: 28, height: 28, borderRadius: 6, backgroundColor: '#f3f4f6',
                      border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#6b7280', transition: 'all 0.15s'
                    }}
                    onMouseOver={e => { e.currentTarget.style.backgroundColor = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; }}
                    onMouseOut={e => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#6b7280'; }}
                    ><IconMinus /></button>

                    <input type="number" value={item.cantidad}
                      onChange={e => setQty(item.productoId, Number(e.target.value))}
                      style={{
                        width: 48, textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 6,
                        padding: '4px 0', fontSize: 13, fontWeight: 700, color: '#111827', outline: 'none'
                      }}
                      min="0" step="0.5"
                    />

                    <button type="button" onClick={() => updateQty(item.productoId, 1)} style={{
                      width: 28, height: 28, borderRadius: 6, backgroundColor: '#f3f4f6',
                      border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: '#6b7280', transition: 'all 0.15s'
                    }}
                    onMouseOver={e => { e.currentTarget.style.backgroundColor = '#ecfdf5'; e.currentTarget.style.color = '#059669'; }}
                    onMouseOut={e => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#6b7280'; }}
                    ><IconPlus size={12} /></button>

                    {/* Unit toggle/selector */}
                    {multiUnit ? (
                      <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #e5e7eb', marginLeft: 4 }}>
                        {unitOptions.map(u => (
                          <button key={u} type="button" onClick={() => setUnit(item.productoId, u)} style={{
                            padding: '4px 8px', fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                            backgroundColor: item.unidad === u ? '#059669' : '#f9fafb',
                            color: item.unidad === u ? 'white' : '#6b7280',
                            transition: 'all 0.15s'
                          }}>{u}</button>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: '#9ca3af', width: 32, textAlign: 'center' }}>{item.unidad}</span>
                    )}
                  </div>

                  {/* Remove button */}
                  <button type="button" onClick={() => removeItem(item.productoId)} style={{
                    width: 24, height: 24, borderRadius: '50%', border: 'none',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#d1d5db', background: 'none', transition: 'all 0.15s'
                  }}
                  onMouseOver={e => { e.currentTarget.style.color = '#ef4444'; e.currentTarget.style.backgroundColor = '#fef2f2'; }}
                  onMouseOut={e => { e.currentTarget.style.color = '#d1d5db'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                  ><IconX /></button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Toggle Button ── */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderRadius: 12, boxSizing: 'border-box',
          border: isOpen ? '2px solid #ef4444' : '2px dashed #d1d5db',
          backgroundColor: isOpen ? '#fef2f2' : 'white',
          color: isOpen ? '#b91c1c' : '#6b7280',
          cursor: 'pointer', transition: 'all 0.2s', fontSize: 14
        }}
        onMouseOver={e => { if (!isOpen) { e.currentTarget.style.borderColor = '#fca5a5'; e.currentTarget.style.backgroundColor = '#fff5f5'; } }}
        onMouseOut={e => { if (!isOpen) { e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.backgroundColor = 'white'; } }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(45deg)' : 'none', display: 'flex' }}><IconPlus size={18} /></span>
          <span style={{ fontWeight: 500 }}>
            {items.length > 0 ? 'Agregar más productos' : 'Seleccionar productos del catálogo'}
          </span>
        </span>
        <span style={{ transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none', display: 'flex' }}><IconChevron /></span>
      </button>

      {/* ── Dropdown Catalog ── */}
      {isOpen && (
        <div style={{
          borderRadius: 12, border: '1px solid #e5e7eb', backgroundColor: 'white',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)',
          overflow: 'hidden', boxSizing: 'border-box', width: '100%', maxWidth: '100%'
        }}>
          {/* Search + Categories */}
          <div style={{ padding: 12, background: 'linear-gradient(180deg, #f9fafb, white)', borderBottom: '1px solid #f3f4f6', boxSizing: 'border-box' }}>
            <div style={{ position: 'relative', marginBottom: 10 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', display: 'flex' }}>
                <IconSearch />
              </span>
              <input
                type="text"
                placeholder="Buscar producto..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: '100%', paddingLeft: 36, paddingRight: 36, paddingTop: 10, paddingBottom: 10,
                  fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 10,
                  backgroundColor: 'white', color: '#111827', outline: 'none',
                  transition: 'border-color 0.2s, box-shadow 0.2s', boxSizing: 'border-box'
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#fca5a5'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(252,165,165,0.3)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none'; }}
                autoFocus
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', display: 'flex'
                }}><IconX size={14} /></button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, minWidth: 0 }}>
              <CategoryPill label={`Todos (${productos.length})`} active={categoriaActiva === 'Todos'} color="#1f2937" onClick={() => setCategoriaActiva('Todos')} />
              {Object.entries(categoriaConfig).map(([cat, cfg]) => {
                const count = productos.filter(p => p.categoria === cat).length;
                return (
                  <CategoryPill
                    key={cat}
                    label={`${cfg.emoji} ${cat} (${count})`}
                    active={categoriaActiva === cat}
                    color={cfg.activeBg}
                    onClick={() => setCategoriaActiva(cat)}
                  />
                );
              })}
            </div>
          </div>

          {/* Product List */}
          <div style={{ maxHeight: 280, overflowY: 'auto', overflowX: 'hidden' }}>
            {filteredProducts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9ca3af' }}>
                <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>🔍</div>
                <p style={{ fontSize: 13, margin: 0 }}>No se encontraron productos</p>
              </div>
            ) : categoriaActiva === 'Todos' ? (
              Object.entries(groupedProducts).map(([cat, prods]) => (
                <div key={cat}>
                  <div style={{
                    position: 'sticky', top: 0, zIndex: 10,
                    padding: '6px 16px', backgroundColor: categoriaConfig[cat]?.activeBg || '#6b7280',
                    color: 'white', fontSize: 11, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    display: 'flex', alignItems: 'center', gap: 6
                  }}>
                    <span>{categoriaConfig[cat]?.emoji}</span> {cat}
                    <span style={{ marginLeft: 'auto', opacity: 0.6 }}>{prods.length}</span>
                  </div>
                  {prods.map(p => <ProductRow key={p.id} producto={p} qty={getItemQty(p.id)} onAdd={addItem} onUpdateQty={updateQty} />)}
                </div>
              ))
            ) : (
              filteredProducts.map(p => <ProductRow key={p.id} producto={p} qty={getItemQty(p.id)} onAdd={addItem} onUpdateQty={updateQty} />)
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: '8px 12px', backgroundColor: '#f9fafb', borderTop: '1px solid #f3f4f6',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxSizing: 'border-box'
          }}>
            <span style={{ fontSize: 11, color: '#9ca3af', flexShrink: 1, minWidth: 0 }}>{filteredProducts.length} productos</span>
            <button type="button" onClick={() => setIsOpen(false)} style={{
              fontSize: 11, fontWeight: 600, color: '#dc2626', background: 'none',
              border: 'none', cursor: 'pointer', padding: '4px 8px', borderRadius: 6, transition: 'all 0.15s',
              whiteSpace: 'nowrap', flexShrink: 0
            }}
            onMouseOver={e => e.currentTarget.style.backgroundColor = '#fef2f2'}
            onMouseOut={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Category Pill ──
function CategoryPill({ label, active, color, onClick }: { label: string; active: boolean; color: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 600,
      whiteSpace: 'nowrap', border: 'none', cursor: 'pointer', transition: 'all 0.2s',
      backgroundColor: active ? color : '#f3f4f6',
      color: active ? 'white' : '#6b7280',
      boxShadow: active ? '0 2px 8px rgba(0,0,0,0.15)' : 'none'
    }}>{label}</button>
  );
}

// ── Single Product Row ──
function ProductRow({ producto, qty, onAdd, onUpdateQty }: {
  producto: Producto;
  qty: number;
  onAdd: (p: Producto) => void;
  onUpdateQty: (id: string, delta: number) => void;
}) {
  const isSelected = qty > 0;
  const unitDisplay = hasMultipleUnits(producto.unidad)
    ? parseUnidades(producto.unidad).join(' / ')
    : producto.unidad;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '10px 12px', borderBottom: '1px solid #f9fafb',
      backgroundColor: isSelected ? '#ecfdf5' : 'white',
      transition: 'background-color 0.15s', boxSizing: 'border-box'
    }}
    onMouseOver={e => { if (!isSelected) e.currentTarget.style.backgroundColor = '#f9fafb'; }}
    onMouseOut={e => { if (!isSelected) e.currentTarget.style.backgroundColor = isSelected ? '#ecfdf5' : 'white'; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{
          fontSize: 13, margin: 0, lineHeight: '1.3',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const, overflow: 'hidden',
          fontWeight: isSelected ? 600 : 400, color: isSelected ? '#065f46' : '#374151'
        }}>{producto.nombre}</p>
        <p style={{ fontSize: 11, color: '#9ca3af', margin: '2px 0 0' }}>{unitDisplay}</p>
      </div>

      {isSelected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" onClick={e => { e.stopPropagation(); onUpdateQty(producto.id, -1); }} style={{
            width: 28, height: 28, borderRadius: 8, backgroundColor: 'white',
            border: '1px solid #e5e7eb', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6b7280', transition: 'all 0.15s'
          }}
          onMouseOver={e => { e.currentTarget.style.backgroundColor = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.borderColor = '#fecaca'; }}
          onMouseOut={e => { e.currentTarget.style.backgroundColor = 'white'; e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
          ><IconMinus /></button>
          <span style={{ width: 32, textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#059669' }}>{qty}</span>
          <button type="button" onClick={e => { e.stopPropagation(); onUpdateQty(producto.id, 1); }} style={{
            width: 28, height: 28, borderRadius: 8, backgroundColor: 'white',
            border: '1px solid #e5e7eb', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#6b7280', transition: 'all 0.15s'
          }}
          onMouseOver={e => { e.currentTarget.style.backgroundColor = '#ecfdf5'; e.currentTarget.style.color = '#059669'; e.currentTarget.style.borderColor = '#a7f3d0'; }}
          onMouseOut={e => { e.currentTarget.style.backgroundColor = 'white'; e.currentTarget.style.color = '#6b7280'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
          ><IconPlus size={12} /></button>
        </div>
      ) : (
        <button type="button" onClick={() => onAdd(producto)} style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          backgroundColor: '#f3f4f6', color: '#9ca3af',
          border: 'none', cursor: 'pointer', transition: 'all 0.15s',
          display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}
        onMouseOver={e => { e.currentTarget.style.backgroundColor = '#dc2626'; e.currentTarget.style.color = 'white'; e.currentTarget.style.transform = 'scale(1.1)'; }}
        onMouseOut={e => { e.currentTarget.style.backgroundColor = '#f3f4f6'; e.currentTarget.style.color = '#9ca3af'; e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <IconPlus size={14} />
        </button>
      )}
    </div>
  );
}
