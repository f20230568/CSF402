const MAX_RENDER_NODES = 300;
const MAX_MATRIX_SIZE = 300;

let canvasWidth = 800;
let canvasHeight = 450;

let graph = {};
let nodes = {};
let edges = [];
let history = [];
let visited = new Set();
let structure = [];
let algorithm = "";
let current = null;
let selected = null;
let nodeIndex = 0;

let timer = 0;
let timeData = {};
let pendingNeighbors = []; 
let traversalOrder = []; 

let gridX = 20, gridY = 20;
let isForceRunning = false;

const STEP = 70;

const getEl = id => document.getElementById(id);

// Vertex label for index i: A..Z, then A1..Z1, A2..Z2, ... (no ASCII overflow past 'Z')
function getVertexLabel(i) {
  return String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");
}

// Inverse of getVertexLabel; returns -1 for labels that do not follow the A..Z / A1.. scheme
function getVertexLabelIndex(name) {
  const m = /^([A-Z])(\d*)$/.exec(String(name));
  if (!m) return -1;
  const suffix = m[2] === "" ? 0 : parseInt(m[2], 10);
  if (m[2] !== "" && suffix < 1) return -1;
  return suffix * 26 + (m[1].charCodeAt(0) - 65);
}

// Natural ordering of labels: A, B, ..., Z, A1, B1, ... (custom names afterwards, alphabetically)
function compareVertexLabels(a, b) {
  const ia = getVertexLabelIndex(a);
  const ib = getVertexLabelIndex(b);
  if (ia >= 0 && ib >= 0) return ia - ib;
  if (ia >= 0) return -1;
  if (ib >= 0) return 1;
  return String(a).localeCompare(String(b));
}

// Smallest unused automatic label (A, B, ..., Z, A1, ...). Labels freed by removing a vertex are
// reused, so the automatic labels always match the number of vertices (no gaps, no skipped letters).
function nextFreeVertexLabel() {
  let i = 0;
  let name = getVertexLabel(i);
  while (graph[name] || nodes[name]) {
    i++;
    name = getVertexLabel(i);
  }
  nodeIndex = Math.max(nodeIndex, i + 1);
  return name;
}

// Called after every change to the vertex or edge set: anything computed for the old graph
// (step-by-step BFS progress and its [k / n] counter, BFS layers, edge-collision list) is now stale.
function notifyGraphChanged() {
  if (window.stepBfsState) window.stepBfsState.active = false;

  const bfsDisplayElem = getEl("bfsLayersDisplay");
  if (bfsDisplayElem) bfsDisplayElem.innerText = "[]";

  const edgeOverlapList = getEl("edgeOverlapList");
  if (edgeOverlapList) {
    window.lastEdgeOverlapClusterKeys = [];
    edgeOverlapList.innerHTML = "";
    const li = document.createElement("li");
    li.style.color = "#27ae60";
    li.style.fontWeight = "bold";
    li.textContent = "None";
    edgeOverlapList.appendChild(li);
  }

  const statusP = getEl("status");
  if (statusP && window.isMetroMode) {
    const v = Object.keys(graph).length;
    let degree = 0;
    for (const u in graph) degree += (graph[u] || []).length;
    statusP.textContent = `Graph changed: ${v} vertices, ${degree / 2} edges. Run the layout again to update the drawing.`;
  }
}

function initAppListeners() {
  const addNodeBtn       = getEl("addNodeBtn");
  const clearBtn         = getEl("clearBtn");
  const bfsBtn           = getEl("bfsBtn");
  const dfsBtn           = getEl("dfsBtn");
  const nextBtn          = getEl("nextBtn");
  const runAllBtn        = getEl("runAllBtn");
  const undoBtn          = getEl("undoBtn");
  const exportListBtn    = getEl("exportListBtn");
  const exportMatrixBtn  = getEl("exportMatrixBtn");
  const removeVertexBtn  = getEl("removeVertexBtn");
  const removeEdgeBtn    = getEl("removeEdgeBtn");
  const showListGraphBtn = getEl("showListGraphBtn");
  const showMatrixGraphBtn = getEl("showMatrixGraphBtn");
  const importListFile   = getEl("importListFile");
  const importListBtn    = getEl("importListBtn");
  const importMatrixFile = getEl("importMatrixFile");
  const importMatrixBtn  = getEl("importMatrixBtn");
  const toggleForceBtn   = getEl("toggleForceParams");
  const runForceAllBtn   = getEl("runForceAll");
  const runForceStepBtn  = getEl("runForceStep");

  if (addNodeBtn)       addNodeBtn.onclick = () => addNode();
  if (clearBtn)         clearBtn.onclick = () => clearGraph(true);
  if (bfsBtn)           bfsBtn.onclick = () => startAlgo("BFS");
  if (dfsBtn)           dfsBtn.onclick = () => startAlgo("DFS");
  if (nextBtn)          nextBtn.onclick = () => stepForward();
  if (runAllBtn)        runAllBtn.onclick = () => runToEnd();
  if (undoBtn)          undoBtn.onclick = () => stepBack();
  if (exportListBtn)    exportListBtn.onclick = () => exportList();
  if (exportMatrixBtn)  exportMatrixBtn.onclick = () => exportMatrix();
  if (removeVertexBtn)  removeVertexBtn.onclick = () => removeVertex();
  if (removeEdgeBtn)    removeEdgeBtn.onclick = () => removeEdge();
  if (showListGraphBtn) showListGraphBtn.onclick = () => buildFromList();
  if (showMatrixGraphBtn) showMatrixGraphBtn.onclick = () => buildFromMatrix();

  if (importListBtn && importListFile) {
    importListBtn.onclick = () => importListFile.click();
    importListFile.onchange = () => loadFileIntoBox(importListFile, getEl("listInput"));
  }

  if (importMatrixBtn && importMatrixFile) {
    importMatrixBtn.onclick = () => importMatrixFile.click();
    importMatrixFile.onchange = () => loadFileIntoBox(importMatrixFile, getEl("matrixInput"));
  }

  if (toggleForceBtn) {
    toggleForceBtn.onclick = () => {
      const forceParamsDiv = getEl("forceParams");
      if (forceParamsDiv) {
        forceParamsDiv.style.display = forceParamsDiv.style.display === "none" ? "block" : "none";
      }
    };
  }

  if (runForceAllBtn)  runForceAllBtn.onclick = () => runForceDirected(true);
  if (runForceStepBtn) runForceStepBtn.onclick = () => runForceDirected(false);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAppListeners);
} else {
  initAppListeners();
}

function switchMode() {
  const modeSel = getEl("mode");
  const visualMode = getEl("visualMode");
  const listMode = getEl("listMode");
  const matrixMode = getEl("matrixMode");

  if (!modeSel) return;
  if (visualMode) visualMode.style.display = "none";
  if (listMode) listMode.style.display = "none";
  if (matrixMode) matrixMode.style.display = "none";

  const m = modeSel.value;
  if (m === "visual" && visualMode) visualMode.style.display = "block";
  else if (m === "list" && listMode) listMode.style.display = "block";
  else if (m === "matrix" && matrixMode) matrixMode.style.display = "block";
}

function addNode(nameOpt) {
  const canvasDiv = getEl("canvas");
  const startNodeInp = getEl("startNode");
  if (!canvasDiv) return;

  const name = nameOpt || nextFreeVertexLabel();
  let div = document.createElement("div");
  div.className = "node";
  div.textContent = name;
  div.style.left = gridX + "px";
  div.style.top = gridY + "px";

  gridX += STEP;
  if (gridX > 720) { gridX = 20; gridY += STEP; }

  makeDraggable(div);
  div.onclick = () => selectNode(name);

  canvasDiv.appendChild(div);
  nodes[name] = div;
  if (!graph[name]) graph[name] = [];
  if (startNodeInp && !startNodeInp.value) startNodeInp.value = name;
  updateLists();
  updateCanvasSize(gridX, gridY);
  notifyGraphChanged();
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function selectNode(name) {
  const modeSel = getEl("mode");
  if (modeSel && modeSel.value !== "visual") return;
  Object.values(nodes).forEach(n => n.classList.remove("selected-node"));

  if (!selected) {
    selected = name;
    if (nodes[name]) nodes[name].classList.add("selected-node");
  } else {
    if (selected === name) {
      selected = null;
      return;
    }

    if (!graph[selected]) graph[selected] = [];
    if (!graph[name]) graph[name] = [];

    // Do not add the same edge twice (a duplicate would be counted as an extra edge)
    if (graph[selected].some(e => e.to === name)) {
      const statusP = getEl("status");
      if (statusP) statusP.textContent = `Edge ${selected} - ${name} already exists.`;
      selected = null;
      return;
    }

    graph[selected].push({ to: name });
    graph[name].push({ to: selected });

    selected = null;
    drawEdges();
    updateLists();
    notifyGraphChanged();
    if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  }
}

function placeNodesGrid(names, genders = null) {
  const canvasDiv = getEl("canvas");
  if (!canvasDiv) return;

  if (names.length > MAX_RENDER_NODES) {
    alert("Graph too large for visual rendering. Loaded in data mode only.");
    return;
  }

  const cols = Math.min(names.length, 10) || 1;  
  const startX = 40;
  const startY = 40;
  const gap = 140;

  names.forEach((name, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;

    let div = document.createElement("div");
    div.className = "node";
    div.textContent = name;

    div.style.left = (startX + col * gap) + "px";
    div.style.top  = (startY + row * gap) + "px";

    makeDraggable(div);
    div.onclick = () => selectNode(name);

    canvasDiv.appendChild(div);
    nodes[name] = div;
    if (!graph[name]) graph[name] = [];
    if (genders && genders[name]) setNodeGender(name, genders[name]);
  });

  nodeIndex = names.length;
  updateCanvasSize(gridX, gridY);
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function updateLists() {
  const vertexList = getEl("vertexList");
  const edgeList = getEl("edgeList");
  if (!vertexList || !edgeList) return;

  vertexList.innerHTML = "";
  edgeList.innerHTML = "";

  Object.keys(graph).sort(compareVertexLabels).forEach(v => {
    let opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    vertexList.appendChild(opt);
  });

  let seen = new Set();
  for (let u in graph) {
    (graph[u] || []).forEach(e => {
      let pair = [u, e.to].sort();
      let key = pair.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        let opt = document.createElement("option");
        opt.value = key;
        opt.textContent = `${pair[0]} - ${pair[1]}`;
        edgeList.appendChild(opt);
      }
    });
  }
}

function removeVertex() {
  const vertexList = getEl("vertexList");
  const startNodeInp = getEl("startNode");
  if (!vertexList) return;
  const v = vertexList.value;
  if (!v) return;

  delete graph[v];
  Object.keys(graph).forEach(node => {
    graph[node] = graph[node].filter(edge => edge.to !== v);
  });

  if (nodes[v]) {
    nodes[v].remove();
    delete nodes[v];
  }

  if (startNodeInp && startNodeInp.value === v) {
    startNodeInp.value = Object.keys(graph)[0] || "";
  }

  if (selected === v) selected = null;

  drawEdges();
  updateLists();
  notifyGraphChanged();
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function removeEdge() {
  const edgeList = getEl("edgeList");
  if (!edgeList) return;
  const val = edgeList.value;
  if (!val) return;

  const [u, v] = val.split(",");
  if (graph[u]) graph[u] = graph[u].filter(e => e.to !== v);
  if (graph[v]) graph[v] = graph[v].filter(e => e.to !== u);

  drawEdges();
  updateLists();
  notifyGraphChanged();
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function makeDraggable(el) {
  el.onmousedown = e => {
    if (e.button !== 0) return;             // left button only
    e.preventDefault();                     // no text selection or native drag while moving the vertex
    const canvasDiv = getEl("canvas");
    if (!canvasDiv) return;

    // Delta-based drag: the vertex moves by exactly as much as the mouse moves from where it was pressed.
    // Nothing depends on where the page or canvas sits, so page scrolling, canvas scrolling, borders,
    // margins and CSS transforms on the vertex cannot make it jump.
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startLeft = parseFloat(el.style.left);
    const startTop  = parseFloat(el.style.top);
    const baseLeft = isNaN(startLeft) ? el.offsetLeft : startLeft;
    const baseTop  = isNaN(startTop)  ? el.offsetTop  : startTop;
    const startScrollLeft = canvasDiv.scrollLeft;
    const startScrollTop  = canvasDiv.scrollTop;

    // Screen pixels per CSS pixel of the canvas (1 normally; differs when the page uses CSS zoom/scale)
    const canvasRect = canvasDiv.getBoundingClientRect();
    const scaleX = (canvasDiv.offsetWidth  > 0 && canvasRect.width  > 0) ? canvasRect.width  / canvasDiv.offsetWidth  : 1;
    const scaleY = (canvasDiv.offsetHeight > 0 && canvasRect.height > 0) ? canvasRect.height / canvasDiv.offsetHeight : 1;

    document.onmousemove = m => {
      m.preventDefault();
      const dx = (m.clientX - startMouseX) / scaleX + (canvasDiv.scrollLeft - startScrollLeft);
      const dy = (m.clientY - startMouseY) / scaleY + (canvasDiv.scrollTop  - startScrollTop);
      el.style.left = Math.round(baseLeft + dx) + "px";
      el.style.top  = Math.round(baseTop  + dy) + "px";
      drawEdges();
      if (typeof updateCoords === "function") updateCoords();
      if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
      //if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
    };
    document.onmouseup = () => {
      document.onmousemove = null;
      document.onmouseup = null;
      if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
      //if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
    };
  };
}

function startAlgo(type) {
  const startNodeInp = getEl("startNode");
  if (!startNodeInp || !startNodeInp.value) return alert("Enter start node");
  const s = startNodeInp.value.trim().toUpperCase();
  if (!graph[s]) return alert("Node not found");
  
  history = [];
  visited.clear();
  timeData = {}; 
  timer = 0;
  algorithm = type;
  current = null;

  if (algorithm === "BFS") {
    timeData[s] = { distance: 0, parent: "None" };
  }

  structure = [{ name: s, type: 'discover' }];
  snapshot();
  update();
}

function stepForward() {
  if (!structure.length) {
    const remaining = Object.keys(graph).sort().find(v => !visited.has(v));
    if (!remaining) return; 
    
    if (algorithm === "BFS") {
      timeData[remaining] = { distance: 0, parent: "None" };
    }
    structure.push({ name: remaining, type: 'discover' });
  }

  snapshot();

  let task = (algorithm === "BFS") ? structure.shift() : structure.pop();
  const { name, type, parent } = task;

  if (type === 'discover') {
    if (visited.has(name)) return stepForward(); 

    timer++;
    visited.add(name);
    current = name;

    if (algorithm === "DFS") {
      timeData[name] = { d: timer };
      structure.push({ name: name, type: 'finish' });
      
      let neighbors = (graph[name] || [])
        .map(e => e.to)
        .filter(v => !visited.has(v))
        .sort().reverse();

      neighbors.forEach(v => {
        structure.push({ name: v, type: 'discover' });
      });
    } else {
      structure.push({ name: name, type: 'expand' });
    }
  } 
  else if (type === 'expand') {
    current = name;
    let neighbors = (graph[name] || [])
      .map(e => e.to)
      .filter(v => !visited.has(v) && !structure.some(s => s.name === v))
      .sort();

    neighbors.reverse().forEach(v => {
      structure.unshift({ name: v, type: 'queue_neighbor', parent: name });
    });
  }
  else if (type === 'queue_neighbor') {
    current = parent; 
    
    if (!visited.has(name)) {
      timeData[name] = { 
        distance: timeData[parent].distance + 1, 
        parent: parent 
      };
      structure.push({ name: name, type: 'discover' });
    } else {
      return stepForward();
    }
  }
  else if (type === 'finish') {
    current = name;
    if (algorithm === "DFS") {
      timer++;
      timeData[name].f = timer;
    }
  }

  update();
  checkFinished();
}

function checkFinished() {
  const statusP = getEl("status");
  const allVisited = Object.keys(graph).every(v => visited.has(v));
  const stackEmpty = structure.length === 0;

  if (allVisited && stackEmpty) {
    Object.values(nodes).forEach(n => n.classList.remove("current"));
    const traversal = Array.from(visited).join(" -> ");
    if (statusP) statusP.innerText = `${algorithm} Complete. Full Traversal: [${traversal}]`;
    update();
  }
}

function runToEnd() {
  if (!algorithm) return alert("Select BFS or DFS first");
  const totalNodes = Object.keys(graph).length;
  let safetyNet = 0;
  const maxTicks = totalNodes * 10; 

  while (traversalOrder.length < totalNodes && safetyNet < maxTicks) {
    stepForward();
    safetyNet++;
  }
  update(); 
}

function snapshot() {
  history.push({ 
    visited: Array.from(visited), 
    structure: [...structure], 
    current: current,
    timer: timer,
    timeData: JSON.parse(JSON.stringify(timeData)),
    pendingNeighbors: [...pendingNeighbors],
    traversalOrder: [...traversalOrder] 
  });
}

function stepBack() {
  if (!history.length) return;
  let s = history.pop();
  
  visited = new Set(s.visited);
  structure = [...s.structure];
  current = s.current;
  timer = s.timer;
  timeData = JSON.parse(JSON.stringify(s.timeData)); 
  pendingNeighbors = [...(s.pendingNeighbors || [])];
  traversalOrder = [...(s.traversalOrder || [])]; 
  
  update();
}

function update() {
  const statusP = getEl("status");
  Object.values(nodes).forEach(n => {
    n.classList.remove("visited", "current");
    const existingStamp = n.querySelector(".timestamp");
    if (existingStamp) existingStamp.remove();

    const nodeName = n.textContent;
    if (timeData[nodeName]) {
      let span = document.createElement("span");
      span.className = "timestamp";
      
      if (algorithm === "BFS") {
        const p = timeData[nodeName].parent ?? "?";
        const d = timeData[nodeName].distance ?? "?";
        span.textContent = `${p},${d}`;
      } else {
        const d = timeData[nodeName].d ?? "?";
        const f = timeData[nodeName].f ?? "?";
        span.textContent = `${d}/${f}`;
      }
      
      span.style.cssText = `
        position: absolute;
        top: -25px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 11px;
        font-weight: bold;
        color: #ff5722;
        white-space: nowrap;
        background: rgba(255, 255, 255, 0.8);
        padding: 2px 4px;
        border-radius: 4px;
        pointer-events: none;
      `;
      n.appendChild(span);
    }
  });

  visited.forEach(v => nodes[v]?.classList.add("visited"));
  if (nodes[current]) nodes[current].classList.add("current");

  const allVisited = Object.keys(graph).every(v => visited.has(v));
  const stackEmpty = structure.length === 0;

  if (statusP) {
    if (allVisited && stackEmpty && algorithm !== "") {
      const order = Array.from(visited).join(" -> ");
      statusP.innerText = `${algorithm} Complete. Full Traversal: [${order}]`;
    } else {
      const structureDisplay = structure.map(item => 
        typeof item === 'string' ? item : item.name
      );
      statusP.innerText = `${algorithm || "Idle"} | Structure: [${structureDisplay.join(", ")}]`;
    }
  }
}

function downloadFile(filename, text) {
  const element = document.createElement('a');
  element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
  element.setAttribute('download', filename);
  element.style.display = 'none';
  document.body.appendChild(element);
  element.click();
  document.body.removeChild(element);
}

function exportList() {
  // Male vertices are written with a trailing underscore (A_), female vertices without
  const mark = v => v + (appNodeGender(v) === "M" ? "_" : "");
  let out = "";
  for (let u in graph) out += `${mark(u)}:${graph[u].map(e => mark(e.to)).join(",")}\n`;
  downloadFile("graph_list.txt", out);
}

function exportMatrix() {
  // Natural label order (A..Z, A1..) so that re-importing the matrix gives every vertex its original name.
  // A male vertex's row starts with an underscore.
  let keys = Object.keys(graph).sort(compareVertexLabels);
  let out = keys.map(u => (appNodeGender(u) === "M" ? "_" : "") +
                          keys.map(v => graph[u].some(e => e.to === v) ? 1 : 0).join(",")).join("\n");
  downloadFile("graph_matrix.txt", out);
}

function clearGraph(clearInputs=true) {
  graph = {};
  nodes = {};
  edges = [];
  if (window.edgeBends) window.edgeBends = {};
  if (window.stepBfsState) window.stepBfsState.active = false;

  window.metroOverridesByRoot = {};
  window.metroChangeSummaryByRoot = {};

  visited.clear();
  structure = [];
  history = [];
  algorithm = "";
  current = null;
  selected = null;

  nodeIndex = 0;
  gridX = 20;
  gridY = 20;

  const canvasDiv = getEl("canvas");
  const edgesSvg = getEl("edges");
  const statusP = getEl("status");
  const startNodeInp = getEl("startNode");
  const listInput = getEl("listInput");
  const matrixInput = getEl("matrixInput");
  const importListFile = getEl("importListFile");
  const importMatrixFile = getEl("importMatrixFile");
  const bfsDisplayElem = getEl("bfsLayersDisplay");

  if (canvasDiv) canvasDiv.querySelectorAll(".node").forEach(n => n.remove());
  if (edgesSvg) edgesSvg.innerHTML = "";
  if (statusP) statusP.textContent = "";
  if (startNodeInp) startNodeInp.value = "";
  if (bfsDisplayElem) bfsDisplayElem.innerText = "[]";
  updateLists();

  if (clearInputs) {
    if (listInput) listInput.value = "";
    if (matrixInput) matrixInput.value = "";
    if (importListFile) importListFile.value = "";
    if (importMatrixFile) importMatrixFile.value = "";
  }

  if (typeof checkAndListOverlappingVertices === "function") {
    checkAndListOverlappingVertices();
  }
  if (typeof updateSummaryOfChangesSection === "function") {
    updateSummaryOfChangesSection();
  }
}

function drawEdges() {
  if (window.isAreaAdaptiveMode) {
    return;
  }

  const edgesSvg = getEl("edges");
  if (!edgesSvg) return;

  if (Object.keys(graph).length > MAX_RENDER_NODES) {
    edgesSvg.innerHTML = "";
    return;
  }

  let maxX = 800, maxY = 450;
  Object.values(nodes).forEach(n => {
    maxX = Math.max(maxX, n.offsetLeft + 100);
    maxY = Math.max(maxY, n.offsetTop + 100);
  });

  edgesSvg.setAttribute("width", maxX);
  edgesSvg.setAttribute("height", maxY);
  edgesSvg.innerHTML = "";

  const SVG_NS = "http://www.w3.org/2000/svg"; 
  let seenEdges = new Set();

  for (let u in graph) {
    (graph[u] || []).forEach(e => {
      let v = e.to;
      let edgeKey = [u, v].sort().join("-");
      if (seenEdges.has(edgeKey)) return;
      seenEdges.add(edgeKey);

      if (!nodes[u] || !nodes[v]) return;
      if (nodes[u].style.display === "none" || nodes[v].style.display === "none") return;

      const nodeRadius = window.isMetroMode ? 8 : 22;

      let x1 = nodes[u].offsetLeft + nodeRadius;
      let y1 = nodes[u].offsetTop + nodeRadius;
      let x2 = nodes[v].offsetLeft + nodeRadius;
      let y2 = nodes[v].offsetTop + nodeRadius;

      let path = document.createElementNS(SVG_NS, "path");
      let d = "";

      if (window.isMetroMode) {
        let bend = (window.edgeBends && (window.edgeBends[`${u}-${v}`] || window.edgeBends[`${v}-${u}`])) || null;
        if (bend) {
          d = `M ${x1} ${y1} L ${bend.x} ${bend.y} L ${x2} ${y2}`;
        } else {
          d = `M ${x1} ${y1} L ${x2} ${y2}`;
        }
      } else {
        let midX = (x1 + x2) / 2;
        let midY = (y1 + y2) / 2;
        let curviness = 20; 
        let dx = x2 - x1;
        let dy = y2 - y1;
        let len = Math.sqrt(dx * dx + dy * dy) || 1;

        let qx = midX + (curviness * -dy) / len;
        let qy = midY + (curviness * dx) / len;

        d = `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`;
      }

      path.setAttribute("d", d);
      path.setAttribute("stroke", "#555");
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("fill", "transparent");
      path.setAttribute("stroke-linejoin", "round");
      edgesSvg.appendChild(path);
    });
  }
}

function buildFromList() {
  const listInput = getEl("listInput");
  if (!listInput) return;

  // Check everything first: a bad list leaves the current drawing untouched
  const parsed = parseAdjacencyListText(listInput.value);
  if (parsed.errors.length) {
    alert(formatProblems(`The adjacency list was not loaded (${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"}):`, parsed.errors));
    setStatusText(`Adjacency list not loaded: ${parsed.errors[0]}`);
    return;
  }

  clearGraph(false);

  const names = parsed.names;
  placeNodesGrid(names, parsed.genders);

  names.forEach(n => { if (!graph[n]) graph[n] = []; });
  parsed.edges.forEach(([u, v]) => {
    graph[u].push({ to: v });
    graph[v].push({ to: u });
  });

  if (names.length <= MAX_RENDER_NODES) {
    drawEdges();
  }

  updateLists();
  setStatusText(`Adjacency list loaded: ${names.length} vertices (${summariseGenders(names, parsed.genders)}), ` +
                `${parsed.edges.length} edge${parsed.edges.length === 1 ? "" : "s"}.` + (parsed.warnings.length ? " Note: " + parsed.warnings.join(" ") : ""));
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function buildFromMatrix() {
  const matrixInput = getEl("matrixInput");
  if (!matrixInput) return;

  // Check everything first: a bad matrix leaves the current drawing untouched
  const parsed = parseAdjacencyMatrixText(matrixInput.value);
  if (parsed.errors.length) {
    alert(formatProblems(`The adjacency matrix was not loaded (${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"}):`, parsed.errors));
    setStatusText(`Adjacency matrix not loaded: ${parsed.errors[0]}`);
    return;
  }

  clearGraph(false);

  let size = parsed.size;

  if (size > MAX_MATRIX_SIZE) {
    alert("Matrix too large! Processing in lightweight mode.");
  }

  let labels = [];
  const genders = {};
  for (let i = 0; i < size; i++) {
    labels.push(getVertexLabel(i));
    genders[labels[i]] = parsed.male[i] ? "M" : "F";
  }

  placeNodesGrid(labels, genders);

  let edgeCount = 0;
  for (let i = 0; i < size; i++) {
    let u = labels[i];
    if (!graph[u]) graph[u] = [];

    for (let j = i + 1; j < size; j++) {
      if (parsed.rows[i][j]) {
        let v = labels[j];
        if (!graph[v]) graph[v] = [];
        graph[u].push({ to: v });
        graph[v].push({ to: u });
        edgeCount++;
      }
    }
  }

  if (size <= MAX_RENDER_NODES) {
    drawEdges();
  }

  updateLists();
  setStatusText(`Adjacency matrix loaded: ${size} vertices (${summariseGenders(labels, genders)}), ${edgeCount} edge${edgeCount === 1 ? "" : "s"}.` +
                (parsed.warnings.length ? " Note: " + parsed.warnings.join(" ") : ""));
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function loadFileIntoBox(fileInput, targetBox) {
  if (!fileInput || !targetBox) return;
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  const isMatrix = targetBox.id === "matrixInput";
  const kind = isMatrix ? "adjacency matrix" : "adjacency list";

  // File checks: plain text, not too large, not empty
  if (!/\.txt$/i.test(file.name)) {
    alert(`"${file.name}" is not a .txt file. Please choose a plain-text ${kind} file.`);
    setStatusText(`File "${file.name}" was not loaded: it is not a .txt file.`);
    fileInput.value = "";
    return;
  }
  if (file.size === 0) {
    alert(`"${file.name}" is empty.`);
    setStatusText(`File "${file.name}" was not loaded: it is empty.`);
    fileInput.value = "";
    return;
  }
  if (file.size > MAX_INPUT_FILE_BYTES) {
    alert(`"${file.name}" is ${(file.size / 1048576).toFixed(1)} MB; files up to ${MAX_INPUT_FILE_BYTES / 1048576} MB are accepted.`);
    setStatusText(`File "${file.name}" was not loaded: it is too large.`);
    fileInput.value = "";
    return;
  }

  const reader = new FileReader();
  reader.onerror = function() {
    alert(`"${file.name}" could not be read.`);
    setStatusText(`File "${file.name}" could not be read.`);
    fileInput.value = "";
  };
  reader.onload = function(e) {
    const text = normaliseInputText(e.target.result);
    // Binary files (images, Word documents, ...) contain control characters that plain text never has
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text) || text.includes("\uFFFD")) {
      alert(`"${file.name}" does not look like a plain-text file.`);
      setStatusText(`File "${file.name}" was not loaded: it is not a plain-text file.`);
      fileInput.value = "";
      return;
    }
    targetBox.value = text;

    // Check the contents now, so problems show up before "Show Graph" is pressed
    const parsed = isMatrix ? parseAdjacencyMatrixText(text) : parseAdjacencyListText(text);
    if (parsed.errors.length) {
      alert(formatProblems(`"${file.name}" was loaded into the box but is not a valid ${kind} ` +
                           `(${parsed.errors.length} problem${parsed.errors.length === 1 ? "" : "s"}):`, parsed.errors));
      setStatusText(`File "${file.name}" has problems: ${parsed.errors[0]}`);
    } else {
      const count = isMatrix ? parsed.size : parsed.names.length;
      const males = isMatrix ? parsed.male.filter(Boolean).length
                             : parsed.names.filter(n => parsed.genders[n] === "M").length;
      setStatusText(`File "${file.name}" is a valid ${kind}: ${count} vertices (${males} male, ${count - males} female). ` +
                    `Press "Show Graph" to draw it.` + (parsed.warnings.length ? " Note: " + parsed.warnings.join(" ") : ""));
    }
  };
  reader.readAsText(file);
}

// ---------------------------------------------------------------------------------------------
// Gender in the adjacency list and matrix
//   List:   a male vertex is written with a trailing underscore (A_), a female vertex without (A).
//           Example:  A_:B,C_   B:A_,D   C_:A_   D:B   (A and C male, B and D female)
//   Matrix: a row that starts with an underscore is a male vertex, every other row is female.
//           Example:  _0,1,1   1,0,0   _1,0,0         (A and C male, B female)
// The Visual Builder keeps the alternating genders (A male, B female, C male, ...).
// ---------------------------------------------------------------------------------------------

const MAX_INPUT_FILE_BYTES = 2 * 1024 * 1024;   // larger files are refused
const MAX_LISTED_PROBLEMS = 12;                 // problems shown in one message
const MAX_VERTEX_NAME_LENGTH = 12;

// Gender of a vertex as drawn: the metro code's rule when it is loaded, otherwise the stored gender,
// otherwise the Visual Builder's alternating rule.
function appNodeGender(name) {
  if (typeof getNodeGender === "function") return getNodeGender(name);
  if (nodes[name] && nodes[name].dataset && nodes[name].dataset.gender) return nodes[name].dataset.gender.toUpperCase();
  return String(name).charCodeAt(0) % 2 === 0 ? "F" : "M";
}

function setNodeGender(name, gender) {
  const el = nodes[name];
  if (!el) return;
  el.dataset.gender = gender;
  el.classList.remove("node-male", "node-female");
  el.classList.add(gender === "M" ? "node-male" : "node-female");
}

// Text from a box or file: no byte-order mark, Unix line ends
function normaliseInputText(text) {
  return String(text == null ? "" : text).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

function formatProblems(title, problems) {
  const shown = problems.slice(0, MAX_LISTED_PROBLEMS).map(p => " - " + p);
  if (problems.length > MAX_LISTED_PROBLEMS) shown.push(` - ... and ${problems.length - MAX_LISTED_PROBLEMS} more`);
  return title + "\n" + shown.join("\n");
}

function setStatusText(text) {
  const statusP = getEl("status");
  if (statusP) statusP.textContent = text;
}

// One vertex token of the list, e.g. "A", "a_", "B12_"
function parseListToken(raw, lineNo) {
  const tok = raw.trim().toUpperCase();
  if (tok === "") return { error: `Line ${lineNo}: empty vertex name.` };
  if (/^_/.test(tok)) {
    return { error: `Line ${lineNo}: "${raw.trim()}" starts with an underscore. Male vertices are written with the underscore at the end (e.g. A_).` };
  }
  if (/__+$/.test(tok)) {
    return { error: `Line ${lineNo}: "${raw.trim()}" has more than one underscore. Use one trailing underscore for a male vertex (e.g. A_).` };
  }
  const m = /^([A-Z0-9]+)(_?)$/.exec(tok);
  if (!m) {
    return { error: `Line ${lineNo}: "${raw.trim()}" is not a valid vertex name. Use letters and digits only, plus an optional trailing _ for male.` };
  }
  if (m[1].length > MAX_VERTEX_NAME_LENGTH) {
    return { error: `Line ${lineNo}: "${raw.trim()}" is longer than ${MAX_VERTEX_NAME_LENGTH} characters.` };
  }
  return { name: m[1], gender: m[2] === "_" ? "M" : "F" };
}

// Checks an adjacency list and returns { errors, warnings, names, genders, edges }
function parseAdjacencyListText(text) {
  const errors = [], warnings = [];
  const names = [];                 // vertices in order of first appearance (any position)
  const genders = {};               // name -> "M" | "F"
  const firstSeen = {};             // name -> { line, written }
  const edges = [];                 // [u, v] pairs, each undirected edge once
  const edgeKeys = new Set();
  const selfLoops = new Set();

  const lines = normaliseInputText(text).split("\n");
  if (lines.every(l => l.trim() === "")) {
    errors.push("The adjacency list is empty.");
    return { errors, warnings, names, genders, edges };
  }

  const useToken = (raw, lineNo) => {
    const t = parseListToken(raw, lineNo);
    if (t.error) { errors.push(t.error); return null; }
    if (!(t.name in genders)) {
      genders[t.name] = t.gender;
      firstSeen[t.name] = { line: lineNo, written: raw.trim() };
      names.push(t.name);
    } else if (genders[t.name] !== t.gender) {
      const f = firstSeen[t.name];
      errors.push(`Vertex ${t.name} is written as "${f.written}" (${genders[t.name] === "M" ? "male" : "female"}) on line ${f.line} ` +
                  `but as "${raw.trim()}" (${t.gender === "M" ? "male" : "female"}) on line ${lineNo}. Write it the same way everywhere.`);
    }
    return t.name;
  };

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (line.trim() === "") return;
    const parts = line.split(":");
    if (parts.length > 2) {
      errors.push(`Line ${lineNo}: more than one ":" (expected the form A_:B,C).`);
      return;
    }
    const head = useToken(parts[0], lineNo);
    if (parts.length === 1 || parts[1].trim() === "") return;     // a vertex without neighbours

    parts[1].split(",").forEach((raw, k, all) => {
      if (raw.trim() === "") {
        if (k !== all.length - 1) errors.push(`Line ${lineNo}: empty neighbour between two commas.`);
        return;                                                  // a single trailing comma is allowed
      }
      const nb = useToken(raw, lineNo);
      if (head === null || nb === null) return;
      if (nb === head) { selfLoops.add(head); return; }
      const key = head < nb ? head + "|" + nb : nb + "|" + head;
      if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push([head, nb]); }
    });
  });

  // Same vertex order as before: vertices that start a line (in line order), then neighbour-only vertices
  const heads = [];
  const headSet = new Set();
  lines.forEach(line => {
    if (line.trim() === "") return;
    const t = parseListToken(line.split(":")[0], 0);
    if (!t.error && !headSet.has(t.name)) { headSet.add(t.name); heads.push(t.name); }
  });
  const ordered = heads.concat(names.filter(n => !headSet.has(n)));
  names.length = 0;
  ordered.forEach(n => names.push(n));

  if (selfLoops.size) warnings.push(`Self-loops ignored at ${Array.from(selfLoops).sort(compareVertexLabels).join(", ")}.`);
  if (!errors.length && names.length && names.every(n => genders[n] === "F")) {
    warnings.push("No vertex is marked male, so every vertex is female. Write a male vertex with a trailing underscore (A_).");
  }
  return { errors, warnings, names, genders, edges };
}

// Checks an adjacency matrix and returns { errors, warnings, size, male, rows }
function parseAdjacencyMatrixText(text) {
  const errors = [], warnings = [];
  const rawRows = normaliseInputText(text).split("\n").map(r => r.trim()).filter(r => r.length > 0);
  const size = rawRows.length;
  const male = [], rows = [];

  if (size === 0) {
    errors.push("The adjacency matrix is empty.");
    return { errors, warnings, size, male, rows };
  }

  rawRows.forEach((rowText, i) => {
    const r = i + 1;
    let body = rowText;
    const isMale = body.startsWith("_");
    if (isMale) body = body.slice(1).trim();
    male.push(isMale);

    if (body.includes("_")) {
      errors.push(`Row ${r}: an underscore is only allowed at the very start of the row (it marks the vertex as male).`);
      rows.push(null);
      return;
    }
    if (!body.includes(",") && /\s/.test(body) && size > 1) {
      errors.push(`Row ${r}: entries must be separated by commas (e.g. 0,1,1).`);
      rows.push(null);
      return;
    }
    const cells = body.split(",").map(c => c.trim());
    const bad = [];
    cells.forEach((c, j) => { if (c !== "0" && c !== "1") bad.push(`column ${j + 1} ("${c}")`); });
    if (bad.length) {
      errors.push(`Row ${r}: every entry must be 0 or 1, found ${bad.slice(0, 3).join(", ")}${bad.length > 3 ? ", ..." : ""}.`);
      rows.push(null);
      return;
    }
    if (cells.length !== size) {
      errors.push(`Row ${r} has ${cells.length} entries, but the matrix has ${size} rows (it must be square).`);
      rows.push(null);
      return;
    }
    rows.push(cells.map(c => c === "1"));
  });

  if (!errors.length) {
    for (let i = 0; i < size; i++) {
      if (rows[i][i]) errors.push(`Row ${i + 1}, column ${i + 1}: the diagonal must be 0 (a vertex cannot be its own neighbour).`);
    }
    for (let i = 0; i < size; i++) {
      for (let j = i + 1; j < size; j++) {
        if (rows[i][j] !== rows[j][i]) {
          errors.push(`Entries (${i + 1}, ${j + 1}) and (${j + 1}, ${i + 1}) differ: the matrix must be symmetric (undirected graph).`);
        }
      }
    }
  }
  if (!errors.length && male.every(m => !m)) {
    warnings.push("No row is marked male, so every vertex is female. Start a male vertex's row with an underscore (_0,1,1).");
  }
  return { errors, warnings, size, male, rows };
}

function summariseGenders(names, genders) {
  const m = names.filter(n => genders[n] === "M").length;
  return `${m} male, ${names.length - m} female`;
}

// Randomize Genders: every vertex gets a random gender and the whole drawing is made again
function randomizeGenders(alpha) {
  const names = Object.keys(nodes).filter(n => nodes[n]);
  if (names.length === 0) {
    alert("Please add vertices first.");
    return;
  }

  const genders = {};
  names.forEach(n => {
    genders[n] = Math.random() < 0.5 ? "M" : "F";
    setNodeGender(n, genders[n]);
  });

  // Earlier fixer adjustments were made for the old genders
  window.metroOverridesByRoot = {};
  window.metroChangeSummaryByRoot = {};
  if (window.stepBfsState) window.stepBfsState.active = false;

  const a = (typeof alpha === "number" && isFinite(alpha) && alpha > 0) ? alpha : 0.75;
  if (typeof runFamilyMetroMapLayout === "function") {
    runFamilyMetroMapLayout(a);
  } else {
    drawEdges();
  }

  const statusP = getEl("status");
  if (statusP) statusP.textContent = `Genders randomized (${summariseGenders(names, genders)}). ` + statusP.textContent;
}

function updateCanvasSize(x, y) {
  const edgesSvg = getEl("edges");
  const padding = 100;

  let newWidth = Math.max(800, x + padding);
  let newHeight = Math.max(450, y + padding);

  if (newWidth !== canvasWidth || newHeight !== canvasHeight) {
    canvasWidth = newWidth;
    canvasHeight = newHeight;
    if (edgesSvg) {
      edgesSvg.setAttribute("width", canvasWidth);
      edgesSvg.setAttribute("height", canvasHeight);
    }
  }
}

function runForceDirected(allAtOnce) {
  const iterInput = getEl("forceIterations");
  if (!iterInput) return;
  let currentIterValue = parseInt(iterInput.value) || 0;

  if (currentIterValue <= 0) return;

  const repulsion = parseFloat(getEl("forceRepulsion")?.value) || 1000;
  const attraction = parseFloat(getEl("forceAttraction")?.value) || 0.05;
  const damping = parseFloat(getEl("forceDamping")?.value) || 0.85;
  
  let iterationsToRun = allAtOnce ? currentIterValue : 1;
  iterInput.value = allAtOnce ? 0 : currentIterValue - 1;

  for (let step = 0; step < iterationsToRun; step++) {
    let forces = {};
    const nodeKeys = Object.keys(nodes);
    nodeKeys.forEach(v => forces[v] = { x: 0, y: 0 });

    for (let i = 0; i < nodeKeys.length; i++) {
      for (let j = i + 1; j < nodeKeys.length; j++) {
        let u = nodeKeys[i], v = nodeKeys[j];
        let dx = nodes[v].offsetLeft - nodes[u].offsetLeft;
        let dy = nodes[v].offsetTop - nodes[u].offsetTop;
        let distSq = dx * dx + dy * dy || 1;
        let dist = Math.sqrt(distSq);
        let f = repulsion / distSq;
        
        let fx = (dx / dist) * f;
        let fy = (dy / dist) * f;
        forces[u].x -= fx; forces[u].y -= fy;
        forces[v].x += fx; forces[v].y += fy;
      }
    }

    let seenPairs = new Set();
    for (let u in graph) {
      if (!graph[u] || !nodes[u]) continue;
      graph[u].forEach(edge => {
        let v = edge.to;
        let pairKey = [u, v].sort().join("-");
        if (!nodes[v] || seenPairs.has(pairKey)) return;
        seenPairs.add(pairKey);

        let dx = nodes[v].offsetLeft - nodes[u].offsetLeft;
        let dy = nodes[v].offsetTop - nodes[u].offsetTop;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        let f = attraction * dist;

        let fx = (dx / dist) * f;
        let fy = (dy / dist) * f;
        forces[u].x -= fx; forces[u].y -= fy;
        forces[v].x += fx; forces[v].y += fy;
      });
    }

    nodeKeys.forEach(v => {
      let el = nodes[v];
      el.style.left = (el.offsetLeft + forces[v].x * damping) + "px";
      el.style.top = (el.offsetTop + forces[v].y * damping) + "px";
    });
  }

  drawEdges();
  updateCoords();
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function updateCoords() {
  const runBtn = getEl("runForceAll");
  if (!runBtn) return;

  const listUl = getEl("coordList");
  if (listUl) listUl.innerHTML = "";

  Object.keys(nodes).sort().forEach(v => {
    let el = nodes[v];
    let x = Math.round(el.offsetLeft);
    let y = Math.round(el.offsetTop);

    let coordSpan = el.querySelector(".coord-label");
    if (!coordSpan) {
      coordSpan = document.createElement("span");
      coordSpan.className = "coord-label";
      coordSpan.style.cssText = "position:absolute; top:-15px; font-size:9px; color:red; white-space:nowrap; pointer-events:none;";
      el.appendChild(coordSpan);
    }
    coordSpan.textContent = `(${x}, ${y})`;

    if (listUl) {
      let li = document.createElement("li");
      li.innerHTML = `<strong>${v}</strong>: x=${x}, y=${y}`;
      li.style.padding = "2px 0";
      listUl.appendChild(li);
    }
  });
}