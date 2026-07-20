// src/components/LeadAssignmentBanner.tsx
"use client";

import React, { useEffect, useState, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FiClock, FiCheck, FiX, FiAlertTriangle } from "react-icons/fi";
import { usePollingVisible } from "@/lib/use-polling-visible";

interface QueuedLead {
  id: string;
  nombre: string;
  telefono: string;
  estado_asignacion: string;
  candidatos_nivel: string[];
  candidato_actual: string | null;
  inicio_turno: string | null;
  timeout_nivel: number;
  golden_ticket_phase: string;
}

export default function LeadAssignmentBanner() {
  const router = useRouter();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [activeLeads, setActiveLeads] = useState<QueuedLead[]>([]);
  const [timeLeft, setTimeLeft] = useState<number>(30);
  const notifiedIds = useRef<Set<string>>(new Set());

  // 1. Obtener la sesión actual del usuario
  useEffect(() => {
    async function loadSession() {
      try {
        const res = await fetch("/api/auth/session");
        if (res.ok) {
          const session = await res.json();
          if (session?.user) {
            setCurrentUserId(session.user.id);
            setUserRole(session.user.role);
          }
        }
      } catch (err) {
        console.error("Error al cargar sesión en banner:", err);
      }
    }
    loadSession();
  }, []);

  // Play alert beep with fallback to browser synth
  const playAlertSound = () => {
    try {
      const audio = new Audio("/sounds/notification-sound.mp3");
      audio.play().catch(() => {
        // Fallback: Web Audio API synth beep (880Hz A5 note)
        const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      });
    } catch {
      // Autoplay blocked by browser policy
    }
  };

  // 2. Consultar leads en cola cada 4 segundos
  const fetchCola = async () => {
    if (!currentUserId || (userRole !== "asesor" && userRole !== "admin")) return;
    try {
      const res = await fetch("/api/crm/leads/cola");
      if (res.ok) {
        const data = await res.json();
        const leads = (data.leads || []) as QueuedLead[];
        
        setActiveLeads(leads);

        // Notificar si llega un lead nuevo no visto
        const newLeads = leads.filter(l => !notifiedIds.current.has(l.id));
        if (newLeads.length > 0) {
          playAlertSound();
          newLeads.forEach(l => notifiedIds.current.add(l.id));
        }

        // Limpiar IDs antiguos
        const currentIds = new Set(leads.map(l => l.id));
        notifiedIds.current.forEach(id => {
          if (!currentIds.has(id)) notifiedIds.current.delete(id);
        });
      }
    } catch (err) {
      console.error("Error al consultar cola de leads:", err);
    }
  };

  usePollingVisible(fetchCola, 4000, { enabled: !!currentUserId });

  // 3. Temporizador de cuenta regresiva
  useEffect(() => {
    if (activeLeads.length === 0) return;
    const lead = activeLeads[0];

    const calculateTimeLeft = () => {
      if (!lead.inicio_turno) return lead.timeout_nivel;
      const start = new Date(lead.inicio_turno).getTime();
      const elapsed = Math.floor((Date.now() - start) / 1000);
      const remaining = lead.timeout_nivel - elapsed;
      return remaining > 0 ? remaining : 0;
    };

    setTimeLeft(calculateTimeLeft());

    const timer = setInterval(() => {
      const remaining = calculateTimeLeft();
      setTimeLeft(remaining);

      // Si se acaba el tiempo, si es el candidato actual hace skip
      if (remaining <= 0) {
        clearInterval(timer);
        if (lead.candidato_actual === currentUserId) {
          handleSkip(lead.id);
        } else {
          // Descartar localmente
          setActiveLeads(prev => prev.filter(l => l.id !== lead.id));
        }
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [activeLeads, currentUserId]);

  if (activeLeads.length === 0) return null;

  const lead = activeLeads[0];
  const esCandidatoActual = lead.candidato_actual === currentUserId;

  const handleAccept = async (leadId: string) => {
    try {
      const res = await fetch(`/api/crm/leads/${leadId}/atender`, { method: "POST" });
      const result = await res.json();
      if (result.success) {
        setActiveLeads(prev => prev.filter(l => l.id !== leadId));
        router.push(`/dashboard/crm-leads?leadId=${leadId}`);
        router.refresh();
      } else {
        alert(result.message || "No se pudo aceptar el lead.");
        fetchCola();
      }
    } catch (err) {
      console.error(err);
      alert("Error de conexión al aceptar lead.");
    }
  };

  const handleSkip = async (leadId: string) => {
    try {
      setActiveLeads(prev => prev.filter(l => l.id !== leadId));
      await fetch(`/api/crm/leads/${leadId}/pasar`, { method: "POST" });
      fetchCola();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="fixed top-18 md:top-4 left-1/2 -translate-x-1/2 z-50 w-[92%] md:w-auto md:min-w-[420px] max-w-lg animate-in slide-in-from-top-4 duration-300">
      <div className="bg-amber-500 text-white p-3.5 rounded-2xl md:rounded-full shadow-2xl flex flex-col md:flex-row items-center justify-between gap-3 border-2 border-white/20">
        
        {/* Info del Lead */}
        <div className="flex items-center gap-2.5 min-w-0 px-2">
          <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center font-black text-sm shrink-0">
            {lead.golden_ticket_phase === "rescue" ? "🚨" : "🎫"}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="font-extrabold text-[13px] leading-tight uppercase tracking-wider block">
              {lead.golden_ticket_phase === "rescue" ? "🚨 ¡Rescate de Lead!" : "🎫 ¡Nuevo Lead en Cola!"}
            </span>
            <span className="text-[11px] text-amber-50 font-bold truncate max-w-[200px]">
              {lead.nombre} ({lead.telefono})
            </span>
          </div>
        </div>

        {/* Reloj y Acciones */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Cronómetro */}
          <div className="flex items-center gap-1.5 bg-black/15 px-3 py-1 rounded-lg">
            <FiClock className="animate-pulse text-amber-100" size={14} />
            <span className={`font-mono font-black text-sm ${timeLeft < 8 ? "text-red-100 animate-pulse" : "text-white"}`}>
              {timeLeft}s
            </span>
          </div>

          {/* Botones de acción */}
          <div className="flex items-center gap-1.5">
            {esCandidatoActual && (
              <button
                onClick={() => handleSkip(lead.id)}
                className="px-3 py-1.5 bg-black/15 hover:bg-black/25 text-white rounded-full font-bold text-[10px] tracking-wider transition-all active:scale-95 cursor-pointer uppercase"
              >
                Pasar
              </button>
            )}
            <button
              onClick={() => handleAccept(lead.id)}
              className="px-4 py-1.5 bg-white text-amber-600 rounded-full font-black text-xs hover:bg-amber-50 transition-all active:scale-95 shadow-sm flex items-center gap-1 cursor-pointer uppercase"
            >
              <FiCheck size={14} strokeWidth={3} />
              Atender
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
