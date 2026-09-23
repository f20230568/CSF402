window.edgeBends = {};

// Step-by-step BFS Metro Traversal State
window.stepBfsState = {
  active: false,
  root: null,
  stepIndex: 0,
  order: [],
  fullLayers: [],
  currentDrawnLayers: [],
  coords: {},
  bends: {},
  offsets: { x: 0, y: 0 }
};

// Helper to safely get DOM elements
function getDomEl(id) {
  return document.getElementById(id);
}

// --- 1. Tree Verification ---
function verifyGraphIsTree() {
  const nodeKeys = Object.keys(graph);
  const V = nodeKeys.length;
  if (V === 0) return { isTree: false, reason: "Graph is empty. Please add or import nodes first." };
  if (V === 1) return { isTree: true };

  // Calculate total edges (undirected edges stored symmetrically)
  let totalDegree = 0;
  for (let u in graph) {
    totalDegree += (graph[u] || []).length;
  }
  const E = totalDegree / 2;

  // Condition 1: |E| must equal |V| - 1
  if (E !== V - 1) {
    return {
      isTree: false,
      reason: `Graph has ${V} vertices and ${E} edges. A tree must have exactly |V| - 1 edges (cycles or disconnected parts detected).`
    };
  }

  // Condition 2: Graph must be connected
  const visitedSet = new Set();
  const queue = [nodeKeys[0]];
  visitedSet.add(nodeKeys[0]);

  while (queue.length > 0) {
    const curr = queue.shift();
    (graph[curr] || []).forEach(edge => {
      if (!visitedSet.has(edge.to)) {
        visitedSet.add(edge.to);
        queue.push(edge.to);
      }
    });
  }

  if (visitedSet.size !== V) {
    return {
      isTree: false,
      reason: "Graph is disconnected (contains multiple disjoint trees/forest)."
    };
  }

  return { isTree: true };
}

// --- 2. Geometric & Orientation Helpers ---
function getBaseAngle(k) {
  return (k * Math.PI) / 4;
}

function getNodeGender(name) {
  if (nodes[name] && nodes[name].dataset && nodes[name].dataset.gender) {
    return nodes[name].dataset.gender.toUpperCase();
  }
  // Alternating heuristic based on char code
  return name.charCodeAt(0) % 2 === 0 ? "F" : "M";
}

function segmentsIntersect(p1, p2, p3, p4) {
  function ccw(A, B, C) {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  }
  const eps = 1e-4;
  if ((Math.hypot(p1.x - p3.x, p1.y - p3.y) < eps) ||
      (Math.hypot(p1.x - p4.x, p1.y - p4.y) < eps) ||
      (Math.hypot(p2.x - p3.x, p2.y - p3.y) < eps) ||
      (Math.hypot(p2.x - p4.x, p2.y - p4.y) < eps)) {
    return false;
  }
  return (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
}

// Compute BFS layer by layer (array of arrays)
function computeBFSLayers(rootName) {
  if (!graph[rootName]) return [];
  const layers = [];
  const visited = new Set([rootName]);
  let currentLayer = [rootName];

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    const nextLayer = [];
    currentLayer.forEach(u => {
      (graph[u] || []).forEach(edge => {
        const v = edge.to;
        if (!visited.has(v)) {
          visited.add(v);
          nextLayer.push(v);
        }
      });
    });
    currentLayer = nextLayer;
  }
  return layers;
}

function formatBFSLayersColoredHTML(layerArrays) {
  if (!layerArrays || layerArrays.length === 0) return "[]";
  
  const formattedLayers = layerArrays.map(layer => {
    const nodeSpans = layer.map(name => {
      const isMale = getNodeGender(name) === "M";
      const bg = isMale ? "#3498db" : "#e91e63";
      return `<span style="display:inline-block; background:${bg}; color:white; padding:1px 6px; border-radius:3px; margin:1px 2px; font-weight:bold;">${name}</span>`;
    }).join(", ");
    return `[${nodeSpans}]`;
  }).join(", ");

  return `[${formattedLayers}]`;
}

// Global overlap checker function
function checkAndListOverlappingVertices(threshold = 16) {
  const overlapList = getDomEl("overlapList");
  if (!overlapList) return;

  overlapList.innerHTML = "";
  // Check only nodes that are currently active and displayed on canvas
  const nodeKeys = Object.keys(nodes).filter(k => nodes[k] && nodes[k].style.display !== "none");
  const detectedPairs = [];

  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      const u = nodeKeys[i];
      const v = nodeKeys[j];
      if (!nodes[u] || !nodes[v]) continue;

      const x1 = nodes[u].offsetLeft;
      const y1 = nodes[u].offsetTop;
      const x2 = nodes[v].offsetLeft;
      const y2 = nodes[v].offsetTop;

      const dist = Math.hypot(x1 - x2, y1 - y2);

      // Considers nodes overlapping if center distance is within node diameter (16px)
      if (dist < threshold) {
        detectedPairs.push({
          u: u,
          v: v,
          dist: Math.round(dist),
          pos: `(${Math.round(x1)}, ${Math.round(y1)})`
        });
      }
    }
  }

  if (detectedPairs.length === 0) {
    const li = document.createElement("li");
    li.style.color = "#27ae60";
    li.style.fontWeight = "bold";
    li.textContent = "None (No overlapping vertices detected)";
    overlapList.appendChild(li);
  } else {
    detectedPairs.forEach(pair => {
      const li = document.createElement("li");
      li.style.padding = "3px 0";
      li.innerHTML = `<strong style="color: #c0392b;">${pair.u}</strong> overlaps with <strong style="color: #c0392b;">${pair.v}</strong> at approx ${pair.pos} (distance: ${pair.dist}px)`;
      overlapList.appendChild(li);
    });
  }
}
window.checkAndListOverlappingVertices = checkAndListOverlappingVertices;

// --- 3. Tree Traversal & Metro Map Coordinate Solver ---
function generateFamilyMetroCoordinates(rootName, alpha = 0.75, baseSegmentLength = 90) {
  const coords = {};
  const orientations = {};
  const localBends = {};
  const linesDrawn = [];

  const startX = 350;
  const startY = 220;
  coords[rootName] = { x: startX, y: startY };
  
  const rootGender = getNodeGender(rootName);
  orientations[rootName] = rootGender === "F" ? 2 : 3;

  const visitedNodes = new Set([rootName]);
  const queue = [{ name: rootName, gen: 0 }];

  while (queue.length > 0) {
    const { name: u, gen } = queue.shift();
    const uPos = coords[u];
    const uK = orientations[u];
    const uGender = getNodeGender(u);

    const neighbors = (graph[u] || [])
      .map(e => e.to)
      .filter(v => !visitedNodes.has(v));

    const unitDist = baseSegmentLength * Math.pow(alpha, gen);

    neighbors.forEach(v => {
      visitedNodes.add(v);
      const vGender = getNodeGender(v);

      const choices = [-1, 1];
      let bestPos = null;
      let bestBend = null;
      let bestK = uK;
      let minCollisions = Infinity;
      let maxDistToExisting = -1;

      choices.forEach(turn => {
        let nextK = uK;
        let pNext = { x: uPos.x, y: uPos.y };
        let bendPt = null;

        if (uGender === vGender) {
          // Straight link
          nextK = (uK + (turn > 0 ? 0 : 0)) % 8;
          const rad = getBaseAngle(nextK);
          pNext = {
            x: uPos.x + unitDist * Math.cos(rad),
            y: uPos.y + unitDist * Math.sin(rad)
          };
        } else {
          // Bended link (45-degree angle transition)
          const bendedSegmentLen = unitDist / Math.sqrt(2 + Math.sqrt(2));
          const bendAngle = getBaseAngle((uK + turn + 8) % 8);
          bendPt = {
            x: uPos.x + bendedSegmentLen * Math.cos(bendAngle),
            y: uPos.y + bendedSegmentLen * Math.sin(bendAngle)
          };

          nextK = (uK + turn * 2 + 8) % 8;
          const finalAngle = getBaseAngle(nextK);
          pNext = {
            x: bendPt.x + bendedSegmentLen * Math.cos(finalAngle),
            y: bendPt.y + bendedSegmentLen * Math.sin(finalAngle)
          };
        }

        let collisions = 0;
        linesDrawn.forEach(seg => {
          if (bendPt) {
            if (segmentsIntersect(uPos, bendPt, seg.p1, seg.p2) || segmentsIntersect(bendPt, pNext, seg.p1, seg.p2)) {
              collisions++;
            }
          } else {
            if (segmentsIntersect(uPos, pNext, seg.p1, seg.p2)) {
              collisions++;
            }
          }
        });

        let nearestNodeDist = Infinity;
        Object.keys(coords).forEach(other => {
          const d = Math.hypot(coords[other].x - pNext.x, coords[other].y - pNext.y);
          //const d = Math.abs(coords[other].x - pNext.x) + Math.abs(coords[other].y - pNext.y);
          if (d < nearestNodeDist) nearestNodeDist = d;
        });

        if (collisions < minCollisions || (collisions === minCollisions && nearestNodeDist > maxDistToExisting)) {
          minCollisions = collisions;
          maxDistToExisting = nearestNodeDist;
          bestPos = pNext;
          bestBend = bendPt;
          bestK = nextK;
        }
      });

      coords[v] = bestPos;
      orientations[v] = bestK;
      if (bestBend) {
        localBends[`${u}-${v}`] = bestBend;
      }
      
      if (bestBend) {
        linesDrawn.push({ p1: uPos, p2: bestBend });
        linesDrawn.push({ p1: bestBend, p2: bestPos });
      } else {
        linesDrawn.push({ p1: uPos, p2: bestPos });
      }
      queue.push({ name: v, gen: gen + 1 });
    });
  }

  return { coords, bends: localBends };
}

// Helper to pre-calculate global offsets
function prepareMetroData(rootNode, alpha) {
  const { coords, bends } = generateFamilyMetroCoordinates(rootNode, alpha, 90);

  let minX = Infinity, minY = Infinity;
  Object.keys(coords).forEach(n => {
    minX = Math.min(minX, coords[n].x);
    minY = Math.min(minY, coords[n].y);
  });
  Object.keys(bends).forEach(k => {
    minX = Math.min(minX, bends[k].x);
    minY = Math.min(minY, bends[k].y);
  });

  const offsetX = minX < 50 ? 50 - minX : 0;
  const offsetY = minY < 50 ? 50 - minY : 0;

  return { coords, bends, offsetX, offsetY };
}

// --- 4. Main Controller Function (Instant Draw) ---
function runFamilyMetroMapLayout(alpha = 0.75) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");
  const bfsDisplayElem = getDomEl("bfsLayersDisplay");

  // Step 1: Check if graph is an undirected tree
  const check = verifyGraphIsTree();
  if (!check.isTree) {
    alert("Family Metro Map Error: " + check.reason);
    if (statusElem) statusElem.innerText = "Error: Input graph is not a valid tree.";
    if (bfsDisplayElem) bfsDisplayElem.innerHTML = "[]";
    checkAndListOverlappingVertices();
    return;
  }

  // Step 2: Determine root node safely
  let rootNode = "";
  if (startNodeInp && startNodeInp.value && graph[startNodeInp.value.trim().toUpperCase()]) {
    rootNode = startNodeInp.value.trim().toUpperCase();
  } else {
    rootNode = Object.keys(graph)[0];
    if (startNodeInp) startNodeInp.value = rootNode;
  }

  if (!rootNode) {
    alert("Please add vertices to build a tree.");
    checkAndListOverlappingVertices();
    return;
  }

  // Reset any ongoing step-by-step state
  window.stepBfsState.active = false;

  // Compute and display the full BFS traversal layer-by-layer
  const bfsLayers = computeBFSLayers(rootNode);
  if (bfsDisplayElem) {
    bfsDisplayElem.innerHTML = formatBFSLayersColoredHTML(bfsLayers);
  }

  const { coords, bends, offsetX, offsetY } = prepareMetroData(rootNode, alpha);

  // Apply node positions and gender colors to all nodes
  Object.keys(nodes).forEach(node => {
    if (nodes[node]) {
      nodes[node].style.display = "flex";
      if (coords[node]) {
        nodes[node].style.left = Math.round(coords[node].x + offsetX) + "px";
        nodes[node].style.top = Math.round(coords[node].y + offsetY) + "px";

        const gender = getNodeGender(node);
        nodes[node].classList.remove("node-male", "node-female");
        if (gender === "M") {
          nodes[node].classList.add("node-male");
        } else {
          nodes[node].classList.add("node-female");
        }
      }
    }
  });

  // Align bend coordinates to center of nodes (radius 8px)
  window.edgeBends = {};
  const nodeRadius = 8;
  Object.keys(bends).forEach(key => {
    window.edgeBends[key] = {
      x: Math.round(bends[key].x + offsetX + nodeRadius),
      y: Math.round(bends[key].y + offsetY + nodeRadius)
    };
  });

  // Step 5: Redraw edges
  if (typeof drawEdges === "function") drawEdges();
  if (typeof updateCoords === "function") updateCoords();

  // Regularly update overlapping vertices
  checkAndListOverlappingVertices();
  
  if (statusElem) {
    statusElem.innerText = `Family Metro Map layout applied (Root: ${rootNode}, α = ${alpha}). Blue = Male, Pink = Female.`;
  }
}

// --- 5. Step-by-Step BFS Metro Drawer ---
function stepBFSMove(alpha = 0.75) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");
  const bfsDisplayElem = getDomEl("bfsLayersDisplay");

  const check = verifyGraphIsTree();
  if (!check.isTree) {
    alert("Family Metro Map Error: " + check.reason);
    if (statusElem) statusElem.innerText = "Error: Input graph is not a valid tree.";
    checkAndListOverlappingVertices();
    return;
  }

  let rootNode = "";
  if (startNodeInp && startNodeInp.value && graph[startNodeInp.value.trim().toUpperCase()]) {
    rootNode = startNodeInp.value.trim().toUpperCase();
  } else {
    rootNode = Object.keys(graph)[0];
    if (startNodeInp) startNodeInp.value = rootNode;
  }

  if (!rootNode) {
    alert("Please add vertices to build a tree.");
    checkAndListOverlappingVertices();
    return;
  }

  // Initialize or restart step session if root changed or not active
  if (!window.stepBfsState.active || window.stepBfsState.root !== rootNode) {
    const fullLayers = computeBFSLayers(rootNode);
    const flattenedOrder = [];
    fullLayers.forEach(layer => {
      layer.forEach(n => flattenedOrder.push(n));
    });

    const { coords, bends, offsetX, offsetY } = prepareMetroData(rootNode, alpha);

    // Hide all existing node elements on canvas initially
    Object.keys(nodes).forEach(n => {
      if (nodes[n]) nodes[n].style.display = "none";
    });

    // Clear SVG edges initially
    const edgesSvg = getDomEl("edges");
    if (edgesSvg) edgesSvg.innerHTML = "";

    window.stepBfsState = {
      active: true,
      root: rootNode,
      stepIndex: 0,
      order: flattenedOrder,
      fullLayers: fullLayers,
      currentDrawnLayers: [],
      coords: coords,
      bends: bends,
      offsets: { x: offsetX, y: offsetY }
    };

    if (bfsDisplayElem) bfsDisplayElem.innerHTML = "[]";
    checkAndListOverlappingVertices();
  }

  const state = window.stepBfsState;

  // If already finished drawing and button is clicked again, output FULL TREE DRAWN
  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL TREE DRAWN";
    checkAndListOverlappingVertices();
    return;
  }

  // Reveal next vertex in BFS order
  const currNode = state.order[state.stepIndex];
  state.stepIndex++;

  // Determine current drawn layer structure for display above grid
  const placedSet = new Set(state.order.slice(0, state.stepIndex));
  const partialLayers = [];
  state.fullLayers.forEach(layer => {
    const drawnInLayer = layer.filter(v => placedSet.has(v));
    if (drawnInLayer.length > 0) {
      partialLayers.push(drawnInLayer);
    }
  });

  if (bfsDisplayElem) {
    bfsDisplayElem.innerHTML = formatBFSLayersColoredHTML(partialLayers);
  }

  // Position and display the node on grid
  if (nodes[currNode] && state.coords[currNode]) {
    nodes[currNode].style.display = "flex";
    nodes[currNode].style.left = Math.round(state.coords[currNode].x + state.offsets.x) + "px";
    nodes[currNode].style.top = Math.round(state.coords[currNode].y + state.offsets.y) + "px";

    const gender = getNodeGender(currNode);
    nodes[currNode].classList.remove("node-male", "node-female");
    if (gender === "M") {
      nodes[currNode].classList.add("node-male");
    } else {
      nodes[currNode].classList.add("node-female");
    }
  }

  // Update window.edgeBends for currently visible nodes
  window.edgeBends = {};
  const nodeRadius = 8;
  Object.keys(state.bends).forEach(key => {
    const [u, v] = key.split("-");
    if (placedSet.has(u) && placedSet.has(v)) {
      window.edgeBends[key] = {
        x: Math.round(state.bends[key].x + state.offsets.x + nodeRadius),
        y: Math.round(state.bends[key].y + state.offsets.y + nodeRadius)
      };
    }
  });

  // Render edges between currently visible nodes
  drawPartialMetroEdges(placedSet);
  if (typeof updateCoords === "function") updateCoords();

  // Regularly update overlapping vertices on each individual step
  checkAndListOverlappingVertices();

  // Status message updates
  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL TREE DRAWN";
  } else {
    if (statusElem) {
      statusElem.innerText = `BFS Drawing Node (${currNode}) [${state.stepIndex} / ${state.order.length}]. Click again to advance.`;
    }
  }
}

// Draw SVG edges exclusively for vertices that are currently displayed
function drawPartialMetroEdges(visibleSet) {
  const edgesSvg = getDomEl("edges");
  if (!edgesSvg) return;

  edgesSvg.innerHTML = "";
  const SVG_NS = "http://www.w3.org/2000/svg";
  let seenEdges = new Set();

  for (let u in graph) {
    if (!visibleSet.has(u)) continue;
    (graph[u] || []).forEach(e => {
      let v = e.to;
      if (!visibleSet.has(v)) return;

      let edgeKey = [u, v].sort().join("-");
      if (seenEdges.has(edgeKey)) return;
      seenEdges.add(edgeKey);

      if (!nodes[u] || !nodes[v]) return;

      const nodeRadius = 8;
      let x1 = nodes[u].offsetLeft + nodeRadius;
      let y1 = nodes[u].offsetTop + nodeRadius;
      let x2 = nodes[v].offsetLeft + nodeRadius;
      let y2 = nodes[v].offsetTop + nodeRadius;

      let path = document.createElementNS(SVG_NS, "path");
      let bend = (window.edgeBends && (window.edgeBends[`${u}-${v}`] || window.edgeBends[`${v}-${u}`])) || null;
      let d = bend ? `M ${x1} ${y1} L ${bend.x} ${bend.y} L ${x2} ${y2}` : `M ${x1} ${y1} L ${x2} ${y2}`;

      path.setAttribute("d", d);
      path.setAttribute("stroke", "#555");
      path.setAttribute("stroke-width", "2.5");
      path.setAttribute("fill", "transparent");
      path.setAttribute("stroke-linejoin", "round");
      edgesSvg.appendChild(path);
    });
  }
}