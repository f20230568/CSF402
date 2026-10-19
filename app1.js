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

// Element that holds the vertices. On pages with a zoomable drawing (#zoomLayer inside #canvas) vertices go
// into the zoom layer so they are scaled together with the edges; other pages use #canvas directly.
function getDrawingLayer() {
  return getEl("zoomLayer") || getEl("canvas");
}

// Keeps the zoomed scroll area in sync with the drawing (only on pages that provide it)
function refreshZoomExtent() {
  if (typeof window.updateZoomExtent === "function") window.updateZoomExtent();
}

// --- View rotation by 90 degrees (only the view: the drawing, coordinates and labels are not changed) ---
// The drawing layer (#zoomLayer) is shown rotated 90 degrees clockwise so a predominantly vertical drawing can be
// viewed horizontally and vice versa. Vertex positions (offsetLeft / offsetTop), edges, overlap checks and the
// saved JPG stay exactly as they are; vertex labels are turned back upright (CSS rule #zoomLayer.rotated90 .node).
// The rotated drawing keeps the same margins as the original one, so it stays at the left of the window:
// the original top margin becomes the left margin and the original left margin becomes the top margin.
// The zoom code computes the unrotated extent; the rotation is applied on top of it every time it runs.
window.metroViewRotated = false;
window.metroDragActive = false;
let baseUpdateZoomExtent = null;
let metroRotationPivotY = null;        // drawing y that is placed at the left edge of the rotated view
let metroHeightBeforeRotation = null;  // window height to restore when rotating back

const METRO_ROTATION_MIN_HEIGHT = 200;
const METRO_ROTATION_SCROLLBAR_ROOM = 24;

function installRotationAwareZoom() {
  if (baseUpdateZoomExtent) return true;
  if (typeof window.updateZoomExtent !== "function") return false;
  baseUpdateZoomExtent = window.updateZoomExtent;
  window.updateZoomExtent = function () {
    baseUpdateZoomExtent();
    applyViewRotation();
  };
  return true;
}

// Bounding box of the drawn vertices and edge bends in drawing coordinates (null when nothing is drawn)
function getDrawingContentBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  Object.keys(nodes).forEach(name => {
    const el = nodes[name];
    if (!el || el.style.display === "none") return;
    minX = Math.min(minX, el.offsetLeft);
    minY = Math.min(minY, el.offsetTop);
    maxX = Math.max(maxX, el.offsetLeft + el.offsetWidth);
    maxY = Math.max(maxY, el.offsetTop + el.offsetHeight);
  });
  if (minX === Infinity) return null;
  if (window.edgeBends) {
    Object.keys(window.edgeBends).forEach(k => {
      const b = window.edgeBends[k];
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x);
      maxY = Math.max(maxY, b.y);
    });
  }
  return { minX: Math.max(0, minX), minY: Math.max(0, minY), maxX, maxY };
}

// Drawing y placed at the left edge of the rotated view: bottom of the drawing plus the original top margin,
// so the drawing ends up with the same margin on the left that it had at the top.
// Kept fixed while a vertex is being dragged, so the view does not shift under the cursor.
function computeRotationPivotY(layer) {
  if (window.metroDragActive && metroRotationPivotY !== null) return metroRotationPivotY;
  const bounds = getDrawingContentBounds();
  metroRotationPivotY = bounds ? bounds.maxY + bounds.minY : (parseFloat(layer.style.height) || 0);
  return metroRotationPivotY;
}

// Rotated mapping (drawing point (x, y) -> scroll-area point): (s * (P - y), s * x), with P = pivot y, s = zoom
function applyViewRotation() {
  const canvas = getEl("canvas");
  const sizer = getEl("zoomSizer");
  const layer = getEl("zoomLayer");
  const svg = getEl("edges");
  if (!canvas || !sizer || !layer) return;

  layer.classList.toggle("rotated90", !!window.metroViewRotated);
  if (!window.metroViewRotated) return;   // the zoom code has already set the unrotated view

  const s = window.metroZoomScale || 1;
  const pivot = computeRotationPivotY(layer);
  const bounds = getDrawingContentBounds();
  let w = parseFloat(layer.style.width) || 0;
  let h = parseFloat(layer.style.height) || 0;
  // Rotated, the drawing's width becomes the scroll height: size it to the drawing (same margin at the bottom
  // as at the top) and to the window, not to the unrotated window width, so there is no empty area to scroll into
  if (bounds) w = bounds.maxX + bounds.minX;
  w = Math.ceil(Math.max(w, canvas.clientHeight / s));
  h = Math.ceil(Math.max(h, pivot));

  layer.style.width = w + "px";
  layer.style.height = h + "px";
  if (svg) {
    svg.setAttribute("width", w);
    svg.setAttribute("height", h);
  }
  layer.style.transform = `translate(${pivot * s}px, 0px) scale(${s}) rotate(90deg)`;
  sizer.style.width = Math.ceil(Math.max(pivot * s, canvas.clientWidth)) + "px";
  sizer.style.height = Math.ceil(Math.max(w * s, canvas.clientHeight)) + "px";
}

// Window height that shows the whole rotated drawing (its original width, with the same margin at the bottom),
// limited to the browser window; it is never made smaller than the current height.
function rotatedWindowHeight(canvas) {
  const current = canvas.offsetHeight;
  const bounds = getDrawingContentBounds();
  if (!bounds) return current;
  const s = window.metroZoomScale || 1;
  const needed = Math.ceil((bounds.maxX + bounds.minX) * s) + METRO_ROTATION_SCROLLBAR_ROOM;
  const cap = Math.max(current, window.innerHeight - 40);
  return Math.max(METRO_ROTATION_MIN_HEIGHT, current, Math.min(needed, cap));
}

// Rotate button: toggles between the normal view and the view rotated by 90 degrees.
// The window height is adjusted to the rotated drawing (and restored when rotating back), and the view is
// scrolled to the top-left so the drawing sits at the left, like the initial drawing.
function toggleMetroRotation() {
  const canvas = getEl("canvas");
  const layer = getEl("zoomLayer");
  if (!canvas || !layer) return;
  if (!installRotationAwareZoom()) return;

  window.metroViewRotated = !window.metroViewRotated;
  metroRotationPivotY = null;

  if (window.metroViewRotated) {
    metroHeightBeforeRotation = canvas.offsetHeight;
    const newHeight = rotatedWindowHeight(canvas);
    if (newHeight !== canvas.offsetHeight) canvas.style.height = newHeight + "px";
  } else if (metroHeightBeforeRotation !== null) {
    canvas.style.height = metroHeightBeforeRotation + "px";
    metroHeightBeforeRotation = null;
  }

  window.updateZoomExtent();
  canvas.scrollLeft = 0;
  canvas.scrollTop = 0;

  const btn = getEl("rotateViewBtn");
  if (btn) {
    btn.textContent = window.metroViewRotated ? "⟲ Rotate Back" : "⟳ Rotate 90°";
    btn.title = window.metroViewRotated
      ? "Show the drawing in its original orientation"
      : "Rotate the view by 90° (the drawing itself is not changed)";
  }
}
window.toggleMetroRotation = toggleMetroRotation;

// Installed once all scripts have loaded (the zoom code is defined in family_metro_map.js)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installRotationAwareZoom);
} else {
  installRotationAwareZoom();
}

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
  const drawingLayer = getDrawingLayer();
  const startNodeInp = getEl("startNode");
  if (!drawingLayer) return;

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

  drawingLayer.appendChild(div);
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

function placeNodesGrid(names) {
  const drawingLayer = getDrawingLayer();
  if (!drawingLayer) return;

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

    drawingLayer.appendChild(div);
    nodes[name] = div;
    if (!graph[name]) graph[name] = [];
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

// Dragging works in drawing coordinates: the mouse movement is divided by the current zoom level
// (window.metroZoomScale, 1 on pages without zoom), so a vertex follows the cursor at any zoom.
// When the view is rotated by 90 degrees, the screen movement is turned back into drawing directions.
function makeDraggable(el) {
  el.onmousedown = e => {
    const scale = window.metroZoomScale || 1;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;
    const startLeft = el.offsetLeft;
    const startTop = el.offsetTop;
    window.metroDragActive = true;

    document.onmousemove = m => {
      const dx = (m.clientX - startMouseX) / scale;
      const dy = (m.clientY - startMouseY) / scale;
      const rotated = !!window.metroViewRotated;
      el.style.left = (startLeft + (rotated ? dy : dx)) + "px";
      el.style.top  = (startTop  + (rotated ? -dx : dy)) + "px";
      drawEdges();
      if (typeof updateCoords === "function") updateCoords();
      if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
      //if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
    };
    document.onmouseup = () => {
      document.onmousemove = null;
      document.onmouseup = null;
      window.metroDragActive = false;
      refreshZoomExtent();
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
  let out = "";
  for (let u in graph) out += `${u}:${graph[u].map(e => e.to).join(",")}\n`;
  downloadFile("graph_list.txt", out);
}

function exportMatrix() {
  // Natural label order (A..Z, A1..) so that re-importing the matrix gives every vertex its original name
  let keys = Object.keys(graph).sort(compareVertexLabels);
  let out = keys.map(u => keys.map(v => graph[u].some(e => e.to === v) ? 1 : 0).join(",")).join("\n");
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

  refreshZoomExtent();

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

  refreshZoomExtent();
}

function buildFromList() {
  const listInput = getEl("listInput");
  if (!listInput) return;

  clearGraph(false);

  let lines = listInput.value.trim().split("\n");
  let namesSet = new Set();

  lines.forEach(line => {
    let [node, neighbors] = line.split(":");
    if (!node || !node.trim()) return;
    namesSet.add(node.trim().toUpperCase());
  });
  // Vertices that only appear as neighbours (e.g. "A:B,C" without lines for B and C) are vertices too;
  // without this they were counted in the graph but never drawn.
  lines.forEach(line => {
    let [node, neighbors] = line.split(":");
    if (!node || !node.trim() || !neighbors) return;
    neighbors.split(",").forEach(n => {
      n = n.trim().toUpperCase();
      if (n) namesSet.add(n);
    });
  });

  let names = Array.from(namesSet);
  placeNodesGrid(names);

  lines.forEach(line => {
    let [node, neighbors] = line.split(":");
    if (!node || !node.trim()) return;
    node = node.trim().toUpperCase();

    if (!graph[node]) graph[node] = [];
    if (!neighbors) return;

    neighbors.split(",").forEach(n => {
      n = n.trim().toUpperCase();
      if (!n || n === node) return;          // ignore empty names and self-loops
      if (!graph[n]) graph[n] = [];
      if (!graph[node].some(e => e.to === n)) {
        graph[node].push({ to: n });
        graph[n].push({ to: node });
      }
    });
  });

  if (names.length <= MAX_RENDER_NODES) {
    drawEdges();
  }

  updateLists();
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function buildFromMatrix() {
  const matrixInput = getEl("matrixInput");
  if (!matrixInput) return;

  clearGraph(false);

  let rows = matrixInput.value.trim().split("\n").filter(r => r.trim().length > 0);
  let size = rows.length;

  if (size > MAX_MATRIX_SIZE) {
    alert("Matrix too large! Processing in lightweight mode.");
  }

  let labels = [];
  for (let i = 0; i < size; i++) {
    labels.push(getVertexLabel(i));
  }

  placeNodesGrid(labels);

  for (let i = 0; i < size; i++) {
    let cols = rows[i].split(",");
    let u = labels[i];
    if (!graph[u]) graph[u] = [];

    for (let j = i + 1; j < cols.length; j++) {
      if (cols[j].trim() === "1") {
        let v = labels[j];
        if (!graph[v]) graph[v] = [];
        graph[u].push({ to: v });
        graph[v].push({ to: u });
      }
    }
  }

  if (size <= MAX_RENDER_NODES) {
    drawEdges();
  }

  updateLists();
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function loadFileIntoBox(fileInput, targetBox) {
  if (!fileInput || !targetBox) return;
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    targetBox.value = e.target.result;
  };
  reader.readAsText(file);
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

  refreshZoomExtent();
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
      li.style.padding = "2px 0";
      li.innerHTML = `<strong>${v}</strong>: x=${x}, y=${y}`;
      listUl.appendChild(li);
    }
  });
}
