import { useEffect } from "react";
import { getClientMessaging } from "@/lib/firebase";
import { getToken } from "firebase/messaging";

export function usePushNotifications(userId?: string) {
  useEffect(() => {
    if (!userId || typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    async function registerAndSubscribe() {
      try {
        const messaging = await getClientMessaging();
        if (!messaging) {
          console.warn("FCM no está soportado o no está configurado en este navegador.");
          return;
        }

        // 1. Registrar el service worker
        const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        
        // 2. Solicitar permiso si no se ha decidido
        if (Notification.permission === "default") {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            console.log("Permiso de notificaciones denegado.");
            return;
          }
        } else if (Notification.permission !== "granted") {
          return;
        }

        // 3. Obtener el token de FCM
        const token = await getToken(messaging, {
          vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
          serviceWorkerRegistration: registration,
        });

        if (token) {
          // 4. Enviar el token al servidor para asociarlo con el usuario actual
          await fetch("/api/crm/push-tokens", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              token,
              deviceType: /Mobi|Android|iPhone/i.test(navigator.userAgent) ? "mobile" : "desktop",
            }),
          });
          console.log("✅ Token FCM registrado con éxito:", token.substring(0, 15) + "...");
        } else {
          console.warn("No se pudo obtener el token de FCM.");
        }
      } catch (error) {
        console.error("Error al registrar notificaciones push:", error);
      }
    }

    // Ejecutar cuando el documento esté completamente cargado
    if (document.readyState === "complete") {
      registerAndSubscribe();
    } else {
      window.addEventListener("load", registerAndSubscribe);
      return () => window.removeEventListener("load", registerAndSubscribe);
    }
  }, [userId]);
}
