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
const resetBtn         = document.getElementById("resetBtn");
const removeVertexBtn = document.getElementById("removeVertexBtn");
const removeEdgeBtn = document.getElementById("removeEdgeBtn");

const vertexList = document.getElementById("vertexList");
const edgeList = document.getElementById("edgeList");

addNodeBtn.onclick      = () => addNode();
clearBtn.onclick        = () => clearGraph();
bfsBtn.onclick          = () => startAlgo("BFS");
dfsBtn.onclick          = () => startAlgo("DFS");
nextBtn.onclick         = () => stepForward();
runAllBtn.onclick       = () => runToEnd();
undoBtn.onclick         = () => stepBack();
exportListBtn.onclick   = () => exportList();
exportMatrixBtn.onclick = () => exportMatrix();
resetBtn.onclick        = () => fullReset();
removeVertexBtn.onclick = () => removeVertex();
removeEdgeBtn.onclick = () => removeEdge();

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

// Clear previous selection highlight
function clearSelectionHighlight() {
  Object.values(nodes).forEach(n => n.classList.remove("selected-node"));
}

// select two nodes to create edge
function selectNode(name) {

  clearSelectionHighlight();

  if (!selected) {
    selected = name;
    if (nodes[name]) nodes[name].classList.add("selected-node");
  } else {

    if (selected === name) {
      selected = null;
      clearSelectionHighlight();
      return;
    }

    let weight = prompt("Edge weight?", "1");

    if (weight === null) {
      selected = null;
      clearSelectionHighlight();
      return;
    }

    if (!graph[selected]) graph[selected] = [];

    graph[selected].push({ to: name, w: weight });

  if (!graph[name]) graph[name] = [];
  graph[name].push({ to: selected, w: weight });

    selected = null;
    clearSelectionHighlight();

    drawEdges();
  }
  updateLists();
}

function drawEdges() {

  edgesSvg.innerHTML = "";

  for (let u in graph) {

    (graph[u] || []).forEach(e => {

      let v = e.to;

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

function parseList() {

  graph = {};

  listInput.value.trim().split("\n").forEach(l => {

    if (!l.trim()) return;

    let [v, rest] = l.split(":");

    v = v.trim();

    graph[v] = [];

    if (rest) {

      rest.split(",").forEach(n => {

        n = n.trim();

        if (n) graph[v].push({ to: n, w: 1 });

      });

    }

  });

  rebuildNodesFromGraph();

}

function parseMatrix() {

  graph = {};

  const raw = matrixInput.value.trim();

  if (!raw) return;

  let rows = raw.split("\n").map(r => r.split(",").map(x => x.trim()));

  for (let i = 0; i < rows.length; i++) {

    let u = String.fromCharCode(65 + i);

    graph[u] = [];

    for (let j = 0; j < rows[i].length; j++) {

      if (rows[i][j] === "1") {

        graph[u].push({ to: String.fromCharCode(65 + j), w: 1 });

      }

    }

  }

  rebuildNodesFromGraph();

}

listInput.addEventListener("change", parseList);
matrixInput.addEventListener("change", parseMatrix);

listInput.addEventListener("blur", parseList);
matrixInput.addEventListener("blur", parseMatrix);

function updateLists() {

  vertexList.innerHTML = "";
  edgeList.innerHTML = "";

  Object.keys(graph).forEach(v => {

    let opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;

    vertexList.appendChild(opt);

  });

  for (let u in graph) {

    (graph[u] || []).forEach(e => {

      if (u < e.to) {

        let opt = document.createElement("option");
        opt.value = `${u},${e.to}`;
        opt.textContent = `${u} - ${e.to}`;

        edgeList.appendChild(opt);

      }

    });

  }

}

function removeVertex() {

  const v = vertexList.value;

  if (!v) return;

  delete graph[v];

  Object.keys(graph).forEach(u => {
    graph[u] = graph[u].filter(e => e.to !== v);
  });

  if (nodes[v]) {
    nodes[v].remove();
    delete nodes[v];
  }

  drawEdges();
  updateLists();

}


function rebuildNodesFromGraph() {

  Object.values(nodes).forEach(n => n.remove());

  nodes = {};
  nodeIndex = 0;

  gridX = 20;
  gridY = 20;

  Object.keys(graph).forEach(v => {
    addNode(v);
  });

  drawEdges();

}

function startAlgo(type) {

  if (!startNodeInp.value) {
    alert("Enter a start node (e.g., A).");
    return;
  }

  const s = startNodeInp.value.trim();

  if (!graph[s]) {
    alert("Start node not found in graph.");
    return;
  }

  history = [];
  visited.clear();
  structure = [];

  current = null;

  algorithm = type;

  structure.push(s);

  snapshot();

  update();

}

function stepForward() {

  if (!structure.length) {

    const next = Object.keys(graph).find(v => !visited.has(v));

    if (!next) return;   

    structure.push(next);  
  }

  snapshot();

  current = (algorithm === "BFS")
    ? structure.shift()
    : structure.pop();

  if (!visited.has(current)) {

    visited.add(current);

    (graph[current] || [])
  .slice()
  .sort((a, b) => a.to.localeCompare(b.to))
  .forEach(e => {
    if (!visited.has(e.to) && !structure.includes(e.to)) {
      structure.push(e.to);
    }
  });

  }

  update();
  checkFinished();
}

function runToEnd() {

  if (!algorithm) {
    alert("Start BFS or DFS first.");
    return;
  }

  while (true) {

    if (structure.length === 0) {

      const next = Object.keys(graph).find(v => !visited.has(v));

      if (!next) break;  

      structure.push(next);  
    }

    current = (algorithm === "BFS") ? structure.shift() : structure.pop();

    if (!visited.has(current)) {

      visited.add(current);

      (graph[current] || [])
  .slice()
  .sort((a, b) => a.to.localeCompare(b.to))
  .forEach(e => {
    if (!visited.has(e.to) && !structure.includes(e.to)) {
      structure.push(e.to);
    }
  });

    }

  }

  update();
  checkFinished();
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
    visited: [...visited],
    structure: [...structure],
    current
  });

}

function update() {

  Object.values(nodes).forEach(n =>
    n.classList.remove("visited","current")
  );

  visited.forEach(v =>
    nodes[v]?.classList.add("visited")
  );

  if (nodes[current]) nodes[current].classList.add("current");

  statusP.innerText =
    `${algorithm} | Structure: [${structure.join(", ")}]`;

}

function checkFinished() {

  if (!algorithm) return;

  const remaining = Object.keys(graph).some(v => !visited.has(v));

  if (!remaining && structure.length === 0) {

    const order = Array.from(visited).join(" -> ");

    statusP.innerText =
      `${algorithm} finished. Order: [${order}]`;

  }

}

function exportList() {

  let out = "";

  for (let u in graph) {

    out += `${u}:${(graph[u] || []).map(e => e.to).join(",")}\n`;

  }

  alert(out);

}

function exportMatrix() {

  let keys = Object.keys(graph);

  let out = "";

  keys.forEach(u => {

    out += keys
      .map(v =>
        (graph[u] || []).some(e => e.to === v) ? 1 : 0
      )
      .join(",") + "\n";

  });

  alert(out);

}

function clearGraph() {

  graph = {};

  nodes = {};

  nodeIndex = 0;

  gridX = 20;
  gridY = 20;

  edgesSvg.innerHTML = "";

  canvasDiv
    .querySelectorAll(".node")
    .forEach(n => n.remove());

  statusP.textContent = "";

  visited.clear();

  structure = [];

  current = null;

  history = [];

  selected = null;

  clearSelectionHighlight();
  updateLists();
}

function fullReset() {

  clearGraph();

  listInput.value = "";
  matrixInput.value = "";

  startNodeInp.value = "";

  algorithm = "";

  modeSel.value = "visual";

  switchMode();

}

function removeEdge() {

  const val = edgeList.value;

  if (!val) return;

  const [u, v] = val.split(",");

  graph[u] = graph[u].filter(e => e.to !== v);
  graph[v] = graph[v].filter(e => e.to !== u);

  drawEdges();
  updateLists();

}