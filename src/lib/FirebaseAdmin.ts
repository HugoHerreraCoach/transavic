import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getMessaging, Messaging } from "firebase-admin/messaging";

let messagingInstance: Messaging | null = null;

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY;

if (!projectId || !clientEmail || !privateKey) {
  console.warn("⚠️ Warning: Faltan variables de entorno de Firebase Admin en este entorno. Las notificaciones push estarán desactivadas.");
} else {
  try {
    const apps = getApps();
    const app = apps.length === 0 
      ? initializeApp({
          credential: cert({
            projectId,
            clientEmail,
            privateKey: privateKey.replace(/\\n/g, '\n').replace(/^"|"$/g, ''),
          }),
        })
      : apps[0];
      
    messagingInstance = getMessaging(app);
    console.log("✅ Firebase Admin inicializado correctamente");
  } catch (error) {
    console.error("❌ Error al inicializar Firebase Admin:", error);
  }
}

export const adminMessaging = messagingInstance;
