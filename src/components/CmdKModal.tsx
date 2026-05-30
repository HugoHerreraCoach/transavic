// src/components/CmdKModal.tsx
// Búsqueda global tipo "command palette" (Cmd+K / Ctrl+K).
//
// Diseño:
//   - Escuchamos Cmd+K / Ctrl+K en window — abre el modal.
//   - Input arriba; debajo, tres secciones (Clientes · Pedidos · Comprobantes)
//     con los TOP-5 de cada uno.
//   - Resultados navegables con flechas ↑↓ + Enter abre el seleccionado.
//   - Esc cierra el modal.
//
// El endpoint /api/buscar ya aplica scoping por rol (asesor solo ve lo suyo).
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FiSearch,
  FiX,
  FiUser,
  FiPackage,
  FiFileText,
  FiLoader,
} from "react-icons/fi";

interface ClienteMini {
  id: string;
  nombre: string;
  ruc_dni: string | null;
  distrito: string | null;
  whatsapp: string | null;
}
interface PedidoMini {
  id: string;
  cliente: string;
  detalle: string;
  estado: string;
  empresa: string;
  fecha_pedido: string;
}
interface ComprobanteMini {
  id: string;
  serie_numero: string;
  tipo: string;
  empresa: string;
  estado: string;
  monto_total: string | number;
  cliente_razon_social: string | null;
  cliente_doc_num: string | null;
}

interface ItemNavegable {
  href: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  badge?: string;
}

const TIPO_LABEL: Record<string, string> = {
  "01": "Factura",
  "03": "Boleta",
  "07": "N. Crédito",
  "08": "N. Débito",
};

export default function CmdKModal() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [clientes, setClientes] = useState<ClienteMini[]>([]);
  const [pedidos, setPedidos] = useState<PedidoMini[]>([]);
  const [comprobantes, setComprobantes] = useState<ComprobanteMini[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // 1) Atajo de teclado global: Cmd+K (Mac) / Ctrl+K (Windows/Linux).
  //    Cualquier "/" también abre, salvo si el foco está en un input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // 2) Cuando se abre, foco al input y reset del cursor.
  useEffect(() => {
    if (open) {
      setActiveIdx(0);
      // microtask para que el input ya esté montado
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // 3) Búsqueda debounced (250 ms). Si q < 2 chars, no consultamos.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setClientes([]);
      setPedidos([]);
      setComprobantes([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/buscar?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) throw new Error("err");
        const json = await res.json();
        setClientes(json.clientes ?? []);
        setPedidos(json.pedidos ?? []);
        setComprobantes(json.comprobantes ?? []);
      } catch {
        setClientes([]);
        setPedidos([]);
        setComprobantes([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  // 4) Aplanamos los 3 grupos en una sola lista navegable con flechas.
  const lista: ItemNavegable[] = useMemo(() => {
    const acc: ItemNavegable[] = [];
    clientes.forEach((c) =>
      acc.push({
        href: `/dashboard/clientes/${c.id}`,
        label: c.nombre,
        hint:
          [c.ruc_dni, c.distrito].filter(Boolean).join(" · ") || c.whatsapp || "Cliente",
        icon: <FiUser className="text-indigo-600" />,
        badge: "Cliente",
      })
    );
    pedidos.forEach((p) =>
      acc.push({
        href: `/dashboard?pedido=${p.id}`,
        label: `${p.cliente} — ${p.detalle.slice(0, 60)}${p.detalle.length > 60 ? "…" : ""}`,
        hint: `${p.empresa} · ${p.estado.replace(/_/g, " ")} · ${p.fecha_pedido}`,
        icon: <FiPackage className="text-amber-600" />,
        badge: "Pedido",
      })
    );
    comprobantes.forEach((c) =>
      acc.push({
        href: `/dashboard/comprobantes`,
        label: `${c.serie_numero} — ${c.cliente_razon_social ?? "Cliente"}`,
        hint: `${TIPO_LABEL[c.tipo] ?? c.tipo} · ${c.empresa} · S/ ${Number(c.monto_total).toFixed(2)}`,
        icon: <FiFileText className="text-red-600" />,
        badge: c.estado.replace(/_/g, " "),
      })
    );
    return acc;
  }, [clientes, pedidos, comprobantes]);

  // 5) Navegación con flechas + Enter.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(lista.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const item = lista[activeIdx];
        if (item) {
          e.preventDefault();
          setOpen(false);
          router.push(item.href);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, lista, activeIdx, router]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center p-4 pt-[10vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header con input */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
          <FiSearch className="text-gray-400 h-5 w-5 shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActiveIdx(0);
            }}
            placeholder="Buscar clientes, pedidos o comprobantes…"
            className="flex-1 outline-none text-sm placeholder-gray-400"
          />
          {loading && <FiLoader className="animate-spin text-gray-400 h-4 w-4" />}
          <button
            onClick={() => setOpen(false)}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 p-1"
          >
            <FiX className="h-4 w-4" />
          </button>
        </div>

        {/* Resultados */}
        <div className="max-h-[60vh] overflow-y-auto">
          {q.trim().length < 2 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-400">
              Escribí al menos 2 letras (nombre, RUC, n° comprobante…)
            </div>
          ) : lista.length === 0 && !loading ? (
            <div className="px-6 py-8 text-center text-sm text-gray-400">
              Sin resultados para <strong>“{q}”</strong>
            </div>
          ) : (
            <ul className="py-1">
              {lista.map((item, i) => (
                <li key={`${item.href}-${i}`}>
                  <button
                    onClick={() => {
                      setOpen(false);
                      router.push(item.href);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={`w-full text-left px-4 py-2.5 flex items-center gap-3 ${
                      activeIdx === i ? "bg-indigo-50" : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {item.label}
                      </div>
                      {item.hint && (
                        <div className="text-[11px] text-gray-500 truncate">{item.hint}</div>
                      )}
                    </div>
                    {item.badge && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium whitespace-nowrap">
                        {item.badge}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer con atajos */}
        <div className="border-t border-gray-100 px-4 py-2 text-[10px] text-gray-500 flex items-center justify-between bg-gray-50">
          <span>
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-700">↑↓</kbd>{" "}
            navegar ·{" "}
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-700">↵</kbd>{" "}
            abrir ·{" "}
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-700">esc</kbd>{" "}
            cerrar
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-white border border-gray-200 rounded text-gray-700">⌘K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
