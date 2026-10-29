// app_electric.js - graph model and input handling for the Electric Board Map (electric_map.html)
//
// The input may be a FOREST (several trees, isolated vertices allowed), with gender input:
//   Adjacency list   : male vertices are marked with * wherever they appear, e.g.  *A:B,*C   B:*A   *C:*A   D:
//                      ("D:" is an isolated vertex). Unmarked vertices are female.
//   Adjacency matrix : rows are vertices A, B, C, ... in order; a * at the beginning of a row makes it male.
// The input must be acyclic (every connected part is a tree); otherwise it is rejected and nothing changes.
// After every change the board layout (electric_map.js) is recomputed.

const EB_MAX_VERTICES = 300;
const EB_MAX_ERRORS_SHOWN = 12;

let ebGraph = {};     // name -> array of neighbour names
let ebGender = {};    // name -> "M" | "F"
let ebOrder = [];     // vertex names in insertion order
let ebSelected = null;

const ebEl = id => document.getElementById(id);

// --- Labels: A..Z, A1..Z1, A2..Z2, ... ---
function ebVertexLabel(i) {
  return String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");
}

function ebLabelIndex(name) {
  const m = /^([A-Z])(\d*)$/.exec(String(name));
  if (!m) return -1;
  const suffix = m[2] === "" ? 0 : parseInt(m[2], 10);
  if (m[2] !== "" && suffix < 1) return -1;
  return suffix * 26 + (m[1].charCodeAt(0) - 65);
}

function ebCompareLabels(a, b) {
  const ia = ebLabelIndex(a), ib = ebLabelIndex(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return String(a).localeCompare(String(b));
}

function ebNextFreeLabel() {
  let i = 0;
  while (ebGraph[ebVertexLabel(i)]) i++;
  return ebVertexLabel(i);
}

function ebEdgeCount() {
  let d = 0;
  for (const u in ebGraph) d += ebGraph[u].length;
  return d / 2;
}

// Connected components (each one a tree in a valid forest), vertices in insertion order
function ebComponents() {
  const seen = new Set();
  const comps = [];
  ebOrder.forEach(start => {
    if (seen.has(start)) return;
    const comp = [start];
    seen.add(start);
    for (let i = 0; i < comp.length; i++) {
      ebGraph[comp[i]].forEach(v => {
        if (!seen.has(v)) { seen.add(v); comp.push(v); }
      });
    }
    comps.push(comp);
  });
  return comps;
}

function ebConnected(a, b) {
  if (a === b) return true;
  const seen = new Set([a]);
  const queue = [a];
  while (queue.length) {
    const u = queue.shift();
    for (const v of ebGraph[u]) {
      if (v === b) return true;
      if (!seen.has(v)) { seen.add(v); queue.push(v); }
    }
  }
  return false;
}

// --- Parsing with gender input ---
function ebParseName(raw) {
  const t = String(raw).trim();
  if (t === "") return { error: "empty vertex name (check for a stray or doubled comma)" };
  let male = false;
  let body = t;
  if (body.startsWith("*")) {
    male = true;
    body = body.slice(1).trim();
  }
  if (body === "") return { error: `"${t}" has a * but no vertex name` };
  if (body.includes("*")) return { error: `"${t}": * may appear only once, at the start of a vertex name` };
  const name = body.toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(name)) return { error: `"${t}": vertex names may contain only letters, digits and _` };
  return { name, male };
}

// Forest check: 1..EB_MAX_VERTICES vertices and no cycle (union-find). Returns { errors, components }.
function ebValidateForest(names, edges) {
  const errors = [];
  if (names.length === 0) {
    errors.push("The input contains no vertices.");
    return { errors, components: 0 };
  }
  if (names.length > EB_MAX_VERTICES) {
    errors.push(`The input has ${names.length} vertices; at most ${EB_MAX_VERTICES} can be drawn.`);
    return { errors, components: 0 };
  }
  const parent = {};
  names.forEach(n => { parent[n] = n; });
  const find = x => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  let components = names.length;
  edges.forEach(([u, v]) => {
    const ru = find(u), rv = find(v);
    if (ru === rv) {
      errors.push(`Not a forest: edge ${u}-${v} closes a cycle (${u} and ${v} are already connected).`);
    } else {
      parent[ru] = rv;
      components--;
    }
  });
  return { errors, components };
}

function ebParseList(text) {
  const errors = [];
  const genderOf = {};
  const reported = new Set();
  const order = [];
  const headLine = {};
  const listed = {};

  const note = (tok, where) => {
    if (!Object.prototype.hasOwnProperty.call(genderOf, tok.name)) {
      genderOf[tok.name] = { male: tok.male, where };
      order.push(tok.name);
    } else if (genderOf[tok.name].male !== tok.male && !reported.has(tok.name)) {
      reported.add(tok.name);
      const first = genderOf[tok.name];
      errors.push(`Vertex ${tok.name} is ${first.male ? `marked male (*${tok.name})` : "unmarked (female)"} ${first.where} ` +
        `but ${tok.male ? `marked male (*${tok.name})` : "unmarked (female)"} ${where}. Mark a male vertex with * wherever it appears.`);
    }
  };

  String(text).split(/\r?\n/).forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    const line = rawLine.trim();
    if (line === "") return;
    if ((line.match(/:/g) || []).length !== 1) {
      errors.push(`Line ${lineNo} ("${line}"): expected exactly one ":" in the form Vertex:Neighbour,Neighbour,... (use "D:" for an isolated vertex).`);
      return;
    }
    const [headPart, nbrPart] = line.split(":");
    const head = ebParseName(headPart);
    if (head.error) { errors.push(`Line ${lineNo}: ${head.error}.`); return; }
    if (Object.prototype.hasOwnProperty.call(headLine, head.name)) {
      errors.push(`Line ${lineNo}: vertex ${head.name} already has its own line (line ${headLine[head.name]}); list all its neighbours on one line.`);
      return;
    }
    headLine[head.name] = lineNo;
    note(head, `on line ${lineNo}`);
    listed[head.name] = new Set();
    if (nbrPart.trim() === "") return;
    nbrPart.split(",").forEach(raw => {
      const nb = ebParseName(raw);
      if (nb.error) { errors.push(`Line ${lineNo}: ${nb.error}.`); return; }
      if (nb.name === head.name) { errors.push(`Line ${lineNo}: self-loop ${head.name}-${head.name} is not allowed in a forest.`); return; }
      if (listed[head.name].has(nb.name)) { errors.push(`Line ${lineNo}: neighbour ${nb.name} of ${head.name} is listed twice.`); return; }
      listed[head.name].add(nb.name);
      note(nb, `on line ${lineNo} (neighbour of ${head.name})`);
    });
  });

  const keys = new Set();
  const edges = [];
  Object.keys(listed).forEach(u => {
    listed[u].forEach(v => {
      if (listed[v] && !listed[v].has(u)) {
        errors.push(`Line ${headLine[u]} lists ${v} as a neighbour of ${u}, but the line of ${v} (line ${headLine[v]}) does not list ${u}.`);
        return;
      }
      const k = [u, v].sort().join("-");
      if (!keys.has(k)) { keys.add(k); edges.push([u, v]); }
    });
  });

  const genders = {};
  order.forEach(n => { genders[n] = genderOf[n].male ? "M" : "F"; });
  let components = 0;
  if (errors.length === 0) {
    const r = ebValidateForest(order, edges);
    errors.push(...r.errors);
    components = r.components;
  }
  return { names: order, genders, edges, errors, components };
}

function ebParseMatrix(text) {
  const errors = [];
  const rows = String(text).split(/\r?\n/).map(r => r.trim()).filter(r => r.length > 0);
  const n = rows.length;
  const names = [], genders = {}, edges = [];
  if (n === 0) { errors.push("The matrix is empty."); return { names, genders, edges, errors, components: 0 }; }
  if (n > EB_MAX_VERTICES) {
    errors.push(`The matrix has ${n} rows; at most ${EB_MAX_VERTICES} vertices can be drawn.`);
    return { names, genders, edges, errors, components: 0 };
  }
  for (let i = 0; i < n; i++) names.push(ebVertexLabel(i));

  const cells = [];
  rows.forEach((row, i) => {
    const label = names[i];
    let body = row;
    let male = false;
    if (body.startsWith("*")) { male = true; body = body.slice(1).trim(); }
    genders[label] = male ? "M" : "F";
    if (body.includes("*")) { errors.push(`Row ${i + 1} (${label}): * may appear only once, at the very beginning of the row.`); cells.push(null); return; }
    const vals = body.split(",").map(c => c.trim());
    if (vals.length !== n) {
      errors.push(`Row ${i + 1} (${label}) has ${vals.length} entr${vals.length === 1 ? "y" : "ies"}; a ${n} x ${n} matrix needs ${n}.`);
      cells.push(null); return;
    }
    const bad = vals.findIndex(c => c !== "0" && c !== "1");
    if (bad !== -1) { errors.push(`Row ${i + 1} (${label}), column ${bad + 1}: "${vals[bad]}" is not 0 or 1.`); cells.push(null); return; }
    if (vals[i] === "1") errors.push(`Row ${i + 1} (${label}): diagonal entry is 1 (self-loop ${label}-${label} is not allowed in a forest).`);
    cells.push(vals);
  });

  if (errors.length === 0) {
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (cells[i][j] !== cells[j][i]) {
          errors.push(`Matrix is not symmetric: entry (${i + 1},${j + 1}) for ${names[i]}-${names[j]} is ${cells[i][j]} but (${j + 1},${i + 1}) is ${cells[j][i]}.`);
        } else if (cells[i][j] === "1") {
          edges.push([names[i], names[j]]);
        }
      }
    }
  }
  let components = 0;
  if (errors.length === 0) {
    const r = ebValidateForest(names, edges);
    errors.push(...r.errors);
    components = r.components;
  }
  return { names, genders, edges, errors, components };
}

function ebReportErrors(kind, errors) {
  const shown = errors.slice(0, EB_MAX_ERRORS_SHOWN).map(e => " • " + e).join("\n");
  const more = errors.length > EB_MAX_ERRORS_SHOWN ? `\n ... and ${errors.length - EB_MAX_ERRORS_SHOWN} more.` : "";
  alert(`${kind} input rejected (${errors.length} problem${errors.length === 1 ? "" : "s"}):\n${shown}${more}\n\nThe current graph was not changed.`);
  ebSetStatus(`${kind} input rejected: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`);
}

function ebSetStatus(text) {
  const s = ebEl("status");
  if (s) s.textContent = text;
}

// Replaces the graph with parsed input
function ebLoadParsed(parsed, source) {
  ebGraph = {};
  ebGender = {};
  ebOrder = parsed.names.slice();
  ebSelected = null;
  parsed.names.forEach(n => { ebGraph[n] = []; ebGender[n] = parsed.genders[n] === "M" ? "M" : "F"; });
  parsed.edges.forEach(([u, v]) => { ebGraph[u].push(v); ebGraph[v].push(u); });
  const rootInp = ebEl("rootNode");
  if (rootInp && rootInp.value && !ebGraph[rootInp.value.trim().toUpperCase()]) rootInp.value = "";
  const males = parsed.names.filter(n => ebGender[n] === "M").length;
  ebGraphChanged(`Forest loaded from ${source}: ${parsed.names.length} vertices, ${parsed.edges.length} edges, ` +
    `${parsed.components} tree${parsed.components === 1 ? "" : "s"} (${males} male, ${parsed.names.length - males} female).`);
}

function ebBuildFromList() {
  const inp = ebEl("listInput");
  if (!inp) return;
  const parsed = ebParseList(inp.value);
  if (parsed.errors.length) { ebReportErrors("Adjacency list", parsed.errors); return; }
  ebLoadParsed(parsed, "adjacency list");
}

function ebBuildFromMatrix() {
  const inp = ebEl("matrixInput");
  if (!inp) return;
  const parsed = ebParseMatrix(inp.value);
  if (parsed.errors.length) { ebReportErrors("Adjacency matrix", parsed.errors); return; }
  ebLoadParsed(parsed, "adjacency matrix");
}

// --- Visual builder ---
function ebAddVertex() {
  if (ebOrder.length >= EB_MAX_VERTICES) { alert(`At most ${EB_MAX_VERTICES} vertices can be drawn.`); return; }
  const name = ebNextFreeLabel();
  const gSel = ebEl("newVertexGender");
  ebGraph[name] = [];
  ebGender[name] = gSel && gSel.value === "M" ? "M" : "F";
  ebOrder.push(name);
  ebGraphChanged(`Added ${ebGender[name] === "M" ? "male" : "female"} vertex ${name}.`);
}

// Click on a pad in Visual Builder mode: the first click selects, the second click on another pad connects them
function ebPadClicked(name) {
  const mode = ebEl("mode");
  if (mode && mode.value !== "visual") return;
  if (!ebSelected) {
    ebSelected = name;
    ebSetStatus(`Selected ${name}. Click another vertex to connect it (click ${name} again to cancel).`);
  } else if (ebSelected === name) {
    ebSelected = null;
    ebSetStatus("Selection cleared.");
  } else {
    const a = ebSelected;
    ebSelected = null;
    if (ebGraph[a].includes(name)) {
      ebSetStatus(`Edge ${a} - ${name} already exists.`);
    } else if (ebConnected(a, name)) {
      ebSetStatus(`Edge ${a} - ${name} rejected: ${a} and ${name} are already in the same tree, so it would create a cycle (forests only).`);
    } else {
      ebGraph[a].push(name);
      ebGraph[name].push(a);
      ebGraphChanged(`Connected ${a} - ${name}.`);
      return;
    }
  }
  if (typeof ebRender === "function") ebRender();
}

function ebUpdateLists() {
  const vList = ebEl("vertexList");
  const eList = ebEl("edgeList");
  if (vList) {
    const keep = vList.value;
    vList.innerHTML = "";
    Object.keys(ebGraph).sort(ebCompareLabels).forEach(v => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = `${ebGender[v] === "M" ? "*" : ""}${v} (${ebGender[v] === "M" ? "male" : "female"})`;
      vList.appendChild(o);
    });
    if (keep && ebGraph[keep]) vList.value = keep;
  }
  if (eList) {
    eList.innerHTML = "";
    const seen = new Set();
    Object.keys(ebGraph).sort(ebCompareLabels).forEach(u => {
      ebGraph[u].forEach(v => {
        const pair = [u, v].sort(ebCompareLabels);
        const k = pair.join(",");
        if (seen.has(k)) return;
        seen.add(k);
        const o = document.createElement("option");
        o.value = k;
        o.textContent = `${pair[0]} - ${pair[1]}`;
        eList.appendChild(o);
      });
    });
  }
}

function ebRemoveVertex() {
  const v = ebEl("vertexList") && ebEl("vertexList").value;
  if (!v || !ebGraph[v]) return;
  ebGraph[v].forEach(u => { ebGraph[u] = ebGraph[u].filter(x => x !== v); });
  delete ebGraph[v];
  delete ebGender[v];
  ebOrder = ebOrder.filter(x => x !== v);
  if (ebSelected === v) ebSelected = null;
  ebGraphChanged(`Removed vertex ${v}.`);
}

function ebRemoveEdge() {
  const val = ebEl("edgeList") && ebEl("edgeList").value;
  if (!val) return;
  const [u, v] = val.split(",");
  if (!ebGraph[u] || !ebGraph[v]) return;
  ebGraph[u] = ebGraph[u].filter(x => x !== v);
  ebGraph[v] = ebGraph[v].filter(x => x !== u);
  ebGraphChanged(`Removed edge ${u} - ${v}.`);
}

function ebToggleGender() {
  const v = ebEl("vertexList") && ebEl("vertexList").value;
  if (!v || !ebGraph[v]) return;
  ebGender[v] = ebGender[v] === "M" ? "F" : "M";
  ebGraphChanged(`Vertex ${v} is now ${ebGender[v] === "M" ? "male" : "female"}.`);
}

function ebClearGraph(clearInputs = true) {
  ebGraph = {};
  ebGender = {};
  ebOrder = [];
  ebSelected = null;
  if (clearInputs) {
    ["listInput", "matrixInput", "importListFile", "importMatrixFile", "rootNode"].forEach(id => { if (ebEl(id)) ebEl(id).value = ""; });
  }
  ebGraphChanged("Graph cleared.");
}

function ebGraphChanged(message) {
  ebUpdateLists();
  if (typeof ebRelayout === "function") ebRelayout(message);
  else ebSetStatus(message || "");
}

// --- Export (same gender format as the input) ---
function ebDownload(filename, text) {
  const a = document.createElement("a");
  a.href = "data:text/plain;charset=utf-8," + encodeURIComponent(text);
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function ebMark(name) {
  return (ebGender[name] === "M" ? "*" : "") + name;
}

function ebExportList() {
  const out = Object.keys(ebGraph).sort(ebCompareLabels)
    .map(u => `${ebMark(u)}:${ebGraph[u].slice().sort(ebCompareLabels).map(ebMark).join(",")}`).join("\n");
  ebDownload("forest_list.txt", out + "\n");
}

function ebExportMatrix() {
  const keys = Object.keys(ebGraph).sort(ebCompareLabels);
  const out = keys.map(u => (ebGender[u] === "M" ? "*" : "") + keys.map(v => ebGraph[u].includes(v) ? 1 : 0).join(",")).join("\n");
  ebDownload("forest_matrix.txt", out + "\n");
}

function ebLoadFileIntoBox(fileInput, box) {
  const file = fileInput && fileInput.files && fileInput.files[0];
  if (!file || !box) return;
  const reader = new FileReader();
  reader.onload = e => { box.value = e.target.result; };
  reader.readAsText(file);
}

function ebSwitchMode() {
  const m = ebEl("mode") ? ebEl("mode").value : "list";
  ["visual", "list", "matrix"].forEach(k => {
    const div = ebEl(k + "Mode");
    if (div) div.style.display = (k === m) ? "block" : "none";
  });
  if (m !== "visual" && ebSelected) {
    ebSelected = null;
    if (typeof ebRender === "function") ebRender();
  }
}

function ebInitApp() {
  const on = (id, fn) => { const el = ebEl(id); if (el) el.onclick = fn; };
  on("addNodeBtn", ebAddVertex);
  on("showListGraphBtn", ebBuildFromList);
  on("showMatrixGraphBtn", ebBuildFromMatrix);
  on("clearBtn", () => ebClearGraph(true));
  on("exportListBtn", ebExportList);
  on("exportMatrixBtn", ebExportMatrix);
  on("removeVertexBtn", ebRemoveVertex);
  on("removeEdgeBtn", ebRemoveEdge);
  on("toggleGenderBtn", ebToggleGender);
  const il = ebEl("importListFile"), im = ebEl("importMatrixFile");
  on("importListBtn", () => il && il.click());
  on("importMatrixBtn", () => im && im.click());
  if (il) il.onchange = () => ebLoadFileIntoBox(il, ebEl("listInput"));
  if (im) im.onchange = () => ebLoadFileIntoBox(im, ebEl("matrixInput"));
  if (ebEl("mode")) ebEl("mode").onchange = ebSwitchMode;
  ebSwitchMode();
  ebUpdateLists();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ebInitApp);
else ebInitApp();
