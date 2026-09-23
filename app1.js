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

  const name = nameOpt || String.fromCharCode(65 + nodeIndex++);
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
    graph[selected].push({ to: name });

    if (!graph[name]) graph[name] = [];
    graph[name].push({ to: selected });

    selected = null;
    drawEdges();
    updateLists();
  }
}

function placeNodesGrid(names) {
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

  Object.keys(graph).sort().forEach(v => {
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

  drawEdges();
  updateLists();
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
  if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
  if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
}

function makeDraggable(el) {
  let offsetX, offsetY;
  el.onmousedown = e => {
    offsetX = e.offsetX;
    offsetY = e.offsetY;
    document.onmousemove = m => {
      const canvasDiv = getEl("canvas");
      if (!canvasDiv) return;
      const rect = canvasDiv.getBoundingClientRect();
      el.style.left = (m.pageX - rect.left - offsetX) + "px";
      el.style.top  = (m.pageY - rect.top  - offsetY) + "px";
      drawEdges();
      if (typeof updateCoords === "function") updateCoords();
      if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
      if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
    };
    document.onmouseup = () => {
      document.onmousemove = null;
      if (typeof checkAndListOverlappingVertices === "function") checkAndListOverlappingVertices();
      if (typeof updateSummaryOfChangesSection === "function") updateSummaryOfChangesSection();
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
  let keys = Object.keys(graph).sort();
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

  clearGraph(false);

  let lines = listInput.value.trim().split("\n");
  let namesSet = new Set();

  lines.forEach(line => {
    let [node] = line.split(":");
    if (!node) return;
    namesSet.add(node.trim().toUpperCase());
  });

  let names = Array.from(namesSet);
  placeNodesGrid(names);

  lines.forEach(line => {
    let [node, neighbors] = line.split(":");
    if (!node) return;
    node = node.trim().toUpperCase();

    if (!graph[node]) graph[node] = [];
    if (!neighbors) return;

    neighbors.split(",").forEach(n => {
      n = n.trim().toUpperCase();
      if (!n) return;
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
    labels.push(String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : ""));
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