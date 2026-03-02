// src/lib/offline-queue.ts
// Cola de acciones offline para repartidores

export interface QueuedAction {
  id: string;
  timestamp: number;
  type: "entregar" | "fallido" | "iniciar-viaje";
  pedidoId: string;
  expectedEstado: string; // Estado esperado al momento de encolar (para detección de conflictos)
  payload: Record<string, unknown>;
  retries: number;
}

export interface SyncResult {
  synced: number;
  failed: number;
  conflicts: string[]; // pedidoIds con conflicto
}

const STORAGE_KEY = "transavic_offline_queue";
const MAX_RETRIES = 3;

// ── Queue Operations ──

export function getQueue(): QueuedAction[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function enqueueAction(action: Omit<QueuedAction, "id" | "timestamp" | "retries">): QueuedAction {
  const queue = getQueue();
  const newAction: QueuedAction = {
    ...action,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retries: 0,
  };
  queue.push(newAction);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  return newAction;
}

export function removeAction(actionId: string): void {
  const queue = getQueue().filter((a) => a.id !== actionId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function getQueueCount(): number {
  return getQueue().length;
}

// ── Sync Engine ──

export async function syncQueue(): Promise<SyncResult> {
  const queue = getQueue();
  if (queue.length === 0) return { synced: 0, failed: 0, conflicts: [] };

  const result: SyncResult = { synced: 0, failed: 0, conflicts: [] };

  for (const action of queue) {
    try {
      let url: string;
      let method: string;
      let body: Record<string, unknown>;

      switch (action.type) {
        case "entregar":
          url = `/api/pedidos/${action.pedidoId}/entregar`;
          method = "POST";
          body = { resultado: "Entregado" };
          break;
        case "fallido":
          url = `/api/pedidos/${action.pedidoId}/entregar`;
          method = "POST";
          body = { resultado: "Fallido", razon_fallo: action.payload.razon_fallo };
          break;
        case "iniciar-viaje":
          url = `/api/pedidos/${action.pedidoId}/iniciar-viaje`;
          method = "POST";
          body = {};
          break;
        default:
          removeAction(action.id);
          continue;
      }

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        removeAction(action.id);
        result.synced++;
      } else if (res.status === 400 || res.status === 409) {
        // Conflict or validation error — discard the action
        removeAction(action.id);
        result.conflicts.push(action.pedidoId);
      } else {
        // Server error — retry later
        action.retries++;
        if (action.retries >= MAX_RETRIES) {
          removeAction(action.id);
          result.failed++;
        } else {
          // Update in queue
          const q = getQueue().map((a) => (a.id === action.id ? action : a));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(q));
          result.failed++;
        }
      }
    } catch {
      // Network error — keep in queue
      action.retries++;
      if (action.retries >= MAX_RETRIES) {
        removeAction(action.id);
        result.failed++;
      }
    }
  }

  return result;
}

// ── Online Status ──

export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}
