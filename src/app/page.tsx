// src/app/page.tsx

import { redirect } from 'next/navigation';

export default function HomePage() {
  // Redirigir automáticamente al formulario de pedidos protegido
  redirect('/dashboard/nuevo-pedido');
}