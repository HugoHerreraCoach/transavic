// src/app/dashboard/caja-diaria/page.tsx
import CajaDiariaClient from "./caja-diaria-client";

export const metadata = {
  title: "Caja Diaria | Transavic",
};

export default function CajaDiariaPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <CajaDiariaClient />
    </div>
  );
}
