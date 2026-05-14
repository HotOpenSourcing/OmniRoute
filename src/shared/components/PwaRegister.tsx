"use client";

import { useEffect } from "react";
import {
  isOmniRouteServiceWorkerScript,
  shouldEnablePwaRegistration,
} from "@/shared/utils/pwaRegistration";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const enableRegistration = shouldEnablePwaRegistration({
      hostname: window.location.hostname,
      isDevelopment: process.env.NODE_ENV === "development",
    });

    if (!enableRegistration) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) {
          const scriptUrl =
            registration.active?.scriptURL ||
            registration.waiting?.scriptURL ||
            registration.installing?.scriptURL;

          if (isOmniRouteServiceWorkerScript(scriptUrl)) {
            void registration.unregister();
          }
        }
      });
      return;
    }

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Ignore registration failures to avoid blocking app rendering.
    });
  }, []);

  return null;
}
