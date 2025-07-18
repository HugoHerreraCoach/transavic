// src/app/dashboard/page.tsx

// Forzando un nuevo despliegue para limpiar el caché de Vercel
import DashboardContent from './dashboard-content';

export default function DashboardPage() {
  // Ya no es async y no accede a searchParams
  return <DashboardContent />;
}