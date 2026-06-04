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
import { LocalNotifications } from "@capacitor/local-notifications";
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
const PENDIENTE_KEY = "transavic_gps_pendiente_v1"; // última posición sin confirmar (cola offline)
const REINTENTO_PENDIENTE_MS = 30000; // reintento de la pendiente cuando no hubo movimiento

type EstadoSeguimiento = "inactivo" | "iniciando" | "activo" | "sin-permiso" | "error";

type PayloadUbicacion = {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  capturedAt: string;
};

// ── Cola offline (modelo "última posición") ──
// El backend guarda 1 sola fila por motorizado (UPSERT), así que basta con
// asegurar que la ÚLTIMA posición capturada termine llegando. La guardamos en
// localStorage; si el envío falla (sin señal), queda "pendiente" y se reintenta
// hasta que entre. Así el punto del mapa se pone al día apenas vuelve el
// internet, incluso si el motorizado está parado y el GPS ya no dispara.
function leerPendiente(): PayloadUbicacion | null {
  try {
    const s = localStorage.getItem(PENDIENTE_KEY);
    return s ? (JSON.parse(s) as PayloadUbicacion) : null;
  } catch {
    return null;
  }
}
function guardarPendiente(p: PayloadUbicacion | null) {
  try {
    if (p) localStorage.setItem(PENDIENTE_KEY, JSON.stringify(p));
    else localStorage.removeItem(PENDIENTE_KEY);
  } catch {
    // localStorage lleno o no disponible: no es crítico
  }
}
// Envía una posición al backend por HTTP nativo. true solo si el server la aceptó.
async function enviarUbicacion(p: PayloadUbicacion): Promise<boolean> {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  try {
    const res = await CapacitorHttp.post({
      url: `${base}/api/repartidor/ubicacion`,
      headers: { "Content-Type": "application/json" },
      // En nativo las cookies de sesión las maneja la capa nativa; esto cubre
      // además el caso de que CapacitorHttp caiga al fetch del WebView.
      webFetchExtra: { credentials: "include" },
      data: p,
    });
    return typeof res?.status === "number" && res.status >= 200 && res.status < 300;
  } catch {
    return false; // sin señal / error de red → queda pendiente para reintento
  }
}

// Enciende el watcher nativo cuando `activo`. Reporta al backend (throttle +
// cola offline) y devuelve el estado para que la UI muestre qué está pasando.
function useSeguimientoUbicacionNativo(activo: boolean): EstadoSeguimiento {
  const [estado, setEstado] = useState<EstadoSeguimiento>("inactivo");
  const ultimoEnvioRef = useRef(0);

  useEffect(() => {
    if (!activo) {
      setEstado("inactivo");
      return;
    }
    let watcherId: string | null = null;
    let cancelado = false;
    setEstado("iniciando");

    // Reintenta mandar la posición pendiente (la guardada cuando no había señal).
    const flushPendiente = async () => {
      const p = leerPendiente();
      if (!p) return;
      if (await enviarUbicacion(p)) guardarPendiente(null);
    };

    // Reintento periódico: cubre el caso "parado sin señal" (el watcher no dispara
    // sin movimiento, así que sin esto la última posición no llegaría hasta el
    // próximo movimiento). Liviano: solo actúa si hay algo pendiente.
    const intervalo = setInterval(() => {
      if (!cancelado) void flushPendiente();
    }, REINTENTO_PENDIENTE_MS);

    const iniciar = async () => {
      // 1) Permiso de notificación (POST_NOTIFICATIONS, Android 13+). El
      //    seguimiento corre con un "foreground service" que DEBE mostrar una
      //    notificación fija; sin este permiso Android la oculta y los equipos
      //    agresivos (HONOR/Xiaomi…) congelan el servicio. Best-effort, no bloquea.
      try {
        await LocalNotifications.requestPermissions();
      } catch {
        // si falla, el watcher igual intenta arrancar
      }
      if (cancelado) return;

      // 2) Por si quedó una posición sin enviar de una sesión anterior.
      void flushPendiente();

      // 3) Arrancar el watcher de GPS en segundo plano.
      try {
        const id = await BackgroundGeolocation.addWatcher(
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

            const payload: PayloadUbicacion = {
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
            };

            // Guarda SIEMPRE la última posición como pendiente; se borra al
            // confirmarse el envío. Así nunca se pierde la más reciente.
            guardarPendiente(payload);

            const ahora = Date.now();
            if (ahora - ultimoEnvioRef.current < REPORTAR_CADA_MS) return; // throttle de envíos
            ultimoEnvioRef.current = ahora;

            void (async () => {
              if (await enviarUbicacion(payload)) guardarPendiente(null);
            })();
          }
        );
        if (cancelado) {
          void BackgroundGeolocation.removeWatcher({ id });
        } else {
          watcherId = id;
        }
      } catch {
        if (!cancelado) setEstado("error");
      }
    };

    void iniciar();

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
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
