// src/app/dashboard/page.tsx
import DashboardContent from './dashboard-content';

export default function DashboardPage() {
  // Ya no es async y no accede a searchParams
  return <DashboardContent />;
}