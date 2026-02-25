// src/app/dashboard/analytics/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import AnalyticsClient from "./analytics-client";

export default async function Page() {
    const session = await auth();

    if (session?.user?.role !== 'admin') {
        redirect('/dashboard');
    }

    return <AnalyticsClient />;
}
