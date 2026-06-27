"use client";

// ── Seguimiento de ubicación en la APP NATIVA (Capacitor) ──
// Solo hace algo dentro de la app Android (en web devuelve null / no corre).
// Se carga con next/dynamic({ ssr:false }) desde mi-ruta-content para que el import
// de @capacitor/core nunca se evalúe en el servidor.
//
// Regla: el GPS es OBLIGATORIO mientras el repartidor tenga pedidos activos del día
// (prop `hayPedidosActivos`). NO hay botón de "pausar": el motorizado no puede
// apagar el envío durante su jornada. Cuando termina todas sus entregas, el
// seguimiento se detiene solo (privacidad fuera de jornada).
//
// Flujo (orden exigido por Google Play):
//   1) AVISO DESTACADO que explica el uso de la ubicación  →  el repartidor acepta
//   2) recién ahí se pide el permiso del sistema y arranca el seguimiento
//   3) el GPS se reporta al backend con CapacitorHttp (HTTP nativo, NO el fetch del
//      WebView que Android estrangula en segundo plano) cada ~12s
// Rastrea en segundo plano vía foreground service (notificación fija), sin
// ACCESS_BACKGROUND_LOCATION (evita la revisión especial de Play).
//
// Si el repartidor revoca el permiso teniendo pedidos activos: se envía un BEACON
// al backend (alerta inmediata al admin), se muestra un banner rojo NO bloqueante
// (la ruta sigue visible) y se reintenta enganchar el GPS hasta que reactive el permiso.

import { useEffect, useRef, useState, useCallback } from "react";
import { registerPlugin, CapacitorHttp, type PluginListenerHandle } from "@capacitor/core";
import type { BackgroundGeolocationPlugin } from "@capacitor-community/background-geolocation";
import { LocalNotifications } from "@capacitor/local-notifications";
import { App } from "@capacitor/app";
import {
  FiMapPin,
  FiNavigation,
  FiAlertTriangle,
  FiChevronDown,
  FiChevronUp,
  FiSettings,
} from "react-icons/fi";
import { esPlataformaNativa } from "@/lib/plataforma";

const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>("BackgroundGeolocation");

const REPORTAR_CADA_MS = 12000; // máx ~1 reporte cada 12s
const CONSENT_KEY = "transavic_gps_consent_v1";
const PENDIENTE_KEY = "transavic_gps_pendiente_v1"; // última posición sin confirmar (cola offline)
const REINTENTO_PENDIENTE_MS = 30000; // reintento de la pendiente cuando no hubo movimiento
const REINTENTO_PERMISO_MS = 45000; // si quedó sin permiso, reintenta enganchar el GPS

const HEARTBEAT_MS = 90000; // latido cada 90 s si no hay movimiento
const WATCHDOG_REINICIO_MS = 300000; // sanación ciega del watcher cada 5 minutos
const SILENCIO_MAX_MS = 150000; // umbral de inactividad de 2.5 min para reiniciar al volver al primer plano

type EstadoSeguimiento = "inactivo" | "iniciando" | "activo" | "sin-permiso" | "error";

type PayloadUbicacion = {
  lat: number;
  lng: number;
  accuracy?: number;
  heading?: number;
  speed?: number;
  capturedAt: string;
  simulated?: boolean; // GPS falso (mock provider); el servidor lo rechaza como posición
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

// Avisa al backend que el GPS se apagó por una causa DELIBERADA (revocó el permiso).
// Best-effort: si no hay señal, se pierde — el cron del servidor es la red de seguridad.
async function enviarBeacon(evento: "permiso_revocado" | "gps_off"): Promise<void> {
  const base = typeof window !== "undefined" ? window.location.origin : "";
  try {
    await CapacitorHttp.post({
      url: `${base}/api/repartidor/beacon`,
      headers: { "Content-Type": "application/json" },
      webFetchExtra: { credentials: "include" },
      data: { evento },
    });
  } catch {
    /* best-effort */
  }
}

// Enciende el watcher nativo cuando `activo`. Reporta al backend (throttle +
// cola offline) y devuelve el estado para que la UI muestre qué está pasando.
function useSeguimientoUbicacionNativo(activo: boolean): EstadoSeguimiento {
  const [estado, setEstado] = useState<EstadoSeguimiento>("inactivo");
  const ultimoEnvioRef = useRef(0);
  // Para no spamear el beacon: se manda UNA vez por episodio de "sin permiso" y se
  // rearma cuando vuelve a llegar una ubicación válida.
  const beaconEnviadoRef = useRef(false);
  // Espejo del estado: lo lee el setInterval de reintento sin re-suscribir el efecto.
  const estadoRef = useRef<EstadoSeguimiento>("inactivo");

  // Refs de control para latido y watchdog
  const ultimaPosicionRef = useRef<PayloadUbicacion | null>(null);
  const ultimoCallbackRef = useRef<number>(Date.now());
  const reiniciandoRef = useRef(false);

  useEffect(() => {
    estadoRef.current = estado;
  }, [estado]);

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

    // Latido (Heartbeat): reenvía la última ubicación conocida si el motorizado está quieto.
    // CapturedAt fresco indica que la app y el dispositivo están vivos.
    const heartbeatInterval = setInterval(() => {
      if (cancelado || !activo || !ultimaPosicionRef.current) return;
      const ahora = Date.now();
      if (ahora - ultimoEnvioRef.current >= HEARTBEAT_MS) {
        const payload: PayloadUbicacion = {
          ...ultimaPosicionRef.current,
          capturedAt: new Date().toISOString(),
        };
        ultimoEnvioRef.current = ahora;
        void (async () => {
          if (await enviarUbicacion(payload)) guardarPendiente(null);
        })();
      }
    }, HEARTBEAT_MS);

    const removerWatcherActual = async () => {
      if (watcherId) {
        const id = watcherId;
        watcherId = null;
        try {
          await BackgroundGeolocation.removeWatcher({ id });
        } catch {}
      }
    };

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
            distanceFilter: 15, // metros: filtra micro-movimientos, optimizado de 20 a 15
          },
          (location, error) => {
            if (error) {
              if (error.code === "NOT_AUTHORIZED") {
                if (!cancelado) setEstado("sin-permiso");
                // Avisar al backend UNA vez por episodio (apagado deliberado).
                if (!beaconEnviadoRef.current) {
                  beaconEnviadoRef.current = true;
                  void enviarBeacon("permiso_revocado");
                }
              } else if (!cancelado) {
                setEstado("error");
              }
              return;
            }
            if (!location) return;
            if (!cancelado) setEstado("activo");
            beaconEnviadoRef.current = false; // recuperó la señal → rearmar el beacon

            // Actualizar tiempo de último callback y última posición para el latido/watchdog
            ultimoCallbackRef.current = Date.now();

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
              // El plugin marca si la posición vino de un "mock provider" (GPS falso).
              // El servidor decide qué hacer; acá solo lo reportamos con honestidad.
              simulated: location.simulated === true,
            };

            ultimaPosicionRef.current = payload;

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

    // Watchdog: reinicia ciegamente el watcher cada 5 minutos para rescatar bloqueos silenciosos del sistema operativo.
    const watchdogInterval = setInterval(() => {
      if (cancelado || estadoRef.current === "sin-permiso" || reiniciandoRef.current) return;
      void (async () => {
        reiniciandoRef.current = true;
        await removerWatcherActual();
        await iniciar();
        reiniciandoRef.current = false;
      })();
    }, WATCHDOG_REINICIO_MS);

    // Re-enganche al volver al primer plano (foreground)
    let resumeHandle: PluginListenerHandle | null = null;
    App.addListener("resume", () => {
      if (cancelado) return;
      void flushPendiente();
      const ahora = Date.now();
      if (
        ahora - ultimoCallbackRef.current > SILENCIO_MAX_MS &&
        estadoRef.current !== "sin-permiso" &&
        !reiniciandoRef.current
      ) {
        // Silencio muy largo: forzar reinicio del watcher
        void (async () => {
          reiniciandoRef.current = true;
          await removerWatcherActual();
          await iniciar();
          reiniciandoRef.current = false;
        })();
      }
    }).then((h) => {
      if (cancelado) h.remove();
      else resumeHandle = h;
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && !cancelado) {
        void flushPendiente();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Reintento de permiso: si el motorizado revocó el permiso (o falló el arranque),
    // cada ~45s reiniciamos el watcher. Apenas reactive el permiso desde Ajustes, el
    // nuevo addWatcher engancha y el seguimiento vuelve solo, sin que tenga que hacer nada.
    const reintentoPermiso = setInterval(() => {
      if (cancelado) return;
      const e = estadoRef.current;
      if (e === "sin-permiso" || e === "error") {
        void (async () => {
          await removerWatcherActual();
          await iniciar();
        })();
      }
    }, REINTENTO_PERMISO_MS);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      clearInterval(reintentoPermiso);
      clearInterval(heartbeatInterval);
      clearInterval(watchdogInterval);
      if (resumeHandle) resumeHandle.remove();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (watcherId) void BackgroundGeolocation.removeWatcher({ id: watcherId });
    };
  }, [activo]);

  return estado;
}

// ── UI: aviso destacado → estado → tips de batería ──

export function SeguimientoUbicacionNativo({
  hayPedidosActivos,
}: {
  hayPedidosActivos: boolean;
}) {
  const [esNativo, setEsNativo] = useState(false);
  const [consent, setConsent] = useState(false);
  const [verTips, setVerTips] = useState(false);

  // Este componente se monta solo en el navegador (ssr:false), así que leer
  // localStorage / el global de Capacitor acá es seguro.
  useEffect(() => {
    setEsNativo(esPlataformaNativa());
    try {
      setConsent(localStorage.getItem(CONSENT_KEY) === "1");
    } catch {
      /* localStorage no disponible */
    }
  }, []);

  // El GPS arranca solo si: estamos en la app, dio el consentimiento, y tiene
  // pedidos activos. NO hay pausa manual: durante la jornada no se puede apagar.
  const estado = useSeguimientoUbicacionNativo(esNativo && consent && hayPedidosActivos);

  const aceptar = useCallback(() => {
    try {
      localStorage.setItem(CONSENT_KEY, "1");
    } catch {}
    setConsent(true);
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
              notificación fija. Se activa automáticamente cuando tienes entregas
              asignadas y se detiene sola al completarlas.
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
  const alerta = sinPermiso || conError;
  // Sin pedidos activos: el GPS está apagado A PROPÓSITO (privacidad fuera de jornada),
  // no es una falla. Lo explicamos para que no se confunda con un problema.
  const inactivoPorJornada = !hayPedidosActivos;

  return (
    <div
      className={`bg-white rounded-2xl shadow-sm p-3 anim-fade ${
        alerta ? "border-2 border-red-300 ring-1 ring-red-100" : "border border-gray-200"
      }`}
    >
      <div className="flex items-center gap-3">
        <div
          className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
            enVivo ? "bg-emerald-50" : alerta ? "bg-red-50" : "bg-gray-100"
          }`}
        >
          <FiNavigation
            size={18}
            className={enVivo ? "text-emerald-600" : alerta ? "text-red-600" : "text-gray-400"}
          />
        </div>

        <div className="flex-1 min-w-0">
          {enVivo ? (
            <p className="text-sm font-semibold text-emerald-700 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Compartiendo tu ubicación
            </p>
          ) : iniciando ? (
            <p className="text-sm font-semibold text-gray-600">Activando ubicación…</p>
          ) : sinPermiso ? (
            <p className="text-sm font-semibold text-red-700">Falta el permiso de ubicación</p>
          ) : conError ? (
            <p className="text-sm font-semibold text-red-700">No se pudo iniciar el GPS</p>
          ) : (
            <p className="text-sm font-semibold text-gray-500">Seguimiento en espera</p>
          )}
          <p className="text-[11px] text-gray-400">
            {alerta
              ? "La central queda avisada cuando tu ubicación se apaga. Reactívala para seguir en ruta."
              : inactivoPorJornada
              ? "Tu ubicación se comparte automáticamente durante tus entregas."
              : "La central ve tu recorrido en el mapa de despacho."}
          </p>
        </div>
      </div>

      {/* Acción directa si falta permiso o hubo error (banner NO bloqueante: la
          ruta sigue visible debajo). */}
      {alerta && (
        <button
          onClick={abrirAjustes}
          className="mt-2 w-full flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl py-2 transition-all active:scale-[0.98]"
        >
          <FiSettings size={13} /> Abrir ajustes y permitir la ubicación
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
          <TipBateria n={1} texto="Desactiva el “ahorro de batería” para esta app (ponla en “Sin restricciones”). Es la causa #1 de cortes." />
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
