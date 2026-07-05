"use client";
// Toast compartido para los módulos del ERP (reemplaza alert()/confirm() de feedback).
// Uso:
//   const { mostrarToast, toasts } = useToast();
//   mostrarToast("Compra registrada", "exito");
//   ... y en el JSX raíz de la vista: <ToastContainer toasts={toasts} />
// Nota: el contenedor es position:fixed bajo DashboardLayout → lleva print:hidden
// (gotcha #26: los fixed salen impresos y dejan hojas en blanco).
import { useCallback, useState } from "react";
import { FiAlertCircle, FiCheckCircle, FiInfo } from "react-icons/fi";

export type TipoToast = "exito" | "error" | "info";

export interface ToastItem {
  id: number;
  mensaje: string;
  tipo: TipoToast;
}

const DURACION_MS = 4500;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const mostrarToast = useCallback((mensaje: string, tipo: TipoToast = "exito") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, mensaje, tipo }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, DURACION_MS);
  }, []);

  return { mostrarToast, toasts };
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

export function ToastContainer({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 items-center print:hidden pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium max-w-[90vw] animate-[fadeIn_.2s_ease-out] ${ESTILOS[t.tipo]}`}
          role="status"
        >
          {ICONOS[t.tipo]}
          <span>{t.mensaje}</span>
        </div>
      ))}
    </div>
  );
}
