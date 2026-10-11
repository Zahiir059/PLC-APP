# Smart Beverage Filling & Packaging Plant - Web-based PLC + HMI/SCADA Simulator

**Author:** Zaheer Abbas, Electrical Engineer (FAST-NUCES) - PLC, SCADA/HMI, industrial automation

A complete, deployable portfolio project: a **PLC scan-cycle engine**, an **editable ladder-logic editor** with live power flow, a **physical process model** of a beverage plant, and an **ISA-101 style HMI/SCADA** with **ISA-18.2 alarm management** - all as a pure static website (HTML, CSS, vanilla JavaScript). No backend, no build step, no installation, no console errors.

```
Syrup/Water Tanks -> Batch Mixing -> Heating/Pasteurization -> Filling -> Capping -> Conveyor
      -> Inspection & Reject -> Labeling -> Carton Packing -> Palletizing & Wrapping
```

---

## 1. Quick start

* **Open locally:** double-click `index.html` (works from `file://`; all scripts are classic scripts, not ES modules, so browsers do not block them).
* **Launch the simulator:** `simulator/index.html` - sign in with a demo account (quick buttons on the login card):

| User | Password | Role | Can do |
|---|---|---|---|
| `operator` | `operator` | Operator | view + operate (start/stop, faceplates, acknowledge, orders) |
| `engineer` | `engineer` | Engineer | everything above + edit ladder, tags, recipes, PID tuning, suppress alarms |
| `admin` | `admin` | Admin | everything above + clear audit trail / alarm history / historian |

* **Ladder editor only:** `ladder/index.html` (same engine, full-page editor with a Start/Stop strip).
* **Self-tests:** `tests.html` (49 automated checks, shows pass/fail).
* **First run tip:** sign in, press **Start** (or `Space`) on *Plant Overview*, set the simulation speed in the bottom bar to **5x** or **10x**. A full pasteurization cycle takes ~100 simulated seconds.

> The accounts are demo accounts for a static site - they are **not real security**. Never reuse them for anything sensitive.

---

## 2. Architecture

```
 +--------------------+      tags       +--------------------+     tags      +------------------------+
 |  Field / process   | <-------------> |   PLC engine (JS)  | <-----------> |  HMI / SCADA (browser) |
 |  process-model.js  |  inputs/outputs |   plc-engine.js    |  read / write |  app.js + screens-*.js |
 |  physics + faults  |                 |   scan cycle       |               |  alarms, trends, ...   |
 +--------------------+                 +--------------------+               +------------------------+
                                           ^ tags.js (TagDB: values, force, CSV)
```

* **Strict decoupling:** the PLC never touches the process model and the process model never reads the ladder. The only link is the **tag database** (`tags.js`) - exactly like a real PLC with I/O modules.
* **One scan** (`plc-engine.js`): (1) read inputs: the process model writes sensor tags; (2) execute every rung in order; (3) write outputs: the model reads output tags and integrates the physics by one scan time.
* **Simulated time:** the PLC is scanned every `scanMs` (default 50 ms) of *simulated* time. Speed 0.5x-10x just runs more or fewer scans per real second, so timers behave identically at every speed.
* **Module overview**

| File | Purpose |
|---|---|
| `js/config.js` | namespace, event bus, **feature flags**, simulation constants |
| `js/tags.js` | tag database, force table, CSV import/export |
| `js/plc-engine.js` | scan engine, timers, counters, PID, compiler checks, Structured Text generator |
| `js/process-model.js` | tanks, dosing, heat balance, conveyor, cans, cartons, gas, power, faults |
| `js/sim.js` | wires PLC + process, simulation clock, speed, single scan |
| `js/alarms.js` | ISA-18.2 alarm manager + cause & effect data |
| `js/production.js` | recipes, orders, batches, genealogy, OEE, downtime, quality, energy, maintenance |
| `js/storage.js` | localStorage wrapper, audit trail, version history, **IndexedDB historian** |
| `js/ladder-editor.js` | SVG ladder renderer and editor |
| `js/engineering.js` | FBD, SFC, Modbus map/frames, documentation generators, PDF writer |
| `js/charts.js` | dependency-free canvas charts (trend with zoom/pan, bars, Pareto, SPC) |
| `js/app.js` | HMI shell: login, navigation, banner, shortcuts, faceplates |
| `js/screens-*.js` | HMI screens (operate, monitor, production, engineering, learn) |
| `js/selftest*.js`, `tests.html` | automated tests (engine + plant) |
| `data/default-program.json`, `data/default-tags.json` | default ladder program and tag list (also as `data/default-data.js` so the site works from `file://`) |
| `tools/build-data.js` | the generator that authored the default program and tags |
| `sw.js`, `manifest.webmanifest` | PWA (offline install) |

---

## 3. How each part works

### 3.1 PLC engine
Program = JSON tree: *sections -> rungs -> condition tree + outputs*. Conditions are **series (AND)** and **parallel (OR)** groups of contacts. Supported elements:

* contacts: NO, NC, rising edge (P), falling edge (N); comparators `== != > >= < <=`
* outputs: coil, negated coil, **Set**, **Reset** (latches)
* timers **TON / TOF / TP** (preset in ms, constant or from a tag) -> tags `NAME.Q`, `NAME.ACC`, `NAME.PRE`
* counters **CTU / CTD** (reset/load tag, preset constant or tag) -> `NAME.Q`, `NAME.CV`
* **math** block (`+ - * / mod min max abs sqrt` and `MOV`), **PID** block (positional, derivative on measurement with filter, anti-windup, bumpless Auto/Manual)
* state machine: an INT tag (`SEQ_STEP`) with compare + MOV rungs, written highest step first so exactly one step is taken per scan
* forced tags ignore logic writes and hold the forced value; **STOP** mode de-energises all outputs

### 3.2 Process model
Syrup/water tanks with refill valves, weighing mix tank, pasteurizer heat balance (first-order, heat loss, steam pressure), filler bowl, conveyor with VFD ramp, individual **cans** (position, fill volume, cap, label, temperature), reject pushers, carton/pallet flow, barcode scanner, gas concentration, power and energy per machine, runtime/starts/current/vibration per machine. Faults: sensor failure, pump overload, conveyor overload, jam, empty syrup tank, power loss, heater stuck on (overheat), gas leak, empty cap/label/can magazines.

### 3.3 Main sequence (SEQ_STEP)
`0 IDLE -> 10 PRE-CHECK -> 20 DOSE SYRUP -> 30 DOSE WATER -> 40 MIX -> 50 TRANSFER -> 60 HEAT-UP -> 70 HOLD -> 80 PRODUCE -> 90 BATCH COMPLETE -> 10 ...` until the production order target is reached (the plant then stops by itself). Stop/trip freezes the step; Start resumes. See the **SFC** tab for the live chart and *Engineering > Documentation > Sequence of operations*.

### 3.4 Safety and interlocks
* **Plant trip (latched `TRIP`)**: E-stop, power loss, gas high-high, over-temperature (95 degC), over-pressure (3.0 bar), analog sensor failure. All outputs drop out through `SAFE_OK`. Reset works only after every cause has cleared.
* **Local interlocks**: syrup/water tank empty (dry-run protection), pump overload, conveyor overload/jam (stops conveyor and stations), heater needs liquid over the element, filler bowl empty inhibits filling.
* The **Cause & Effect** page shows the matrix and lights up active causes.

### 3.5 HMI / SCADA screens
Operate: Plant Overview, P&ID, Tanks & Mixing, Heating, Filling & Conveyor, Inspection & Packaging, Operator Panel (mobile). Monitor: Alarms, Trends, Energy & KPIs, Equipment Health, Maintenance. Production: Production (orders + recipes), Batches & Traceability, Quality (SPC), Downtime (Pareto), Bottleneck, Reports. Engineering: I/O & PLC Logic, PID Tuning, Modbus Map, Cause & Effect, Audit Trail, Documentation. Learn: Training, Architecture, Project Documentation.

* **Faceplates:** click any pump, valve, the conveyor motor or the heater.
* **Header:** breadcrumbs, simulated clock, language (English/Urdu with RTL), theme (light/dark), alarm sound, screen lock, help. **Alarm banner** shows the highest-priority alarm and counts per priority.
* **Auto-lock** after 3 min idle, **auto-logout** after 10 min (`P.SIM.lockAfterSec / logoutAfterSec` in `js/config.js`).

### 3.6 Alarms (ISA-18.2)
Priorities Critical/High/Medium/Low with colours, on-delay and deadband, states *active-unack -> active-ack -> normal* and *returned-unack*, **shelving** (timed + reason), **suppression** (by design, Engineer/Admin), **first-out** detection for trips, **flood detection** (> 10 alarms in 10 minutes), KPIs (alarms/hour, top 5, average acknowledge time, stale alarms), optional sound, blinking unacknowledged banner. `ALM_ANY / ALM_UNACK / ALM_CRIT_UNACK` are written back to the PLC (horn and beacon).

### 3.7 Production and quality
Recipe manager (create/edit/copy/delete; defaults Cola, Orange, Energy Drink), production order, batch records with genealogy (batch -> cartons -> pallets, barcode lookup), reject reasons (underfill, no cap, label missing, high temperature), SPC chart for fill volume with control and specification limits, downtime tracking with reason codes and Pareto, cycle-time / line-balance analysis, OEE (availability x performance x quality), shift reports.

### 3.8 Maintenance, energy, data
Equipment health with predictive warnings (vibration, current, starts, overdue tasks), maintenance schedule with *Mark as done*, kWh per machine, **cost per batch with editable PKR tariff**, peak demand (15-min), power factor, syrup/water consumption. **Historian** keeps samples in memory and **IndexedDB** (1 min / 1 h / shift views with wheel zoom and drag pan). **Audit trail** logs login, ladder edits, tag changes, forces, setpoint changes, alarm acknowledgements, commands (CSV export). Reports: shift, alarm, production, OEE - print to PDF (browser print) or export CSV/JSON. A design-report PDF summary is generated in the browser (*Learn > Project Documentation*).

### 3.9 Training
Seven one-click **fault scenarios** with the expected PLC response and a live checklist, a fault-injection switchboard, a guided **tutorial** with a score, a first-launch **tour**, and the keyboard shortcuts below.

| Key | Action |
|---|---|
| `Space` | Start / Stop the plant |
| `E` | Emergency stop (press again to release) |
| `A` | Acknowledge all alarms |
| `P` / `N` | Pause / resume, execute one scan |
| `L` | Lock screen |
| `?` | Help |
| `Del`, `Ctrl+Z`, `Ctrl+Y` | Ladder editor: delete, undo, redo |

---

## 4. How to edit the ladder logic

1. Sign in as **Engineer** (or Admin) and open *Engineering > I/O & PLC Logic > Ladder* (or `ladder/index.html`).
2. Pick a **section** tab. Each rung shows live power flow (green) and live values; timers show `PT/ET/Q`, counters `PV/CV`.
3. **Add a rung**: *+ Add rung* (or the plus icon in a rung header to insert below). Type a rung comment, click the star to bookmark.
4. **Insert an element**: drag an item from the palette onto a **+** drop zone, *or* click a palette item (it is armed) and then click a **+** zone. Contacts go on the left (condition), coils/timers/counters/math/PID on the right (**+ output**).
5. **Edit an element**: click it. The right panel changes the tag (with autocomplete; undefined tags can be created in one click), timer/counter preset, comparator operator and operands, math operation, PID tags, or *Replace with* another type. **Del** removes the selected element.
6. **Parallel branch (OR)**: select a contact and click *Parallel branch*. Select an element inside a branch and click it again to add one more branch.
7. **Undo / Redo** (100 levels), **Save JSON / Load JSON**, **Reset to default program**.
8. **Compile / Apply** checks the draft (undefined tags, duplicate coils/instances, type mismatches, writes to input tags). Errors are listed (click to jump to the rung) and nothing is changed. If clean, the draft is **downloaded into the running PLC without stopping it** (timer/counter state is kept) and saved in your browser.
9. **Run / Stop / Pause / Single scan** and the simulation speed are in the toolbar. **Force I/O**: select an element, then *Force ON/OFF* in the properties panel, or use *Watch & Force*.
10. Other tabs: **FBD**, **SFC**, **Structured Text** (all auto-generated from the same logic), **Tags** (editable table, search/filter, CSV), **Watch & Force**, **Cross-ref / Replace** (every rung and HMI screen using a tag, search/replace across the program), **Versions** (named snapshots, compare, restore), **Listing** (printable program listing).

> Tip: the state machine uses MOV rungs ordered **highest step first** so only one step happens per scan. Keep that order when you add steps.

---

## 5. Deploy on GitHub Pages (step by step)

1. Sign in to <https://github.com> and click **New repository**. Name it, for example, `beverage-plant-plc-hmi`. Choose **Public**. Click **Create repository**.
2. Unzip this project on your computer. You should see `index.html`, `simulator/`, `ladder/`, `js/`, `css/`, `assets/`, `data/`, `README.md` and `.nojekyll` at the top level.
3. In the new repository click **uploading an existing file** (or *Add file > Upload files*). **Drag the CONTENTS of the unzipped folder** (not the folder itself) into the page so that `index.html` ends up in the repository root. Make sure the hidden file `.nojekyll` is included (if your file manager hides it, upload it separately or create it with *Add file > Create new file* named `.nojekyll`).
4. Click **Commit changes**.
5. Open **Settings > Pages**. Under *Build and deployment* set **Source: Deploy from a branch**, **Branch: `main`**, folder **`/ (root)`**, then **Save**.
6. Wait 1-2 minutes and refresh. GitHub shows the site address: `https://<your-user>.github.io/<repo-name>/`. Open it - the portfolio page appears; **Launch Simulator** opens the app.
7. Before sharing: edit the contact links in `index.html` (search for `your.email@example.com`, `your-profile`, `your-username`) and replace the screenshots in `assets/screenshots/` (see 6).

If a page shows a blank screen, press `Ctrl+F5` once (service worker cache) and check that `.nojekyll` and the `js/` folder were uploaded.

### Git command line alternative
```bash
cd beverage-plant-plc-hmi
git init && git add . && git commit -m "PLC + HMI/SCADA simulator"
git branch -M main
git remote add origin https://github.com/<your-user>/<repo>.git
git push -u origin main
```

---

## 6. Customising

* **Screenshots / GIF:** replace `assets/screenshots/overview.png`, `ladder.png`, `alarms.png` (they are real screenshots of the simulator). For a GIF, add `assets/screenshots/demo.gif` and replace the placeholder box in the *Screenshots* section of `index.html` with `<img src="assets/screenshots/demo.gif" alt="Demo">`.
* **Feature flags:** `js/config.js` -> `PLANT.FEATURES` (`pwa`, `tour`, `tutorial`, `scenarios`, `urdu`, `sound`, `historian`, `modbus`, `fbdSfc`, `versionHistory`, `energy`, `maintenance`, `autoLogout`, `screenLock`). Set to `false` to disable a module.
* **Constants:** scan time, speeds, idle timers, default tariff (PKR/kWh), ideal cans/min for OEE are in `PLANT.SIM`.
* **Regenerate the default program:** edit `tools/build-data.js`, then run `node tools/build-data.js` (optional - only needed if you change the default program/tags; the shipped files are already generated).
* **Reset everything** in your browser: clear site data for the page (localStorage and IndexedDB), or use *Reset to default program* in the ladder editor.
* **Conveyor geometry:** cans are spawned on an exact 0.3 m pitch and every station sits on a multiple of that pitch, so all stations are always in phase. The PLC scan time is limited to 10-200 ms so presence sensors are never missed.

---

## 7. Testing

Open **`tests.html`** (or run `node tests/run-node.js js/config.js js/tags.js js/plc-engine.js js/process-model.js js/sim.js js/alarms.js js/production.js data/default-data.js js/selftest.js js/selftest-plant.js`).

* Engine: contacts/coils, series/parallel, edges, set/reset, seal-in, TON/TOF/TP, CTU/CTD, comparators, math, PID (clamp, closed loop, bumpless, anti-windup), interlocks, trip latch, state machine, forces, STOP mode, compiler, Structured Text, tag CSV.
* Plant (default ladder + process model): start sequence 10..80 in order, dosing weights, PID reaching setpoint, order stop at target, cartons/pallets/barcode counters, E-stop, gas leak, over-temperature, sensor failure, power loss, empty tank, pump overload, jam, manual mode, alarm state machine, shelving and first-out, production layer (batches, genealogy, OEE, downtime).

---

## 8. Tag list (default project)

### Digital inputs (%IX) (19)

| Tag | Type | Address | Description |
|---|---|---|---|
| `I_ESTOP_OK` | BOOL | `%IX0.0` | Emergency stop circuit healthy (NC chain, 1 = OK) |
| `I_MCC_OK` | BOOL | `%IX0.1` | Motor control centre supply healthy (1 = OK) |
| `I_GAS_ALARM` | BOOL | `%IX0.2` | Gas detector GD-701 high-high contact |
| `I_OL_P101` | BOOL | `%IX0.3` | P-101 syrup pump overload relay tripped |
| `I_OL_P102` | BOOL | `%IX0.4` | P-102 water pump overload relay tripped |
| `I_OL_CONV` | BOOL | `%IX0.5` | M-401 conveyor motor overload tripped |
| `I_JAM` | BOOL | `%IX0.6` | Conveyor jam switch JS-401 |
| `I_CAP_LOW` | BOOL | `%IX0.7` | Cap magazine low level LS-302 |
| `I_LBL_LOW` | BOOL | `%IX1.0` | Label reel low LS-501 |
| `DI_PE301` | BOOL | `%IX1.1` | PE-301 can present at filler |
| `DI_PE302` | BOOL | `%IX1.2` | PE-302 can present at capper |
| `DI_PE401` | BOOL | `%IX1.3` | PE-401 can present at inspection station |
| `DI_INSP_FAIL` | BOOL | `%IX1.4` | Inspection camera result = FAIL (underfill / no cap / high temp) |
| `DI_PE501` | BOOL | `%IX1.5` | PE-501 can present at labeler |
| `DI_PE502` | BOOL | `%IX1.6` | PE-502 can present at label verification |
| `DI_LBL_FAIL` | BOOL | `%IX1.7` | Label verification result = FAIL (label missing) |
| `DI_PE601` | BOOL | `%IX2.0` | PE-601 can delivered to carton packer |
| `DI_BARCODE` | BOOL | `%IX2.1` | BCR-601 carton barcode scanned (pulse) |
| `DI_PE701` | BOOL | `%IX2.2` | PE-701 carton arrived at palletizer |

### Analog inputs (%IW) (12)

| Tag | Type | Address | Description |
|---|---|---|---|
| `AI_LT101` | REAL | `%IW0` | LT-101 syrup tank level [%] |
| `AI_LT102` | REAL | `%IW1` | LT-102 water tank level [%] |
| `AI_WT103` | REAL | `%IW2` | WT-103 mixing tank weight (load cell) [kg] |
| `AI_LT201` | REAL | `%IW3` | LT-201 pasteurizer tank level [%] |
| `AI_TT201` | REAL | `%IW4` | TT-201 pasteurizer temperature [degC] |
| `AI_PT201` | REAL | `%IW5` | PT-201 pasteurizer pressure [bar] |
| `AI_LT301` | REAL | `%IW6` | LT-301 filler bowl level [%] |
| `AI_TT301` | REAL | `%IW7` | TT-301 filler bowl product temperature [degC] |
| `AI_GAS_PPM` | REAL | `%IW8` | AT-701 gas concentration [ppm] |
| `AI_CONV_SPD` | REAL | `%IW9` | SI-401 conveyor speed feedback [%] |
| `AI_CONV_AMP` | REAL | `%IW10` | II-401 conveyor motor current [A] |
| `AI_KW` | REAL | `%IW11` | JI-001 total plant power [kW] |

### Digital outputs (%QX) (25)

| Tag | Type | Address | Description |
|---|---|---|---|
| `Q_P101` | BOOL | `%QX0.0` | Syrup pump P-101 |
| `Q_P102` | BOOL | `%QX0.1` | Water pump P-102 |
| `Q_P103` | BOOL | `%QX0.2` | Transfer pump P-103 (mixer to pasteurizer) |
| `Q_P104` | BOOL | `%QX0.3` | Filler feed pump P-104 |
| `Q_XV101` | BOOL | `%QX0.4` | Syrup tank inlet valve XV-101 |
| `Q_XV102` | BOOL | `%QX0.5` | Water tank inlet valve XV-102 |
| `Q_XV103` | BOOL | `%QX0.6` | Syrup dosing valve XV-103 |
| `Q_XV104` | BOOL | `%QX0.7` | Water dosing valve XV-104 |
| `Q_XV105` | BOOL | `%QX1.0` | Mixer discharge valve XV-105 |
| `Q_AGIT` | BOOL | `%QX1.1` | Mixer agitator M-103 |
| `Q_HEATER` | BOOL | `%QX1.2` | Heater / steam contactor K-201 |
| `Q_FILL` | BOOL | `%QX1.3` | Filling valve FV-301 |
| `Q_CAP` | BOOL | `%QX1.4` | Capper press CP-302 |
| `Q_CONV` | BOOL | `%QX1.5` | Conveyor motor M-401 run |
| `Q_FEEDER` | BOOL | `%QX1.6` | Empty-can infeed gate |
| `Q_REJ1` | BOOL | `%QX1.7` | Reject pusher RP-401 (inspection) |
| `Q_REJ2` | BOOL | `%QX2.0` | Reject pusher RP-502 (label check) |
| `Q_LABEL` | BOOL | `%QX2.1` | Labeler LB-501 |
| `Q_CARTON` | BOOL | `%QX2.2` | Carton packer CK-601 |
| `Q_PALLETIZER` | BOOL | `%QX2.3` | Palletizer robot PZ-701 |
| `Q_WRAP` | BOOL | `%QX2.4` | Pallet wrapper WR-702 |
| `Q_HORN` | BOOL | `%QX2.5` | Alarm horn |
| `Q_LAMP_G` | BOOL | `%QX2.6` | Beacon green (running) |
| `Q_LAMP_R` | BOOL | `%QX2.7` | Beacon red (tripped) |
| `Q_LAMP_A` | BOOL | `%QX3.0` | Beacon amber (alarm) |

### Analog outputs (%QW) (2)

| Tag | Type | Address | Description |
|---|---|---|---|
| `AO_HEATER` | REAL | `%QW0` | Heater power command (PID output) [%] |
| `AO_CONV_SPD` | REAL | `%QW1` | Conveyor VFD speed reference [%] |

### Memory bits (%MX) - commands and internal (47)

| Tag | Type | Address | Description |
|---|---|---|---|
| `M_START` | BOOL | `%MX0.0` | HMI Start pushbutton (momentary) |
| `M_STOP` | BOOL | `%MX0.1` | HMI Stop pushbutton (momentary) |
| `M_RESET` | BOOL | `%MX0.2` | HMI Reset / trip reset (momentary) |
| `M_ABORT` | BOOL | `%MX0.3` | HMI Abort batch (momentary) |
| `M_NEW_ORDER` | BOOL | `%MX0.4` | HMI New production order - resets order counters (momentary) |
| `M_AUTO` | BOOL | `%MX0.5` | Auto(1)/Manual(0) mode selector |
| `PID_AUTO` | BOOL | `%MX0.6` | Temperature loop Auto(1)/Manual(0) |
| `CMD_P101` | BOOL | `%MX0.7` | Manual command for P101 |
| `CMD_P102` | BOOL | `%MX1.0` | Manual command for P102 |
| `CMD_P103` | BOOL | `%MX1.1` | Manual command for P103 |
| `CMD_P104` | BOOL | `%MX1.2` | Manual command for P104 |
| `CMD_XV101` | BOOL | `%MX1.3` | Manual command for XV101 |
| `CMD_XV102` | BOOL | `%MX1.4` | Manual command for XV102 |
| `CMD_XV103` | BOOL | `%MX1.5` | Manual command for XV103 |
| `CMD_XV104` | BOOL | `%MX1.6` | Manual command for XV104 |
| `CMD_XV105` | BOOL | `%MX1.7` | Manual command for XV105 |
| `CMD_AGIT` | BOOL | `%MX2.0` | Manual command for AGIT |
| `CMD_HEATER` | BOOL | `%MX2.1` | Manual command for HEATER |
| `CMD_CONV` | BOOL | `%MX2.2` | Manual command for CONV |
| `PLANT_RUN` | BOOL | `%MX2.3` | Plant running (latched by Start) |
| `AUTO_OK` | BOOL | `%MX2.4` | Auto run permissive |
| `SAFE_OK` | BOOL | `%MX2.5` | Safety permissive (no trip, E-stop OK, power OK) |
| `TRIP` | BOOL | `%MX2.6` | Safety trip latch |
| `CAUSE_ACTIVE` | BOOL | `%MX2.7` | A trip cause is present |
| `SENSOR_FAIL` | BOOL | `%MX3.0` | Analog sensor out of range |
| `LINE_FAULT` | BOOL | `%MX3.1` | Conveyor overload or jam |
| `ORDER_DONE` | BOOL | `%MX3.2` | Production order target reached |
| `PROD_EN` | BOOL | `%MX3.3` | Production (filling line) enabled - SEQ step 80 |
| `LV1_REFILL` | BOOL | `%MX3.4` | Syrup tank refill active |
| `LV2_REFILL` | BOOL | `%MX3.5` | Water tank refill active |
| `LSLL_101` | BOOL | `%MX3.6` | Syrup tank empty (<5 %) |
| `LSLL_102` | BOOL | `%MX3.7` | Water tank empty (<5 %) |
| `LSLL_301` | BOOL | `%MX4.0` | Filler bowl empty (<3 %) |
| `DOSE_FAULT` | BOOL | `%MX4.1` | Dosing timeout |
| `FEED_REQ` | BOOL | `%MX4.2` | Filler bowl requests product |
| `FILL_REQ` | BOOL | `%MX4.3` | Filler station active |
| `CAP_REQ` | BOOL | `%MX4.4` | Capper station active |
| `LBL_REQ` | BOOL | `%MX4.5` | Labeler station active |
| `FILL_DONE` | BOOL | `%MX4.6` | Can at filler already filled |
| `CAP_DONE` | BOOL | `%MX4.7` | Can at capper already capped |
| `LBL_DONE` | BOOL | `%MX5.0` | Can at labeler already labelled |
| `CONV_HOLD` | BOOL | `%MX5.1` | Conveyor held while a station works |
| `CTN_RST` | BOOL | `%MX5.2` | Reset can-per-carton counter |
| `PLT_RST` | BOOL | `%MX5.3` | Reset carton-per-pallet counter |
| `ALM_ANY` | BOOL | `%MX5.4` | Any alarm active (from alarm server) |
| `ALM_UNACK` | BOOL | `%MX5.5` | Unacknowledged alarm present (from alarm server) |
| `ALM_CRIT_UNACK` | BOOL | `%MX5.6` | Unacknowledged critical alarm (from alarm server) |

### Integers (%MW) (9)

| Tag | Type | Address | Description |
|---|---|---|---|
| `SEQ_STEP` | INT | `%MW0` | Main sequence step (0 idle ... 90 batch complete) |
| `ORDER_TARGET` | INT | `%MW1` | Production order target (cans) [cans] |
| `REC_ID` | INT | `%MW2` | Selected recipe number |
| `REC_CANS_CTN` | INT | `%MW3` | Recipe: cans per carton |
| `REC_CTN_PLT` | INT | `%MW4` | Recipe: cartons per pallet |
| `REC_FILL_ML` | INT | `%MW5` | Recipe: fill volume [ml] |
| `REC_HOLD_S` | INT | `%MW6` | Recipe: pasteurization hold time [s] |
| `FILL_TIME_MS` | INT | `%MW7` | Calculated fill time [ms] |
| `HOLD_MS` | INT | `%MW8` | Calculated hold time [ms] |

### Reals (%MD) (19)

| Tag | Type | Address | Description |
|---|---|---|---|
| `REC_BATCH_KG` | REAL | `%MD0` | Recipe: batch size [kg] |
| `REC_SYRUP_PCT` | REAL | `%MD1` | Recipe: syrup ratio (kg per 100 kg) [%] |
| `REC_TEMP_SP` | REAL | `%MD2` | Recipe: pasteurization temperature [degC] |
| `SYRUP_TARGET_KG` | REAL | `%MD3` | Syrup dosing target weight [kg] |
| `TMP_SYR` | REAL | `%MD4` | Scratch value for syrup calculation |
| `TT_SP` | REAL | `%MD5` | Temperature loop setpoint [degC] |
| `TT_HOLD_MIN` | REAL | `%MD6` | Minimum temperature for a valid hold [degC] |
| `TT_HH` | REAL | `%MD7` | Over-temperature trip limit [degC] |
| `PT_HH` | REAL | `%MD8` | Over-pressure trip limit [bar] |
| `KP_TEMP` | REAL | `%MD9` | Temperature PID Kp [%/degC] |
| `KI_TEMP` | REAL | `%MD10` | Temperature PID Ki [%/(degC.s)] |
| `KD_TEMP` | REAL | `%MD11` | Temperature PID Kd [%.s/degC] |
| `PID_MAN_OUT` | REAL | `%MD12` | Temperature loop manual output [%] |
| `CONV_SPEED_SP` | REAL | `%MD13` | Conveyor speed setpoint [%] |
| `LT_LOW_SP` | REAL | `%MD14` | Tank refill start level [%] |
| `LT_HIGH_SP` | REAL | `%MD15` | Tank refill stop level [%] |
| `FILL_MS_PER_ML` | REAL | `%MD16` | Fill time per ml (valve flow 250 ml/s) [ms/ml] |
| `TEMP_REJ_HI` | REAL | `%MD17` | Inspection: reject cans filled hotter than [degC] |
| `REJ_RATE` | REAL | `%MD18` | Reject rate over last 20 cans (HMI calculated) [%] |


Timer and counter instances create extra tags automatically: `NAME.Q`, `NAME.ACC`, `NAME.PRE` (timers) and `NAME.Q`, `NAME.CV` (counters).

---

## 9. Known limitations

* A simulator: physics are simplified and the demo logins are not security. Everything stays in your browser (`localStorage`, `IndexedDB`).
* Modbus TCP is **simulated** in the page (register map and frame builder), there is no network port in a static site.
* Service workers only run on `http(s)` (GitHub Pages / localhost), not on `file://`.
* Browsers throttle timers in background tabs; the simulation slows down while the tab is hidden.

## 10. License

Portfolio / educational use. Author: Zaheer Abbas.
