"use client";

// ── Seguimiento de ubicación en la APP NATIVA (Capacitor) ──
// Solo hace algo dentro de la app Android (en web devuelve null / no corre).
// Se carga con next/dynamic({ ssr:false }) desde mi-ruta-content para que el import
// de @capacitor/core nunca se evalúe en el servidor.
//
// Flujo (orden exigido por Google Play):
//   1) AVISO DESTACADO que explica el uso de la ubicación  →  el repartidor acepta
//   2) recién ahí se pide el permiso del sistema y arranca el seguimiento
//   3) el GPS se reporta al backend con CapacitorHttp (HTTP nativo, NO el fetch del
//      WebView que Android estrangula en segundo plano) cada ~12s
// Rastrea en segundo plano vía foreground service (notificación fija), sin
// ACCESS_BACKGROUND_LOCATION (evita la revisión especial de Play).

import { useEffect, useRef, useState, useCallback } from "react";
import { registerPlugin, CapacitorHttp } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import {
  FiMapPin,
  FiNavigation,
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiSettings,
  FiPause,
  FiPlay,
} from "react-icons/fi";
import { esPlataformaNativa } from "@/lib/plataforma";

const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

const REPORTAR_CADA_MS = 12000; // máx ~1 reporte cada 12s
const CONSENT_KEY = "transavic_gps_consent_v1";
const PAUSA_KEY = "transavic_gps_pausa_v1";

type EstadoSeguimiento = "inactivo" | "iniciando" | "activo" | "sin-permiso" | "error";

// Enciende el watcher nativo cuando `activo`. Reporta al backend (throttle) y
// devuelve el estado para que la UI muestre qué está pasando.
function useSeguimientoUbicacionNativo(activo: boolean): EstadoSeguimiento {
  const [estado, setEstado] = useState<EstadoSeguimiento>("inactivo");
  const ultimoRef = useRef(0);

  useEffect(() => {
    if (!activo) {
      setEstado("inactivo");
      return;
    }
    let watcherId: string | null = null;
    let cancelado = false;
    setEstado("iniciando");

    BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "Transavic Reparto",
        backgroundMessage: "Compartiendo tu ubicación con la central mientras repartes.",
        requestPermissions: true,
        stale: false,
        distanceFilter: 20, // metros: filtra micro-movimientos, ahorra datos y batería
      },
      (location, error) => {
        if (error) {
          setEstado(error.code === "NOT_AUTHORIZED" ? "sin-permiso" : "error");
          return;
        }
        if (!location) return;
        if (!cancelado) setEstado("activo");

        const ahora = Date.now();
        if (ahora - ultimoRef.current < REPORTAR_CADA_MS) return;
        ultimoRef.current = ahora;

        const base = typeof window !== "undefined" ? window.location.origin : "";
        CapacitorHttp.post({
          url: `${base}/api/repartidor/ubicacion`,
          headers: { "Content-Type": "application/json" },
          // En nativo las cookies de sesión las maneja la capa nativa; esto cubre
          // además el caso de que CapacitorHttp caiga a fetch web.
          webFetchExtra: { credentials: "include" },
          data: {
            lat: location.latitude,
            lng: location.longitude,
            accuracy: typeof location.accuracy === "number" ? location.accuracy : undefined,
            heading:
              typeof location.bearing === "number" && location.bearing >= 0
                ? location.bearing
                : undefined,
            speed:
              typeof location.speed === "number" && location.speed >= 0
                ? location.speed
                : undefined,
            capturedAt: new Date(location.time ?? Date.now()).toISOString(),
          },
        }).catch(() => {
          // best-effort: el próximo fix del GPS reintenta
        });
      }
    )
      .then((id) => {
        if (cancelado) {
          BackgroundGeolocation.removeWatcher({ id }).catch(() => {});
        } else {
          watcherId = id;
        }
      })
      .catch(() => setEstado("error"));

    return () => {
      cancelado = true;
      if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId }).catch(() => {});
    };
  }, [activo]);

  return estado;
}

// ── UI: aviso destacado → estado → tips de batería ──

export function SeguimientoUbicacionNativo() {
  const [esNativo, setEsNativo] = useState(false);
  const [consent, setConsent] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [verTips, setVerTips] = useState(false);

  // Este componente se monta solo en el navegador (ssr:false), así que leer
  // localStorage / el global de Capacitor acá es seguro.
  useEffect(() => {
    setEsNativo(esPlataformaNativa());
    try {
      setConsent(localStorage.getItem(CONSENT_KEY) === "1");
      setPausado(localStorage.getItem(PAUSA_KEY) === "1");
    } catch {
      /* localStorage no disponible */
    }
  }, []);

  const estado = useSeguimientoUbicacionNativo(esNativo && consent && !pausado);

  const aceptar = useCallback(() => {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
      localStorage.removeItem(PAUSA_KEY);
    } catch {}
    setPausado(false);
    setConsent(true);
  }, []);

  const togglePausa = useCallback(() => {
    setPausado((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(PAUSA_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  }, []);

  const abrirAjustes = useCallback(() => {
    BackgroundGeolocation.openSettings().catch(() => {});
  }, []);

  if (!esNativo) return null; // en web no se muestra nada

  // 1) Aún no aceptó → AVISO DESTACADO (requisito de Play antes de pedir ubicación)
  if (!consent) {
    return (
      <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-4 anim-fade">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
            <FiMapPin className="text-amber-600" size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-gray-900 text-sm">Compartir tu ubicación</h3>
            <p className="text-xs text-gray-600 mt-1 leading-relaxed">
              Para que la central vea tu recorrido en el mapa y coordine mejor las
              entregas, esta app comparte tu ubicación{" "}
              <strong>mientras repartes, aunque la pantalla esté apagada o la app
              quede en segundo plano</strong>. Mientras se comparte verás una
              notificación fija. Puedes pausarla cuando termines tu jornada.
            </p>
          </div>
        </div>
        <button
          onClick={aceptar}
          className="mt-3 w-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl py-2.5 transition-all active:scale-[0.98]"
        >
          Activar ubicación
        </button>
      </div>
    );
  }

  // 2) Ya aceptó → tira de estado + tips de batería
  const enVivo = estado === "activo";
  const iniciando = estado === "iniciando";
  const sinPermiso = estado === "sin-permiso";
  const conError = estado === "error";

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-3 anim-fade">
      <div className="flex items-center gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            enVivo ? "bg-emerald-50" : sinPermiso || conError ? "bg-red-50" : "bg-gray-100"
          }`}
        >
          <FiNavigation
            size={18}
            className={
              enVivo
                ? "text-emerald-600"
                : sinPermiso || conError
                ? "text-red-600"
                : "text-gray-400"
            }
          />
        </div>

        <div className="flex-1 min-w-0">
          {pausado ? (
            <p className="text-sm font-semibold text-gray-500">Ubicación en pausa</p>
          ) : enVivo ? (
            <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Compartiendo tu ubicación
            </p>
          ) : iniciando ? (
            <p className="text-sm font-semibold text-gray-600">Activando ubicación…</p>
          ) : sinPermiso ? (
            <p className="text-sm font-semibold text-red-700">Falta el permiso de ubicación</p>
          ) : (
            <p className="text-sm font-semibold text-red-700">No se pudo iniciar el GPS</p>
          )}
          <p className="text-[11px] text-gray-400">
            {pausado
              ? "No se está enviando tu ubicación."
              : sinPermiso
              ? "Tócalo para abrir los ajustes y permitir la ubicación."
              : "La central ve tu recorrido en el mapa de despacho."}
          </p>
        </div>

        {/* Pausar / Reanudar */}
        <button
          onClick={togglePausa}
          className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 transition-all active:scale-[0.97] flex items-center gap-1"
        >
          {pausado ? (
            <>
              <FiPlay size={12} /> Reanudar
            </>
          ) : (
            <>
              <FiPause size={12} /> Pausar
            </>
          )}
        </button>
      </div>

      {/* Acción directa si falta permiso o hubo error */}
      {(sinPermiso || conError) && !pausado && (
        <button
          onClick={abrirAjustes}
          className="mt-2 w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl py-2 transition-all active:scale-[0.98]"
        >
          <FiSettings size={13} /> Abrir ajustes de la app
        </button>
      )}

      {/* Tips para que Android no corte la ubicación */}
      <button
        onClick={() => setVerTips((v) => !v)}
        className="mt-2 w-full flex items-center justify-between text-[11px] text-gray-400 hover:text-gray-600 transition-colors px-1"
      >
        <span className="flex items-center gap-1">
          <FiAlertTriangle size={11} /> ¿Se corta la ubicación? Ajusta tu teléfono
        </span>
        {verTips ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
      </button>

      {verTips && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-2 anim-fade">
          <TipBateria n={1} texto="Desactiva el “ahorro de batería” para esta app (ponla en “Sin restricciones”)." />
          <TipBateria n={2} texto="Permite que la app se “inicie sola” / autostart (en Xiaomi, Oppo, Vivo y Huawei está en los ajustes de la app)." />
          <TipBateria n={3} texto="No cierres la app deslizándola desde “Recientes” durante tu jornada." />
          <button
            onClick={abrirAjustes}
            className="w-full flex items-center justify-center gap-1.5 bg-gray-900 hover:bg-black text-white text-xs font-semibold rounded-xl py-2 transition-all active:scale-[0.98]"
          >
            <FiSettings size={13} /> Abrir ajustes de la app
          </button>
        </div>
      )}
    </div>
  );
}

function TipBateria({ n, texto }: { n: number; texto: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-[10px] font-bold flex items-center justify-center flex-shrink-0">
        {n}
      </span>
      <p className="text-[11px] text-gray-600 leading-relaxed">{texto}</p>
    </div>
  );
}
