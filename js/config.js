/* ==========================================================================
   config.js  -  global namespace, feature flags and simulation constants
   --------------------------------------------------------------------------
   Every optional module checks PLANT.FEATURES before it is initialised.
   Set a flag to false to remove that feature from the UI (nothing else
   needs to be edited).  All scripts are classic <script> files (no ES-module
   imports) so the project also works when index.html is opened straight from
   disk (file://), where browsers block module loading.
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  /* ---------- tiny publish/subscribe bus used by every module ---------- */
  const handlers = {};
  P.bus = {
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    emit(evt, data) {
      (handlers[evt] || []).forEach(fn => {
        try { fn(data); } catch (e) { console.error('bus handler error', evt, e); }
      });
    }
  };

  /* ---------- feature flags (true = enabled) ---------- */
  P.FEATURES = {
    pwa: true,               // register service worker (only on http/https)
    tour: true,              // guided tour on first launch
    tutorial: true,          // tutorial / exercises
    scenarios: true,         // fault scenarios menu
    urdu: true,              // English/Urdu toggle
    sound: true,             // alarm beeper
    historian: true,         // IndexedDB historian
    modbus: true,            // Modbus register map + frame simulator
    fbdSfc: true,            // FBD and SFC views
    versionHistory: true,    // named snapshots of program+tags
    energy: true,
    maintenance: true,
    autoLogout: true,
    screenLock: true
  };

  /* ---------- simulation constants ---------- */
  P.SIM = {
    scanMs: 50,              // default PLC scan time (simulated ms)
    tickMs: 50,              // real time between UI/sim ticks
    maxScansPerTick: 400,
    speeds: [0.5, 1, 2, 5, 10],
    histPeriodMs: 1000,      // historian sample period (simulated time)
    lockAfterSec: 180,       // screen lock after inactivity (real seconds)
    logoutAfterSec: 600,     // auto-logout after inactivity (real seconds)
    tariffPKR: 48,           // default electricity tariff, PKR per kWh
    idealCansPerMin: 30      // used for the OEE performance factor
  };

  P.VERSION = '1.0.0';
  P.users = {                // demo accounts only - this is a static site
    operator: { pass: 'operator', role: 'Operator' },
    engineer: { pass: 'engineer', role: 'Engineer' },
    admin:    { pass: 'admin',    role: 'Admin' }
  };
})(typeof window !== 'undefined' ? window : globalThis);
