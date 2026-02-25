// src/app/dashboard/resumen/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import ResumenClient from "./resumen-client";

export default async function Page() {
    const session = await auth();

    if (session?.user?.role !== 'admin') {
        redirect('/dashboard');
    }

    return <ResumenClient />;
}
