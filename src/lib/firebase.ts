import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, isSupported } from "firebase/messaging";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Safe dynamic getter for Messaging (since initialization is async in React/Next)
export async function getClientMessaging() {
  if (typeof window === "undefined") return null;

  // Si no hay API Key o Project ID configurados, no intentar registrar FCM
  if (
    !process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY === "undefined" ||
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY.includes("YOUR_")
  ) {
    return null;
  }

  try {
    const supported = await isSupported();
    if (!supported) return null;

    const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    return getMessaging(app);
  } catch (err) {
    console.warn("Error al inicializar cliente FCM:", err);
    return null;
  }
}
