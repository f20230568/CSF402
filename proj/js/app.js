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

let gridX = 20, gridY = 20;
const STEP = 70;

// DOM Elements
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

// Event Listeners
addNodeBtn.onclick      = () => addNode();
clearBtn.onclick        = () => clearGraph();
bfsBtn.onclick          = () => startAlgo("BFS");
dfsBtn.onclick          = () => startAlgo("DFS");
nextBtn.onclick         = () => stepForward();
runAllBtn.onclick       = () => runToEnd();
undoBtn.onclick         = () => stepBack();
exportListBtn.onclick   = () => exportList();
exportMatrixBtn.onclick = () => exportMatrix();
removeVertexBtn.onclick = () => removeVertex();
removeEdgeBtn.onclick   = () => removeEdge();

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
}

function selectNode(name) {
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

function drawEdges() {
  edgesSvg.innerHTML = "";
  let seenEdges = new Set();

  for (let u in graph) {
    (graph[u] || []).forEach(e => {
      let v = e.to;
      let edgeKey = [u, v].sort().join("-");
      if (seenEdges.has(edgeKey)) return;
      seenEdges.add(edgeKey);

      if (!nodes[u] || !nodes[v]) return;

      let r1 = nodes[u].getBoundingClientRect();
      let r2 = nodes[v].getBoundingClientRect();
      let c  = canvasDiv.getBoundingClientRect();

      let x1 = r1.left - c.left + 22;
      let y1 = r1.top  - c.top  + 22;
      let x2 = r2.left - c.left + 22;
      let y2 = r2.top  - c.top  + 22;

      let line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1", x1);
      line.setAttribute("y1", y1);
      line.setAttribute("x2", x2);
      line.setAttribute("y2", y2);
      line.setAttribute("stroke", "black");
      line.setAttribute("stroke-width", "2");
      edgesSvg.appendChild(line);

      let text = document.createElementNS("http://www.w3.org/2000/svg","text");
      text.setAttribute("x", (x1 + x2) / 2);
      text.setAttribute("y", (y1 + y2) / 2);
      text.textContent = e.w;
      text.setAttribute("class", "edge-label");
      edgesSvg.appendChild(text);
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
  
  history = [];
  visited.clear();
  structure = [s];
  current = null;
  algorithm = type;
  snapshot();
  update();
}

function stepForward() {
  // If structure is empty but graph isn't fully explored, pick the next alphabetical node
  if (!structure.length) {
    const remaining = Object.keys(graph).sort().find(v => !visited.has(v));
    if (!remaining) return; 
    structure.push(remaining);
  }

  snapshot();
  current = (algorithm === "BFS") ? structure.shift() : structure.pop();

  if (!visited.has(current)) {
    visited.add(current);
    
    // Get neighbors and sort them alphabetically
    let neighbors = (graph[current] || [])
      .map(e => e.to)
      .filter(v => !visited.has(v))
      .sort();

    // DFS needs to push neighbors in reverse alphabetical order so they are popped in correct order
    if (algorithm === "DFS") neighbors.reverse();

    neighbors.forEach(v => {
      if (!structure.includes(v)) {
        structure.push(v);
      }
    });
  }
  update();
  checkFinished();
}

function runToEnd() {
  if (!algorithm) return alert("Select BFS or DFS first");
  while (visited.size < Object.keys(graph).length || structure.length > 0) {
    stepForward();
    // Break loop if no progress can be made
    if (!structure.length && !Object.keys(graph).some(v => !visited.has(v))) break;
  }
}

function stepBack() {
  if (!history.length) return;
  let s = history.pop();
  visited = new Set(s.visited);
  structure = [...s.structure];
  current = s.current;
  update();
}

function snapshot() {
  history.push({ 
    visited: Array.from(visited), 
    structure: [...structure], 
    current 
  });
}

function update() {
  Object.values(nodes).forEach(n => n.classList.remove("visited","current"));
  visited.forEach(v => nodes[v]?.classList.add("visited"));
  if (nodes[current]) nodes[current].classList.add("current");
  statusP.innerText = `${algorithm} | Structure: [${structure.join(", ")}]`;
}

function checkFinished() {
  const remaining = Object.keys(graph).some(v => !visited.has(v));
  if (!remaining && structure.length === 0) {
    statusP.innerText = `${algorithm} Complete. Full Traversal: [${Array.from(visited).join(" -> ")}]`;
  }
}

function exportList() {
  let out = "";
  for (let u in graph) out += `${u}:${graph[u].map(e => e.to).join(",")}\n`;
  alert(out);
}

function exportMatrix() {
  let keys = Object.keys(graph).sort();
  let out = keys.map(u => keys.map(v => graph[u].some(e => e.to === v) ? 1 : 0).join(",")).join("\n");
  alert(out);
}

function clearGraph() {
  graph = {};
  canvasDiv.querySelectorAll(".node").forEach(n => n.remove());
  nodes = {};
  nodeIndex = 0;
  gridX = 20; gridY = 20;
  edgesSvg.innerHTML = "";
  statusP.textContent = "";
  updateLists();
}