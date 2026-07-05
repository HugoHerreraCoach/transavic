// src/components/BetaPlaceholder.tsx
"use client";

import { FiTool } from "react-icons/fi";

export default function BetaPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="bg-indigo-50 p-6 rounded-full mb-6">
        <FiTool className="h-12 w-12 text-indigo-500" />
      </div>
      <h1 className="text-3xl font-extrabold text-gray-900 mb-4">{title} <span className="text-sm font-bold bg-orange-100 text-orange-700 px-2 py-1 rounded-full align-middle">BETA</span></h1>
      <p className="text-lg text-gray-600 max-w-lg mx-auto">
        {description}
      </p>
    </div>
  );
}
