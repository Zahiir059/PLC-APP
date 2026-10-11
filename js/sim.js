/* ==========================================================================
   sim.js  -  wires TagDB + PLC + Plant together and runs the simulation clock
   --------------------------------------------------------------------------
   Real time -> simulated time:  simulated ms = real ms x speed.
   The PLC is scanned every `scanMs` of SIMULATED time, so timers behave the
   same at every speed; at 10x the engine simply executes 10x more scans per
   real second.  Modules that need periodic work register with sim.every().
   ========================================================================== */
(function (g) {
  'use strict';
  const P = g.PLANT = g.PLANT || {};

  class Sim {
    constructor() {
      this.tags = new P.TagDB();
      this.plc = new P.PLC(this.tags);
      this.plant = new P.Plant(this.tags);
      this.speed = 2; this.paused = false;
      this.simMs = 0; this.acc = 0;
      this.baseClock = Date.now();           // simulated wall clock = baseClock + simMs
      this.hooks = [];
      this.plc.io = { readInputs: () => this.plant.readInputs(), writeOutputs: dt => this.plant.writeOutputs(dt) };
    }

    /** Load tag + program definitions (from storage or defaults). */
    init(tagDefs, program) {
      this.tags.load(JSON.parse(JSON.stringify(tagDefs)));
      this.plc.load(P.Program.clone(program));
      this.plant.reset(); this.simMs = 0; this.acc = 0; this.baseClock = Date.now();
      this.hooks.forEach(h => { h.next = 0; });
      this.plc.run();
    }

    /** Register periodic work (every N simulated ms). */
    every(ms, fn) { this.hooks.push({ ms, fn, next: 0 }); }
    clock() { return this.baseClock + this.simMs; }

    /** Advance by real milliseconds (called from the UI timer). */
    tick(realMs) {
      if (this.paused) return;
      this.acc += Math.min(realMs, 250) * this.speed;
      const scanMs = this.plc.scanMs; let n = 0;
      while (this.acc >= scanMs && n < P.SIM.maxScansPerTick) { this.scanOnce(scanMs); this.acc -= scanMs; n++; }
      if (n >= P.SIM.maxScansPerTick) this.acc = 0;       // CPU can't keep up: drop the backlog
    }

    scanOnce(dt) {
      dt = dt || this.plc.scanMs;
      this.plc.scan(dt);
      this.simMs += dt;
      for (let i = 0; i < this.hooks.length; i++) { const h = this.hooks[i]; if (this.simMs >= h.next) { h.next = this.simMs + h.ms; h.fn(this.simMs); } }
    }

    /** Single scan while paused / stopped (step-by-step debugging). */
    step() { if (this.plc.mode !== 'run') this.plc.mode = 'run'; this.scanOnce(); }

    /** Run N simulated seconds as fast as possible (used by tests and scenarios). */
    runSeconds(sec) { const n = Math.round(sec * 1000 / this.plc.scanMs); for (let i = 0; i < n; i++) this.scanOnce(); }

    /** Helpers for HMI / tests */
    pulse(tag) { this.tags.set(tag, true, 'hmi'); }
    get(n) { return this.tags.get(n); }
  }
  P.Sim = Sim;
})(typeof window !== 'undefined' ? window : globalThis);
