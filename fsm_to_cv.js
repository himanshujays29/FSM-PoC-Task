// ── Examples ───────────────────────────────────────────────────────────────
const EXAMPLES = {
  traffic: {
    id: "Traffic_Light", type: "Moore", initial_state: "RED", clocked: true,
    states: [
      { name: "RED",    output: { red: 1, yellow: 0, green: 0 } },
      { name: "GREEN",  output: { red: 0, yellow: 0, green: 1 } },
      { name: "YELLOW", output: { red: 0, yellow: 1, green: 0 } }
    ],
    transitions: [
      { from: "RED",    to: "GREEN",  condition: "T"  },
      { from: "RED",    to: "RED",    condition: "T'" },
      { from: "GREEN",  to: "YELLOW", condition: "T"  },
      { from: "GREEN",  to: "GREEN",  condition: "T'" },
      { from: "YELLOW", to: "RED",    condition: "T"  },
      { from: "YELLOW", to: "YELLOW", condition: "T'" }
    ],
    inputs: [{ name: "T", bits: 1 }],
    outputs: ["red", "yellow", "green"]
  },
  sequence: {
    id: "Seq_Detector_01", type: "Moore", initial_state: "S0", clocked: true,
    states: [
      { name: "S0", output: { Z: 0 } },
      { name: "S1", output: { Z: 0 } },
      { name: "S2", output: { Z: 1 } }
    ],
    transitions: [
      { from: "S0", to: "S1", condition: "0" },
      { from: "S0", to: "S0", condition: "1" },
      { from: "S1", to: "S2", condition: "1" },
      { from: "S1", to: "S1", condition: "0" },
      { from: "S2", to: "S1", condition: "0" },
      { from: "S2", to: "S0", condition: "1" }
    ],
    inputs: [{ name: "X", bits: 1 }],
    outputs: ["Z"]
  }
};

// ── App state ────────────────────────────────────────────────────────────────
const state = { activeTab: "summary", lastCV: null, lastResult: null };

// ── DOM refs ─────────────────────────────────────────────────────────────────
const el = {
  input:       document.getElementById("fsm-input"),
  output:      document.getElementById("output-content"),
  statusDot:   document.getElementById("status-dot"),
  statusMsg:   document.getElementById("status-msg"),
  synthBtn:    document.getElementById("synthesize-btn"),
  downloadBtn: document.getElementById("download-btn"),
  tabs:        [...document.querySelectorAll(".tab")],
  exBtns:      [...document.querySelectorAll("[data-example]")]
};

// ── Init ─────────────────────────────────────────────────────────────────────
bindEvents();
renderPlaceholder();
loadExample("traffic");

// ── Events ───────────────────────────────────────────────────────────────────
function bindEvents() {
  el.exBtns.forEach(btn => btn.addEventListener("click", () => loadExample(btn.dataset.example)));
  el.tabs.forEach(tab => tab.addEventListener("click", () => activateTab(tab.dataset.tab)));
  el.synthBtn.addEventListener("click", runSynthesis);
  el.downloadBtn.addEventListener("click", downloadCV);
  el.input.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runSynthesis(); }
  });
}

function loadExample(key) {
  el.input.value = JSON.stringify(EXAMPLES[key], null, 2);
  setStatus("idle", `Loaded ${key === "traffic" ? "Traffic Light" : "Sequence Detector"}`);
}

function activateTab(name) {
  state.activeTab = name;
  el.tabs.forEach(t => t.classList.toggle("is-active", t.dataset.tab === name));
  if (state.lastResult) renderActiveTab();
}

function setStatus(s, msg) {
  el.statusDot.dataset.state = s;
  el.statusMsg.textContent = msg;
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderPlaceholder() {
  el.output.innerHTML = `<div class="empty-state"><h3>Ready</h3><p>Paste FSM JSON and click Synthesize.</p></div>`;
}

function renderLoading() {
  el.output.innerHTML = `<div class="loading-state"><div class="spinner"></div><h3>Building circuit…</h3></div>`;
}

function renderError(msg) {
  el.output.innerHTML = `<div class="error-box">${esc(msg)}</div>`;
}

function renderActiveTab() {
  if (!state.lastResult) return renderPlaceholder();
  const r = state.lastResult;
  if (state.activeTab === "summary")  el.output.innerHTML = buildSummaryHTML(r);
  else if (state.activeTab === "table") el.output.innerHTML = buildTableHTML(r);
  else el.output.innerHTML = `<pre class="json-block">${esc(JSON.stringify(r.cv, null, 2))}</pre>`;
}

// ── Synthesis flow ───────────────────────────────────────────────────────────
function runSynthesis() {
  if (!el.input.value.trim()) {
    setStatus("err", "Paste FSM JSON first"); return renderPlaceholder();
  }
  setStatus("working", "Synthesizing…");
  renderLoading();

  setTimeout(() => {
    try {
      const result = synthesize(el.input.value.trim());
      state.lastResult = result;
      state.lastCV = JSON.stringify(result.cv, null, 2);
      el.downloadBtn.disabled = false;
      setStatus("ok", `${Object.keys(result.enc).length} states · ${Object.keys(result.equations).length} equations`);
      renderActiveTab();
    } catch (err) {
      state.lastResult = state.lastCV = null;
      el.downloadBtn.disabled = true;
      setStatus("err", err.message.split("\n")[0]);
      renderError(err.message);
    }
  }, 20);
}

function downloadCV() {
  if (!state.lastCV) return;
  const name = (state.lastResult.fsm.id || "FSM_Circuit").replace(/\s+/g, "_");
  const url = URL.createObjectURL(new Blob([state.lastCV], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: `${name}.cv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus("ok", `Downloaded ${name}.cv`);
}

// ── Utils ────────────────────────────────────────────────────────────────────
const esc = v => String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const uid = () => Math.random().toString(36).slice(2,22).padEnd(20,"x");
const scopeId = () => Math.floor(Math.random() * 9e10) + 1e10;

// ═══════════════════════════════════════════════════════════════════════════════
// SYNTHESIS ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

function validateFSM(fsm) {
  const errors = [];
  const names = new Set((fsm.states || []).map(s => s.name));
  if (names.size < 2) errors.push("Need at least 2 states.");
  if (!names.has(fsm.initial_state)) errors.push(`initial_state "${fsm.initial_state}" not in states.`);

  const seen = new Map();
  for (const t of fsm.transitions || []) {
    if (!names.has(t.from)) errors.push(`Transition from unknown state "${t.from}".`);
    if (!names.has(t.to))   errors.push(`Transition to unknown state "${t.to}".`);
    const key = `${t.from}||${t.condition || "*"}`;
    if (seen.has(key)) errors.push(`Duplicate transition from "${t.from}" on "${t.condition}".`);
    seen.set(key, true);
  }
  if (errors.length) throw new Error(errors.join("\n"));
}

function encodeStates(fsm) {
  const names = fsm.states.map(s => s.name);
  const nBits = names.length > 1 ? Math.max(1, Math.ceil(Math.log2(names.length))) : 1;
  const enc = {};
  names.forEach((name, i) => { enc[name] = i.toString(2).padStart(nBits, "0"); });
  return { enc, nBits };
}

function buildTransitionTable(fsm, enc, nBits) {
  const inputNames  = (fsm.inputs  || []).map(i => i.name);
  const outputNames = fsm.outputs  || [];
  const nIn   = inputNames.length;
  const nOut  = outputNames.length;
  const nTotal = 1 << nBits;

  const transMap = new Map();
  for (const t of fsm.transitions)
    transMap.set(`${t.from}||${t.condition || "*"}`, t.to);

  const outMap = {};
  for (const s of fsm.states)
    outMap[s.name] = outputNames.map(o => s.output[o] ?? 0).join("");

  const revEnc = {};
  for (const [name, bits] of Object.entries(enc)) revEnc[bits] = name;

  const rows = [];
  for (let cs = 0; cs < nTotal; cs++) {
    const curBits = cs.toString(2).padStart(nBits, "0");
    const isValid = curBits in revEnc;
    const inputCombos = nIn > 0 ? 1 << nIn : 1;

    for (let iv = 0; iv < inputCombos; iv++) {
      const inBits = nIn > 0 ? iv.toString(2).padStart(nIn, "0") : "";

      if (!isValid) {
        rows.push({ current: curBits, input: inBits, next: "x".repeat(nBits), output: "x".repeat(nOut), dontCare: true });
        continue;
      }

      const stateName = revEnc[curBits];
      let nextState = null;

      for (const cond of [inBits, "*"]) {
        if (transMap.has(`${stateName}||${cond}`)) { nextState = transMap.get(`${stateName}||${cond}`); break; }
      }

      if (nextState === null && nIn === 1) {
        const iName = inputNames[0];
        if (iv === 1 && transMap.has(`${stateName}||${iName}`))       nextState = transMap.get(`${stateName}||${iName}`);
        else if (iv === 0 && transMap.has(`${stateName}||${iName}'`)) nextState = transMap.get(`${stateName}||${iName}'`);
        if (nextState === null && transMap.has(`${stateName}||${iv}`)) nextState = transMap.get(`${stateName}||${iv}`);
      }

      rows.push(nextState === null
        ? { current: curBits, input: inBits, next: "x".repeat(nBits), output: outMap[stateName], dontCare: true }
        : { current: curBits, input: inBits, next: enc[nextState], output: outMap[stateName], dontCare: false }
      );
    }
  }
  return { rows, inputNames, outputNames };
}

// ── Quine-McCluskey minimization ─────────────────────────────────────────────
function countOnes(bits) { return [...bits].filter(b => b === "1").length; }

function canCombine(a, b) {
  let diff = 0, idx = -1;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { diff++; idx = i; }
  return diff === 1 ? idx : -1;
}

function combine(a, i) { return a.slice(0, i) + "-" + a.slice(i + 1); }

function coveredMinterms(impl) {
  function expand(bits) {
    const d = bits.indexOf("-");
    if (d === -1) return [parseInt(bits, 2)];
    return [...expand(bits.slice(0,d) + "0" + bits.slice(d+1)), ...expand(bits.slice(0,d) + "1" + bits.slice(d+1))];
  }
  return expand(impl);
}

function quineMcCluskey(minterms, dontCares, nVars) {
  if (!minterms.length) return [];
  const all = [...new Set([...minterms, ...dontCares])];
  let current = new Map(all.map(m => [m.toString(2).padStart(nVars, "0"), new Set([m])]));
  const primes = new Set();

  while (current.size) {
    const groups = new Map();
    for (const [term, cov] of current) {
      const ones = countOnes(term);
      if (!groups.has(ones)) groups.set(ones, new Map());
      groups.get(ones).set(term, cov);
    }
    const used = new Set(), next = new Map();
    const keys = [...groups.keys()].sort((a, b) => a - b);

    for (let i = 0; i < keys.length - 1; i++) {
      for (const [tA, cA] of groups.get(keys[i])) {
        for (const [tB, cB] of groups.get(keys[i + 1])) {
          const di = canCombine(tA, tB);
          if (di >= 0) {
            const merged = combine(tA, di);
            if (!next.has(merged)) next.set(merged, new Set());
            for (const v of cA) next.get(merged).add(v);
            for (const v of cB) next.get(merged).add(v);
            used.add(tA); used.add(tB);
          }
        }
      }
    }
    for (const term of current.keys()) if (!used.has(term)) primes.add(term);
    current = next;
  }

  const dcSet = new Set(dontCares);
  return [...primes].filter(pi => coveredMinterms(pi).some(m => !dcSet.has(m)));
}

function essentialPIs(minterms, primes) {
  if (!minterms.length) return [];
  const remaining = new Set(minterms);
  const chosen = [];
  const coverage = new Map(primes.map(pi => [pi, new Set(coveredMinterms(pi).filter(m => remaining.has(m)))]));
  const m2pi = new Map([...remaining].map(m => [m, []]));

  for (const [pi, cov] of coverage)
    for (const m of cov) if (m2pi.has(m)) m2pi.get(m).push(pi);

  for (const [m, pis] of m2pi) {
    if (pis.length === 1 && !chosen.includes(pis[0])) {
      chosen.push(pis[0]);
      for (const v of coverage.get(pis[0])) remaining.delete(v);
    }
  }

  while (remaining.size) {
    let best = null, bestN = -1;
    for (const [pi, cov] of coverage) {
      const n = [...cov].filter(m => remaining.has(m)).length;
      if (n > bestN) { best = pi; bestN = n; }
    }
    if (!best || bestN === 0) break;
    chosen.push(best);
    for (const v of coverage.get(best)) remaining.delete(v);
  }
  return chosen;
}

function implicantToSOP(impl, vars) {
  const lits = [];
  for (let i = 0; i < impl.length; i++) {
    if (impl[i] === "1") lits.push(vars[i]);
    else if (impl[i] === "0") lits.push(`${vars[i]}'`);
  }
  return lits.length ? lits.join(" * ") : "1";
}

function minimizeFunction(minterms, dontCares, vars) {
  const pis = quineMcCluskey(minterms, dontCares, vars.length);
  return essentialPIs(minterms, pis).map(pi => implicantToSOP(pi, vars));
}

function deriveEquations(rows, nBits, inputNames, outputNames) {
  const stateVars = Array.from({ length: nBits }, (_, i) => `Q${nBits - 1 - i}`);
  const allVars   = [...stateVars, ...inputNames];
  const equations = {};

  for (let bi = 0; bi < nBits; bi++) {
    const sig = `Q${nBits - 1 - bi}+`;
    const minterms = [], dontCares = [];
    for (const row of rows) {
      const idx = parseInt(row.current + row.input, 2);
      if (row.dontCare || row.next === "x".repeat(nBits)) dontCares.push(idx);
      else if (row.next[bi] === "1") minterms.push(idx);
    }
    equations[sig] = minimizeFunction([...new Set(minterms)], [...new Set(dontCares)], allVars);
  }

  for (let oi = 0; oi < outputNames.length; oi++) {
    const oName = outputNames[oi];
    const minterms = [], dontCares = [];
    const seen = new Set();
    for (const row of rows) {
      const cs = parseInt(row.current, 2);
      if (seen.has(cs)) continue;
      seen.add(cs);
      if (row.dontCare || row.output === "x".repeat(outputNames.length))
        { if (!dontCares.includes(cs)) dontCares.push(cs); }
      else if (row.output[oi] === "1" && !minterms.includes(cs))
        minterms.push(cs);
    }
    equations[oName] = minimizeFunction(minterms, dontCares, stateVars);
  }

  return { equations, stateVars };
}

// ── CircuitVerse JSON builder ─────────────────────────────────────────────────
const GRID = 80, SX = 200, SY = 150;

function buildCV(fsm, equations, stateVars, inputNames) {
  const nodes = [];
  const components = {};

  function addNode(x, y, type, bw = 1, label = "") {
    nodes.push({ x, y, type, bitWidth: bw, label, connections: [] });
    return nodes.length - 1;
  }

  function wire(a, b) {
    if (!nodes[a].connections.includes(b)) nodes[a].connections.push(b);
    if (!nodes[b].connections.includes(a)) nodes[b].connections.push(a);
  }

  function addComp(type, x, y, label, dir, custom) {
    const c = { x, y, objectType: type, label, direction: dir, labelDirection: "UP",
                 propagationDelay: ["Input","Output","Clock"].includes(type) ? 0 : 10,
                 customData: custom };
    if (!components[type]) components[type] = [];
    components[type].push(c);
    return c;
  }

  function addClock(x, y) {
    const out = addNode(10, 0, 1);
    addComp("Clock", x, y, "CLK", "RIGHT", { nodes: { output1: out }, constructorParamaters: ["RIGHT"] });
    return out;
  }

  function addDFF(x, y, label) {
    const d = addNode(-10,-20,0), clk = addNode(-10,0,0);
    const q = addNode(30,-10,1), qi  = addNode(30,10,1);
    const rst = addNode(0,20,0), pre = addNode(10,20,0), en = addNode(20,20,0);
    addComp("DflipFlop", x, y, label, "RIGHT", {
      constructorParamaters: ["RIGHT", 1],
      nodes: { clockInp: clk, d, qOutput: q, qInvOutput: qi, reset: rst, preset: pre, en }
    });
    return { D: d, CLK: clk, Q: q, Qinv: qi };
  }

  function addGate(type, x, y, srcs) {
    const n = srcs.length;
    const inps = srcs.map((_, i) => addNode(-10, (i - (n-1)/2) * 10, 0));
    const out  = addNode(20, 0, 1);
    inps.forEach((inp, i) => wire(inp, srcs[i]));
    addComp(type, x, y, "", "RIGHT", {
      constructorParamaters: ["RIGHT", n, 1], nodes: { inp: inps, output1: out }
    });
    return out;
  }

  function addNot(x, y, src) {
    const inp = addNode(-10, 0, 0), out = addNode(20, 0, 1);
    wire(inp, src);
    addComp("NotGate", x, y, "", "RIGHT", { constructorParamaters: ["RIGHT", 1], nodes: { output1: out, inp1: inp } });
    return out;
  }

  function addInput(x, y, label) {
    const out = addNode(10, 0, 1);
    addComp("Input", x, y, label, "RIGHT", {
      nodes: { output1: out }, values: { state: 0 },
      constructorParamaters: ["RIGHT", 1, { x, y, id: uid() }]
    });
    return out;
  }

  function addOutput(x, y, label, src) {
    const inp = addNode(10, 0, 0);
    wire(inp, src);
    addComp("Output", x, y, label, "LEFT", {
      nodes: { inp1: inp }, constructorParamaters: ["LEFT", 1, { x, y, id: uid() }]
    });
  }

  const sigMap = {}, dffPins = {};
  const clkNode = addClock(SX, SY);

  stateVars.forEach((sv, i) => {
    const pins = addDFF(SX + 7*GRID, SY + i*2*GRID, sv);
    dffPins[sv] = pins;
    sigMap[sv]  = pins.Q;
    sigMap[`${sv}'`] = null;
    wire(pins.CLK, clkNode);
  });

  let inY = SY + stateVars.length * 2*GRID + GRID;
  for (const name of inputNames) {
    sigMap[name] = addInput(SX + 2*GRID, inY, name);
    sigMap[`${name}'`] = null;
    inY += GRID;
  }

  let notY = SY;
  for (const [sig, src] of Object.entries(sigMap)) {
    if (sig.includes("'") || src === null) continue;
    sigMap[`${sig}'`] = addNot(SX + 4*GRID, notY, src);
    notY += GRID;
  }

  function parseTerm(term) {
    return term.trim() === "1" ? [] : term.split("*").map(p => p.trim()).filter(Boolean);
  }

  let gateY = SY;
  for (const [sig, sopTerms] of Object.entries(equations)) {
    if (!sopTerms.length) continue;
    const andOuts = [];

    for (const term of sopTerms) {
      const lits = parseTerm(term).map(l => sigMap[l]).filter(n => n != null);
      if (!lits.length) continue;
      andOuts.push(lits.length === 1 ? lits[0] : addGate("AndGate", SX + 6*GRID, gateY, lits));
      if (lits.length > 1) gateY += GRID;
    }

    if (!andOuts.length) continue;
    const finalNode = andOuts.length === 1
      ? andOuts[0]
      : (() => { const n = addGate("OrGate", SX + 10*GRID, gateY, andOuts); gateY += GRID; return n; })();

    if (sig.endsWith("+")) {
      const sv = sig.slice(0, -1);
      if (dffPins[sv]) wire(dffPins[sv].D, finalNode);
    } else {
      addOutput(SX + 13*GRID, gateY, sig, finalNode);
      gateY += GRID;
    }
  }

  const sid = scopeId();
  const scope = {
    layout: { width: 200, height: 300, title_x: 100, title_y: 13, titleEnabled: true },
    verilogMetadata: { isVerilogCircuit: false, isMainCircuit: true, code: "// Auto-generated", subCircuitScopeIds: [] },
    allNodes: nodes, id: sid, name: "FSM_Circuit",
    restrictedCircuitElementsUsed: [],
    nodes: nodes.map((n, i) => n.type === 2 ? i : -1).filter(i => i >= 0),
    ...components
  };

  return {
    name: fsm.id || "FSM_Circuit",
    timePeriod: 500, clockEnabled: true,
    projectId: uid(), focussedCircuit: sid,
    orderedTabs: [String(sid)], scopes: [scope]
  };
}

// ── Entry point ───────────────────────────────────────────────────────────────
function synthesize(fsmString) {
  const fsm = JSON.parse(fsmString);
  validateFSM(fsm);
  const { enc, nBits }                    = encodeStates(fsm);
  const { rows, inputNames, outputNames } = buildTransitionTable(fsm, enc, nBits);
  const { equations, stateVars }          = deriveEquations(rows, nBits, inputNames, outputNames);
  const cv                                = buildCV(fsm, equations, stateVars, inputNames);
  return { fsm, enc, nBits, rows, inputNames, outputNames, equations, stateVars, cv };
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function getComponentCounts(scope) {
  const skip = new Set(["layout","verilogMetadata","allNodes","id","name","restrictedCircuitElementsUsed","nodes"]);
  return Object.keys(scope).filter(k => !skip.has(k) && Array.isArray(scope[k])).map(k => ({ label: k, value: scope[k].length }));
}

function buildSummaryHTML(r) {
  const scope = r.cv.scopes[0];
  const metrics = [
    { label: "States",    value: Object.keys(r.enc).length },
    { label: "State bits",value: r.nBits },
    { label: "Inputs",    value: r.inputNames.length },
    { label: "Outputs",   value: r.outputNames.length },
    { label: "Equations", value: Object.keys(r.equations).length },
    { label: "Nodes",     value: scope.allNodes.length }
  ];

  const metricCards = metrics.map(m =>
    `<div class="metric-card"><span class="metric-value">${m.value}</span><span class="metric-label">${m.label}</span></div>`
  ).join("");

  const encPills = Object.entries(r.enc).map(([l, v]) =>
    `<div class="pill-card"><span class="pill-key">${esc(l)}</span><span class="pill-value mono">${esc(v)}</span></div>`
  ).join("");

  const equations = Object.entries(r.equations).map(([sig, terms]) =>
    `<div class="equation-row">
      <span class="equation-signal">${esc(sig)}</span>
      <span class="equation-equals">=</span>
      <span class="equation-expression mono">${esc(terms.length ? terms.join(" + ") : "0")}</span>
    </div>`
  ).join("");

  const compPills = getComponentCounts(scope).map(({ label, value }) =>
    `<div class="pill-card"><span class="pill-key">${esc(label)}</span><span class="pill-value">${value}</span></div>`
  ).join("");

  return `
    <section class="section">
      <h3 class="section-title">Overview</h3>
      <div class="metric-grid">${metricCards}</div>
    </section>
    <section class="section">
      <h3 class="section-title">State Encoding</h3>
      <div class="pill-grid">${encPills}</div>
    </section>
    <section class="section">
      <h3 class="section-title">Boolean Equations</h3>
      <div class="equation-list">${equations}</div>
    </section>
    <section class="section">
      <h3 class="section-title">Circuit Components</h3>
      <div class="pill-grid">${compPills}</div>
    </section>`;
}

function buildTableHTML(r) {
  const headers = [...r.stateVars, ...r.inputNames, ...r.stateVars.map(sv => `${sv}+`), ...r.outputNames, "d/c"];

  const bodyRows = r.rows.map(row => {
    const cells = [...row.current.split(""), ...(row.input ? row.input.split("") : []), ...row.next.split(""), ...row.output.split(""), row.dontCare ? "yes" : ""];
    return `<tr class="${row.dontCare ? "is-dont-care" : ""}">${cells.map(v => {
      const cls = v === "1" ? "bit-high" : v === "x" ? "bit-dont-care" : "";
      return `<td class="${cls}">${esc(v)}</td>`;
    }).join("")}</tr>`;
  }).join("");

  return `
    <section class="section">
      <h3 class="section-title">Transition Table</h3>
      <p class="summary-note">Current state → inputs → next state → Moore outputs.</p>
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${bodyRows}</tbody>
        </table>
      </div>
    </section>`;
}
