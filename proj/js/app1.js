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
const STEP = 70;

const modeSel      = document.getElementById("mode");
const visualMode   = document.getElementById("visualMode");
const listMode     = document.getElementById("listMode");
const matrixMode   = document.getElementById("matrixMode");
const listInput    = document.getElementById("listInput");
const matrixInput  = document.getElementById("matrixInput");
const startNodeInp = document.getElementById("startNode");
const statusP      = document.getElementById("status");
const canvasDiv    = document.getElementById("canvas");
const edgesSvg     = document.getElementById("edges");

const addNodeBtn       = document.getElementById("addNodeBtn");
const clearBtn         = document.getElementById("clearBtn");
const bfsBtn           = document.getElementById("bfsBtn");
const dfsBtn           = document.getElementById("dfsBtn");
const nextBtn          = document.getElementById("nextBtn");
const runAllBtn        = document.getElementById("runAllBtn");
const undoBtn          = document.getElementById("undoBtn");
const exportListBtn    = document.getElementById("exportListBtn");
const exportMatrixBtn  = document.getElementById("exportMatrixBtn");
const removeVertexBtn  = document.getElementById("removeVertexBtn");
const removeEdgeBtn    = document.getElementById("removeEdgeBtn");

const vertexList = document.getElementById("vertexList");
const edgeList = document.getElementById("edgeList");

const importListFile   = document.getElementById("importListFile");
const importListBtn    = document.getElementById("importListBtn");
const importMatrixFile = document.getElementById("importMatrixFile");
const importMatrixBtn  = document.getElementById("importMatrixBtn");

const showListGraphBtn = document.getElementById("showListGraphBtn");
const showMatrixGraphBtn = document.getElementById("showMatrixGraphBtn");

addNodeBtn.onclick      = () => addNode();
clearBtn.onclick        = () => clearGraph(true);
bfsBtn.onclick          = () => startAlgo("BFS");
dfsBtn.onclick          = () => startAlgo("DFS");
nextBtn.onclick         = () => stepForward();
runAllBtn.onclick       = () => runToEnd();
undoBtn.onclick         = () => stepBack();
exportListBtn.onclick   = () => exportList();
exportMatrixBtn.onclick = () => exportMatrix();
removeVertexBtn.onclick = () => removeVertex();
removeEdgeBtn.onclick   = () => removeEdge();
showListGraphBtn.onclick = () => buildFromList();
showMatrixGraphBtn.onclick = () => buildFromMatrix();
importListBtn.onclick = () => loadFileIntoBox(importListFile, listInput);
importMatrixBtn.onclick = () => loadFileIntoBox(importMatrixFile, matrixInput);

function switchMode() {
  visualMode.style.display = "none";
  listMode.style.display = "none";
  matrixMode.style.display = "none";

  const m = modeSel.value;
  if (m === "visual") visualMode.style.display = "block";
  else if (m === "list") listMode.style.display = "block";
  else if (m === "matrix") matrixMode.style.display = "block";
}

function addNode(nameOpt) {
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
  if (!startNodeInp.value) startNodeInp.value = name;
  updateLists();
  updateCanvasSize(gridX, gridY);
}

function selectNode(name) {
  if (modeSel.value !== "visual") return;
  Object.values(nodes).forEach(n => n.classList.remove("selected-node"));

  if (!selected) {
    selected = name;
    if (nodes[name]) nodes[name].classList.add("selected-node");
  } else {
    if (selected === name) {
      selected = null;
      return;
    }

    let weight = prompt("Edge weight?", "1");
    if (weight === null) {
      selected = null;
      return;
    }

    if (!graph[selected]) graph[selected] = [];
    graph[selected].push({ to: name, w: weight });

    if (!graph[name]) graph[name] = [];
    graph[name].push({ to: selected, w: weight });

    selected = null;
    drawEdges();
    updateLists();
  }
}

function placeNodesGrid(names) {

  if (names.length > MAX_RENDER_NODES) {
    alert("Graph too large for visual rendering. Loaded in data mode only.");
    return;
  }

  const cols = Math.min(names.length, 10);  
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
}

/*function drawEdges() {
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

  let seenEdges = new Set();

  for (let u in graph) {
    (graph[u] || []).forEach(e => {
      let v = e.to;
      let edgeKey = [u, v].sort().join("-");
      if (seenEdges.has(edgeKey)) return;
      seenEdges.add(edgeKey);

      if (!nodes[u] || !nodes[v]) return;

      let x1 = nodes[u].offsetLeft + 22;
      let y1 = nodes[u].offsetTop + 22;
      let x2 = nodes[v].offsetLeft + 22;
      let y2 = nodes[v].offsetTop + 22;

      let midX = (x1 + x2) / 2;
      let midY = (y1 + y2) / 2;

      let curviness = 30; 
      let dx = x2 - x1;
      let dy = y2 - y1;
      let len = Math.sqrt(dx * dx + dy * dy);

      let qx = midX + (curviness * -dy) / len;
      let qy = midY + (curviness * dx) / len;

      let path = document.createElementNS("http://www.w3.org/2000/svg","line");
      let d = `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`;
      path.setAttribute("d", d);
      path.setAttribute("stroke", "black");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "transparent");
      edgesSvg.appendChild(path);

      let text = document.createElementNS("http://www.w3.org/2000/svg","line");
      text.setAttribute("x", qx);
      text.setAttribute("y", qy);
      text.textContent = e.w;
      text.setAttribute("class", "edge-label");
      text.setAttribute("text-anchor", "middle");
      edgesSvg.appendChild(text);
    });
  }
}*/

function drawEdges() {
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

  edgesSvg.innerHTML = `
    <defs>
      <marker id="arrowhead" markerWidth="10" markerHeight="7" 
              refX="19" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="black"></polygon>
      </marker>
    </defs>`;

  const SVG_NS = "http://www.w3.org/2000/svg"; 
  let seenEdges = new Set();

  for (let u in graph) {
    (graph[u] || []).forEach(e => {
      let v = e.to;
      let edgeKey = [u, v].sort().join("-");
      if (seenEdges.has(edgeKey)) return;
      seenEdges.add(edgeKey);

      if (!nodes[u] || !nodes[v]) return;

      let x1 = nodes[u].offsetLeft + 22;
      let y1 = nodes[u].offsetTop + 22;
      let x2 = nodes[v].offsetLeft + 22;
      let y2 = nodes[v].offsetTop + 22;

      let midX = (x1 + x2) / 2;
      let midY = (y1 + y2) / 2;
      let curviness = 20; 
      let dx = x2 - x1;
      let dy = y2 - y1;
      let len = Math.sqrt(dx * dx + dy * dy) || 1;

      let qx = midX + (curviness * -dy) / len;
      let qy = midY + (curviness * dx) / len;

      let path = document.createElementNS(SVG_NS, "path");
      let d = `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`;
      path.setAttribute("d", d);
      path.setAttribute("stroke", "#555");
      path.setAttribute("stroke-width", "2");
      path.setAttribute("fill", "transparent");
      edgesSvg.appendChild(path);
      if (e.w !== undefined) {
        let text = document.createElementNS(SVG_NS, "text");
        text.setAttribute("x", qx);
        text.setAttribute("y", qy - 5); 
        text.textContent = e.w;
        text.setAttribute("class", "edge-label");
        text.setAttribute("text-anchor", "middle");
        text.style.fontSize = "12px";
        text.style.fill = "#333";
        edgesSvg.appendChild(text);
      }
    });
  }
}

function updateLists() {
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

  if (startNodeInp.value === v) {
    startNodeInp.value = Object.keys(graph)[0] || "";
  }

  drawEdges();
  updateLists();
}

function removeEdge() {
  const val = edgeList.value;
  if (!val) return;

  const [u, v] = val.split(",");
  if (graph[u]) graph[u] = graph[u].filter(e => e.to !== v);
  if (graph[v]) graph[v] = graph[v].filter(e => e.to !== u);

  drawEdges();
  updateLists();
}

function makeDraggable(el) {
  let offsetX, offsetY;
  el.onmousedown = e => {
    offsetX = e.offsetX;
    offsetY = e.offsetY;
    document.onmousemove = m => {
      const rect = canvasDiv.getBoundingClientRect();
      el.style.left = (m.pageX - rect.left - offsetX) + "px";
      el.style.top  = (m.pageY - rect.top  - offsetY) + "px";
      drawEdges();
    };
    document.onmouseup = () => {
      document.onmousemove = null;
    };
  };
}

function startAlgo(type) {
  if (!startNodeInp.value) return alert("Enter start node");
  const s = startNodeInp.value.trim().toUpperCase();
  if (!graph[s]) return alert("Node not found");
  
  // RESET ALL DATA
  history = [];
  visited.clear();
  timeData = {}; 
  timer = 0;
  algorithm = type;
  current = null;

  // Initial Action: Discover the start node
  structure = [{ name: s, type: 'discover' }];
  
  snapshot();
  update();
}

/*function stepForward() {
  if (!structure.length) {
    const remaining = Object.keys(graph).sort().find(v => !visited.has(v));
    if (!remaining) return; 
    structure.push(remaining);
  }

  snapshot();
  
  
  current = (algorithm === "BFS") ? structure.shift() : structure.pop();

  if (!visited.has(current)) {
    visited.add(current);
    
    
    timer++;
    if (!timeData[current]) timeData[current] = {};
    timeData[current].d = timer;

    let neighbors = (graph[current] || [])
      .map(e => e.to)
      .filter(v => !visited.has(v))
      .sort();

    if (algorithm === "DFS") neighbors.reverse();

    neighbors.forEach(v => {
      if (!structure.includes(v)) {
        structure.push(v);
      }
    });
    
    
    
    timer++;
    timeData[current].f = timer;
  }
  
  update();
  checkFinished();
}*/

/*function checkFinished() {
  const remaining = Object.keys(graph).some(v => !visited.has(v));

  if (!remaining && structure.length === 0) {
    Object.values(nodes).forEach(n => n.classList.remove("current"));
    Object.keys(nodes).forEach(v => {
      nodes[v]?.classList.add("visited");
    });

    statusP.innerText =
      `${algorithm} Complete. Full Traversal: [${Array.from(visited).join(" -> ")}]`;
  }
}*/

function stepForward() {
  if (!structure.length) {
    // Check for undiscovered components
    const remaining = Object.keys(graph).sort().find(v => !visited.has(v));
    if (!remaining) return; 
    structure.push({ name: remaining, type: 'discover' });
  }

  snapshot();

  // Pick the next action (BFS uses queue, DFS uses stack)
  let task = (algorithm === "BFS") ? structure.shift() : structure.pop();
  const { name, type } = task;

  if (type === 'discover') {
    if (visited.has(name)) {
      // If we already visited it via another path, skip this timer increment and move to next
      stepForward(); 
      return;
    }

    // ACTION: Discover Node
    timer++;
    timeData[name] = { d: timer };
    visited.add(name);
    current = name;

    // After discovering, the next logical step for this node is to "Finish" it
    // In BFS, we finish it immediately after discovery to look for neighbors
    // In DFS, we finish it only after its neighbors are done
    if (algorithm === "BFS") {
      structure.push({ name: name, type: 'finish' });
    } else {
      structure.push({ name: name, type: 'finish' });
      
      // Get neighbors for DFS (Reverse sort for alphabetical stack behavior)
      let neighbors = (graph[name] || [])
        .map(e => e.to)
        .filter(v => !visited.has(v))
        .sort().reverse();

      neighbors.forEach(v => {
        structure.push({ name: v, type: 'discover' });
      });
    }
  } 
  else if (type === 'finish') {
    // ACTION: Finish Node
    timer++;
    timeData[name].f = timer;
    current = name;

    // For BFS, finding neighbors happens ONE BY ONE after the node is "finished"
    if (algorithm === "BFS") {
      let neighbors = (graph[name] || [])
        .map(e => e.to)
        .filter(v => !visited.has(v) && !structure.some(s => s.name === v))
        .sort();

      neighbors.forEach(v => {
        structure.push({ name: v, type: 'discover' });
      });
    }
  }

  update();
}

function checkFinished() {
  const allVisited = Object.keys(graph).every(v => visited.has(v));
  const stackEmpty = structure.length === 0;

  if (allVisited && stackEmpty) {
    Object.values(nodes).forEach(n => n.classList.remove("current"));
    
    // Construct the traversal string from the visited Set
    const traversalOrder = Array.from(visited).join(" -> ");
    statusP.innerText = `${algorithm} Complete. Full Traversal: [${traversalOrder}]`;
    
    update(); // Final render to ensure all finish times are visible
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

/*function update() {
  Object.values(nodes).forEach(n => {
    n.classList.remove("visited", "current");
    const existingStamp = n.querySelector(".timestamp");
    if (existingStamp) existingStamp.remove();

    const nodeName = n.textContent;
    if (timeData[nodeName]) {
      const d = timeData[nodeName].d ?? "-";
      const f = timeData[nodeName].f ?? "-";
      let span = document.createElement("span");
      span.className = "timestamp";
      span.textContent = `${d}/${f}`;
      span.style.cssText = `
        position: absolute; top: -25px; left: 50%;
        transform: translateX(-50%); font-size: 13px;
        font-weight: bold; color: #ff5722; white-space: nowrap;
        pointer-events: none; text-shadow: 1px 1px 0px #fff;
      `;
      n.appendChild(span);
    }
  });

  visited.forEach(v => nodes[v]?.classList.add("visited"));
  if (nodes[current]) nodes[current].classList.add("current");

  
  
  const totalNodes = Object.keys(graph).length;
  const isFinished = (traversalOrder.length === totalNodes && totalNodes > 0);

  if (isFinished) {
    statusP.innerText = `${algorithm} Complete. Full Traversal: [${traversalOrder.join(" -> ")}]`;
  } else {
    statusP.innerText = `${algorithm || "Idle"} | Structure: [${structure.join(", ")}]`;
  }
}*/

function update() {
  // 1. Reset visual states and update timestamps
  Object.values(nodes).forEach(n => {
    n.classList.remove("visited", "current");
    
    // Clean up old timestamp spans to prevent stacking
    const existingStamp = n.querySelector(".timestamp");
    if (existingStamp) existingStamp.remove();

    const nodeName = n.textContent;
    if (timeData[nodeName]) {
      const { d, f } = timeData[nodeName];
      let span = document.createElement("span");
      span.className = "timestamp";
      
      // Display as (Discovery / Finish)
      // Uses '?' if the value hasn't been assigned yet
      span.textContent = `${d || '?'}/${f || '?'}`;
      
      // Styling to position the timer above the node
      span.style.cssText = `
        position: absolute;
        top: -25px;
        left: 50%;
        transform: translateX(-50%);
        font-size: 12px;
        font-weight: bold;
        color: #ff5722;
        white-space: nowrap;
      `;
      n.appendChild(span);
    }
  });

  // 2. Highlight visited and currently active nodes
  visited.forEach(v => nodes[v]?.classList.add("visited"));
  if (nodes[current]) nodes[current].classList.add("current");

  // 3. Handle Status Text and Traversal Display
  const allVisited = Object.keys(graph).every(v => visited.has(v));
  const stackEmpty = structure.length === 0;

  if (allVisited && stackEmpty && algorithm !== "") {
    // If the algorithm is finished, show the full path
    const traversalOrder = Array.from(visited).join(" -> ");
    statusP.innerText = `${algorithm} Complete. Full Traversal: [${traversalOrder}]`;
  } else {
    // If still running, show the current contents of the Stack/Queue
    // FIX: Map objects to names to prevent "[object Object]" display
    const structureDisplay = structure.map(item => 
      typeof item === 'string' ? item : item.name
    );
    statusP.innerText = `${algorithm} | Structure: [${structureDisplay.join(", ")}]`;
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

/*function clearGraph() {
  graph = {};
  canvasDiv.querySelectorAll(".node").forEach(n => n.remove());
  nodes = {};
  nodeIndex = 0;
  gridX = 20; gridY = 20;
  edgesSvg.innerHTML = "";
  statusP.textContent = "";
  updateLists();
}*/

function clearGraph(clearInputs=true) {

  graph = {};
  nodes = {};
  edges = [];

  visited.clear();
  structure = [];
  history = [];
  algorithm = "";
  current = null;
  selected = null;

  nodeIndex = 0;
  gridX = 20;
  gridY = 20;

  canvasDiv.querySelectorAll(".node").forEach(n => n.remove());

  edgesSvg.innerHTML = "";

  vertexList.innerHTML = "";
  edgeList.innerHTML = "";
  statusP.textContent = "";
  startNodeInp.value = "";

 if (clearInputs) {
  listInput.value = "";
  matrixInput.value = "";
  fileInput.value="";
  importListFile.value = "";
  importMatrixFile.value = "";
  importListFile.name="";
  importMatrixFile.name="";
 }
}

function buildFromList() {
  
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

      if (!graph[n]) graph[n] = [];

      
      if (!graph[node].some(e => e.to === n)) {
        graph[node].push({to:n,w:1});
        graph[n].push({to:node,w:1});
      }

    });

  });

  if (names.length <= MAX_RENDER_NODES) {
    drawEdges();
  }

  updateLists();
}

function buildFromMatrix() {

  clearGraph(false);

  let rows = matrixInput.value.trim().split("\n");
  let size = rows.length;

  if (size > MAX_MATRIX_SIZE) {
    alert("Matrix too large! Processing in lightweight mode.");
  }

  let labels = [];
  for (let i = 0; i < size; i++) {
    labels.push(String.fromCharCode(65 + (i % 26)) + Math.floor(i / 26));
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

        graph[u].push({ to: v, w: 1 });
        graph[v].push({ to: u, w: 1 });

      }
    }
  }

  if (size <= MAX_RENDER_NODES) {
    drawEdges();
  }

  updateLists();
  
}

function loadFileIntoBox(fileInput, targetBox) {
  const file = fileInput.files[0];
  if (!file) return alert("Select a file first");

  const reader = new FileReader();

  reader.onload = function(e) {
    const text = e.target.result;

    setTimeout(() => {
      targetBox.value = text;
    }, 0);
  };

  reader.readAsText(file);
}

function updateCanvasSize(x, y) {

  const padding = 100;

  let newWidth = Math.max(800, x + padding);
  let newHeight = Math.max(450, y + padding);

  if (newWidth !== canvasWidth || newHeight !== canvasHeight) {
    canvasWidth = newWidth;
    canvasHeight = newHeight;

    edgesSvg.setAttribute("width", canvasWidth);
    edgesSvg.setAttribute("height", canvasHeight);
  }
}
