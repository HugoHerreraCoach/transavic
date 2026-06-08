// src/components/ModalShell.tsx
// Modal genérico reutilizable: overlay oscuro + tarjeta scrolleable centrada +
// cierre con la X, Esc o clic afuera. Bloquea el scroll del fondo mientras está
// abierto. Pensado para envolver pantallas que también existen como página
// (ej. el form de emisión), sin duplicar su contenido.
"use client";

import { useEffect, useRef } from "react";
import { FiX } from "react-icons/fi";

export default function ModalShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  const isMouseDownInside = useRef(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6 anim-fade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          isMouseDownInside.current = false;
        } else {
          isMouseDownInside.current = true;
        }
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isMouseDownInside.current) {
          onClose();
        }
        isMouseDownInside.current = true;
      }}
    >
      <div
        className="relative my-2 w-full max-w-3xl overflow-x-hidden rounded-2xl bg-gray-50 pt-5 shadow-2xl anim-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute right-2 top-2 z-10 rounded-full bg-white p-2 text-gray-500 shadow-md transition hover:text-gray-900 active:scale-95"
        >
          <FiX size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}
