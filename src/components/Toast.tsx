"use client";
// Toast compartido para los módulos del ERP (reemplaza alert()/confirm() de feedback).
// Uso:
//   const { mostrarToast, toasts } = useToast();
//   mostrarToast("Compra registrada", "exito");
//   ... y en el JSX raíz de la vista: <ToastContainer toasts={toasts} />
// Nota: el contenedor es position:fixed bajo DashboardLayout → lleva print:hidden
// (gotcha #26: los fixed salen impresos y dejan hojas en blanco).
import { useCallback, useState } from "react";
import { FiAlertCircle, FiCheckCircle, FiInfo, FiX } from "react-icons/fi";

export type TipoToast = "exito" | "error" | "info";

export interface ToastItem {
  id: number;
  mensaje: string;
  tipo: TipoToast;
}

const DURACION_MS = 4500;
// Los errores duran más: dan tiempo a leerlos antes de esfumarse.
const DURACION_ERROR_MS = 8000;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Descarte manual (la X del toast). Pásalo a <ToastContainer onCerrar={cerrarToast} />.
  const cerrarToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const mostrarToast = useCallback((mensaje: string, tipo: TipoToast = "exito") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, mensaje, tipo }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, tipo === "error" ? DURACION_ERROR_MS : DURACION_MS);
  }, []);

  return { mostrarToast, cerrarToast, toasts };
}

const ESTILOS: Record<TipoToast, string> = {
  exito: "bg-green-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-gray-800 text-white",
};

const ICONOS: Record<TipoToast, React.ReactNode> = {
  exito: <FiCheckCircle size={18} className="shrink-0" />,
  error: <FiAlertCircle size={18} className="shrink-0" />,
  info: <FiInfo size={18} className="shrink-0" />,
};

export function ToastContainer({
  toasts,
  onCerrar,
}: {
  toasts: ToastItem[];
  // Opcional: si viene (cerrarToast de useToast), cada toast muestra una X para descartarlo.
  onCerrar?: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center print:hidden pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium max-w-[90vw] animate-[fadeIn_.2s_ease-out] ${ESTILOS[t.tipo]}`}
          role="status"
        >
          {ICONOS[t.tipo]}
          <span>{t.mensaje}</span>
          {onCerrar && (
            <button
              type="button"
              onClick={() => onCerrar(t.id)}
              aria-label="Cerrar aviso"
              className="ml-1 -mr-1 p-1 rounded hover:bg-white/20 transition-colors shrink-0"
            >
              <FiX size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
