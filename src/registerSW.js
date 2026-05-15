// VITE_APP_URL muss in Vercel Project Settings gesetzt sein (nur Production)
// z.B. https://zeittracker.vercel.app
const PROD = import.meta.env.VITE_APP_URL || null;
const PROD_ORIGIN = PROD ? new URL(PROD).origin : null;

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  // Auf Preview-Deployments keinen SW registrieren.
  // Installation nur über die Production-URL – sonst holt die installierte PWA
  // Updates von der zufälligen Preview-URL und bricht nach deren Ablauf.
  if (PROD_ORIGIN && window.location.origin !== PROD_ORIGIN) {
    console.info(
      `[SW] Preview-Umgebung erkannt (${window.location.origin}).`,
      `SW deaktiviert. Installiere nur über: ${PROD}`
    );
    return;
  }

  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

    // Sofort beim Seitenfokus auf Update prüfen
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });

    // Stündlich auf Updates prüfen
    setInterval(() => reg.update(), 60 * 60 * 1000);

    // Neuen SW aktivieren sobald er wartet
    const applyUpdate = (worker) => {
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          // Neuer SW wartet – sofort aktivieren
          worker.postMessage({ type: 'SKIP_WAITING' });
        }
      });
    };

    // Falls bereits ein wartender SW existiert (z.B. nach Seiten-Reload)
    if (reg.waiting) applyUpdate(reg.waiting);

    reg.addEventListener('updatefound', () => {
      if (reg.installing) applyUpdate(reg.installing);
    });

    // Seite neu laden sobald neuer SW die Kontrolle übernimmt
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!reloading) { reloading = true; window.location.reload(); }
    });

  } catch (err) {
    console.error('[SW] Registrierung fehlgeschlagen:', err);
  }
}
