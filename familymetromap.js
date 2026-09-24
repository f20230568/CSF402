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

// Store overrides and change summaries per root to ensure deterministic replays
window.metroOverridesByRoot = {};
window.metroChangeSummaryByRoot = {};

function getActiveOverrides(root) {
  if (!window.metroOverridesByRoot[root]) {
    window.metroOverridesByRoot[root] = {
      edgeScaleFactors: {},
      genderFlips: {},
      turnDirections: {},
      angleOffsets: {}
    };
  }
  return window.metroOverridesByRoot[root];
}

function getActiveSummary(root) {
  if (!window.metroChangeSummaryByRoot[root]) {
    window.metroChangeSummaryByRoot[root] = [];
  }
  return window.metroChangeSummaryByRoot[root];
}

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

  let totalDegree = 0;
  for (let u in graph) {
    totalDegree += (graph[u] || []).length;
  }
  const E = totalDegree / 2;

  if (E !== V - 1) {
    return {
      isTree: false,
      reason: `Graph has ${V} vertices and ${E} edges. A tree must have exactly |V| - 1 edges (cycles or disconnected parts detected).`
    };
  }

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

function getNodeGender(name, root = null) {
  if (root && window.metroOverridesByRoot[root] && window.metroOverridesByRoot[root].genderFlips[name]) {
    return window.metroOverridesByRoot[root].genderFlips[name].toUpperCase();
  }
  if (nodes[name] && nodes[name].dataset && nodes[name].dataset.gender) {
    return nodes[name].dataset.gender.toUpperCase();
  }
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

function formatBFSLayersColoredHTML(layerArrays, rootName = null) {
  if (!layerArrays || layerArrays.length === 0) return "[]";
  
  const formattedLayers = layerArrays.map(layer => {
    const nodeSpans = layer.map(name => {
      const isMale = getNodeGender(name, rootName) === "M";
      const bg = isMale ? "#3498db" : "#e91e63";
      return `<span style="display:inline-block; background:${bg}; color:white; padding:1px 6px; border-radius:3px; margin:1px 2px; font-weight:bold;">${name}</span>`;
    }).join(", ");
    return `[${nodeSpans}]`;
  }).join(", ");

  return `[${formattedLayers}]`;
}

// Overlapping Vertices Detection
function checkAndListOverlappingVertices(threshold = 16) {
  const overlapList = getDomEl("overlapList");
  if (!overlapList) return [];

  overlapList.innerHTML = "";
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

  return detectedPairs;
}
window.checkAndListOverlappingVertices = checkAndListOverlappingVertices;

function updateSummaryOfChangesSection(root = null) {
  const summaryList = getDomEl("summaryList");
  if (!summaryList) return;

  // Fallback to active startNode if no root is explicitly passed
  if (!root) {
    const startNodeInp = getDomEl("startNode");
    root = (startNodeInp && startNodeInp.value) ? startNodeInp.value.trim().toUpperCase() : Object.keys(graph)[0];
  }

  const list = root ? getActiveSummary(root) : [];
  summaryList.innerHTML = "";
  if (!list || list.length === 0) {
    const li = document.createElement("li");
    li.style.color = "#7f8c8d";
    li.textContent = "No automated adjustments applied.";
    summaryList.appendChild(li);
  } else {
    list.forEach(item => {
      const li = document.createElement("li");
      li.style.padding = "2px 0";
      li.innerHTML = item;
      summaryList.appendChild(li);
    });
  }
}
window.updateSummaryOfChangesSection = updateSummaryOfChangesSection;

// --- 3. Tree Traversal & Metro Map Coordinate Solver ---
function generateFamilyMetroCoordinates(rootName, alpha = 0.75, baseSegmentLength = 90) {
  const coords = {};
  const orientations = {};
  const localBends = {};
  const linesDrawn = [];

  const startX = 350;
  const startY = 220;
  coords[rootName] = { x: startX, y: startY };
  
  const activeOverrides = getActiveOverrides(rootName);
  const rootGender = getNodeGender(rootName, rootName);
  orientations[rootName] = rootGender === "F" ? 2 : 3;

  const visitedNodes = new Set([rootName]);
  const queue = [{ name: rootName, gen: 0 }];

  while (queue.length > 0) {
    const { name: u, gen } = queue.shift();
    const uPos = coords[u];
    const uK = orientations[u];
    const uGender = getNodeGender(u, rootName);

    const neighbors = (graph[u] || [])
      .map(e => e.to)
      .filter(v => !visitedNodes.has(v));

    neighbors.forEach(v => {
      visitedNodes.add(v);
      const vGender = getNodeGender(v, rootName);

      const edgeKey = `${u}-${v}`;
      const revKey = `${v}-${u}`;
      const edgeScale = (activeOverrides.edgeScaleFactors[edgeKey] || activeOverrides.edgeScaleFactors[revKey]) || 1.0;
      
      const forcedTurnVal = activeOverrides.turnDirections[edgeKey] !== undefined 
        ? activeOverrides.turnDirections[edgeKey] 
        : activeOverrides.turnDirections[revKey];
      const forcedTurn = forcedTurnVal !== undefined ? forcedTurnVal : null;
      
      const angleOffset = (activeOverrides.angleOffsets[edgeKey] || activeOverrides.angleOffsets[revKey]) || 0;

      const unitDist = baseSegmentLength * Math.pow(alpha, gen) * edgeScale;

      const baseK = (uK + angleOffset + 8) % 8;
      const choices = forcedTurn !== null ? [forcedTurn] : [-1, 1];
      let bestPos = null;
      let bestBend = null;
      let bestK = baseK;
      let minCollisions = Infinity;
      let maxDistToExisting = -1;

      choices.forEach(turn => {
        let nextK = baseK;
        let pNext = { x: uPos.x, y: uPos.y };
        let bendPt = null;

        if (uGender === vGender) {
          // Straight link
          nextK = (baseK + (turn > 0 ? 0 : 0)) % 8;
          const rad = getBaseAngle(nextK);
          pNext = {
            x: uPos.x + unitDist * Math.cos(rad),
            y: uPos.y + unitDist * Math.sin(rad)
          };
        } else {
          // Bended link (45-degree angle transition)
          const bendedSegmentLen = unitDist / Math.sqrt(2 + Math.sqrt(2));
          const bendAngle = getBaseAngle((baseK + turn + 8) % 8);
          bendPt = {
            x: uPos.x + bendedSegmentLen * Math.cos(bendAngle),
            y: uPos.y + bendedSegmentLen * Math.sin(bendAngle)
          };

          nextK = (baseK + turn * 2 + 8) % 8;
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

  return { coords, bends: localBends, linesDrawn };
}

// Helper to pre-calculate global offsets
function prepareMetroData(rootNode, alpha) {
  const { coords, bends, linesDrawn } = generateFamilyMetroCoordinates(rootNode, alpha, 90);

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

  return { coords, bends, linesDrawn, offsetX, offsetY };
}

// --- 4. Main Controller Function (Instant Draw) ---
function runFamilyMetroMapLayout(alpha = 0.75, resetOverrides = true) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");
  const bfsDisplayElem = getDomEl("bfsLayersDisplay");

  const check = verifyGraphIsTree();
  if (!check.isTree) {
    alert("Family Metro Map Error: " + check.reason);
    if (statusElem) statusElem.innerText = "Error: Input graph is not a valid tree.";
    if (bfsDisplayElem) bfsDisplayElem.innerHTML = "[]";
    checkAndListOverlappingVertices();
    updateSummaryOfChangesSection();
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
    updateSummaryOfChangesSection();
    return;
  }

  // Only reset overrides when explicitly executing a fresh baseline draw
  if (resetOverrides) {
    window.metroOverridesByRoot[rootNode] = {
      edgeScaleFactors: {},
      genderFlips: {},
      turnDirections: {},
      angleOffsets: {}
    };
    window.metroChangeSummaryByRoot[rootNode] = [];
  }

  window.stepBfsState.active = false;

  const bfsLayers = computeBFSLayers(rootNode);
  if (bfsDisplayElem) {
    bfsDisplayElem.innerHTML = formatBFSLayersColoredHTML(bfsLayers, rootNode);
  }

  const { coords, bends, offsetX, offsetY } = prepareMetroData(rootNode, alpha);

  Object.keys(nodes).forEach(node => {
    if (nodes[node]) {
      nodes[node].style.display = "flex";
      if (coords[node]) {
        nodes[node].style.left = Math.round(coords[node].x + offsetX) + "px";
        nodes[node].style.top = Math.round(coords[node].y + offsetY) + "px";

        const gender = getNodeGender(node, rootNode);
        nodes[node].classList.remove("node-male", "node-female");
        if (gender === "M") {
          nodes[node].classList.add("node-male");
        } else {
          nodes[node].classList.add("node-female");
        }
      }
    }
  });

  window.edgeBends = {};
  const nodeRadius = 8;
  Object.keys(bends).forEach(key => {
    window.edgeBends[key] = {
      x: Math.round(bends[key].x + offsetX + nodeRadius),
      y: Math.round(bends[key].y + offsetY + nodeRadius)
    };
  });

  if (typeof drawEdges === "function") drawEdges();
  if (typeof updateCoords === "function") updateCoords();

  checkAndListOverlappingVertices();
  updateSummaryOfChangesSection(rootNode);
  
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
    updateSummaryOfChangesSection();
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
    updateSummaryOfChangesSection();
    return;
  }

  if (!window.stepBfsState.active || window.stepBfsState.root !== rootNode) {
    const fullLayers = computeBFSLayers(rootNode);
    const flattenedOrder = [];
    fullLayers.forEach(layer => {
      layer.forEach(n => flattenedOrder.push(n));
    });

    const { coords, bends, offsetX, offsetY } = prepareMetroData(rootNode, alpha);

    Object.keys(nodes).forEach(n => {
      if (nodes[n]) nodes[n].style.display = "none";
    });

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
    updateSummaryOfChangesSection(rootNode);
  }

  const state = window.stepBfsState;

  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL TREE DRAWN";
    checkAndListOverlappingVertices();
    updateSummaryOfChangesSection(rootNode);
    return;
  }

  const currNode = state.order[state.stepIndex];
  state.stepIndex++;

  const placedSet = new Set(state.order.slice(0, state.stepIndex));
  const partialLayers = [];
  state.fullLayers.forEach(layer => {
    const drawnInLayer = layer.filter(v => placedSet.has(v));
    if (drawnInLayer.length > 0) {
      partialLayers.push(drawnInLayer);
    }
  });

  if (bfsDisplayElem) {
    bfsDisplayElem.innerHTML = formatBFSLayersColoredHTML(partialLayers, rootNode);
  }

  if (nodes[currNode] && state.coords[currNode]) {
    nodes[currNode].style.display = "flex";
    nodes[currNode].style.left = Math.round(state.coords[currNode].x + state.offsets.x) + "px";
    nodes[currNode].style.top = Math.round(state.coords[currNode].y + state.offsets.y) + "px";

    const gender = getNodeGender(currNode, rootNode);
    nodes[currNode].classList.remove("node-male", "node-female");
    if (gender === "M") {
      nodes[currNode].classList.add("node-male");
    } else {
      nodes[currNode].classList.add("node-female");
    }
  }

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

  drawPartialMetroEdges(placedSet);
  if (typeof updateCoords === "function") updateCoords();

  checkAndListOverlappingVertices();
  updateSummaryOfChangesSection(rootNode);

  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL TREE DRAWN";
  } else {
    if (statusElem) {
      statusElem.innerText = `BFS Drawing Node (${currNode}) [${state.stepIndex} / ${state.order.length}]. Click again to advance.`;
    }
  }
}

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

// Layout Evaluation Metric: strictly penalizes overlaps and crossings, rewards spacing
function evaluateLayoutQuality(rootNode, alpha) {
  const { coords, bends, linesDrawn } = generateFamilyMetroCoordinates(rootNode, alpha, 90);
  const nodeKeys = Object.keys(coords);
  let overlapCount = 0;
  let minDistance = Infinity;
  const overlappingPairs = [];

  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      const u = nodeKeys[i], v = nodeKeys[j];
      const d = Math.hypot(coords[u].x - coords[v].x, coords[u].y - coords[v].y);
      if (d < 16) {
        overlapCount++;
        overlappingPairs.push({ u, v, dist: Math.round(d) });
      }
      if (d < minDistance) {
        minDistance = d;
      }
    }
  }

  let lineIntersections = 0;
  for (let i = 0; i < linesDrawn.length; i++) {
    for (let j = i + 1; j < linesDrawn.length; j++) {
      if (segmentsIntersect(linesDrawn[i].p1, linesDrawn[i].p2, linesDrawn[j].p1, linesDrawn[j].p2)) {
        lineIntersections++;
      }
    }
  }

  const cost = (overlapCount * 100000) + (lineIntersections * 2000) - (minDistance === Infinity ? 0 : minDistance);
  return { cost, overlapCount, lineIntersections, minDistance, overlappingPairs, coords, bends };
}

// --- 6. Multi-Strategy Overlap Optimization Engine (All Overlaps) ---
function fixMetroOverlaps(alpha = 0.75) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");

  let rootNode = (startNodeInp && startNodeInp.value && graph[startNodeInp.value.trim().toUpperCase()])
    ? startNodeInp.value.trim().toUpperCase()
    : Object.keys(graph)[0];

  if (!rootNode) return;

  // Establish base layout
  runFamilyMetroMapLayout(alpha, false);
  let evalRes = evaluateLayoutQuality(rootNode, alpha);

  if (evalRes.overlapCount === 0) {
    if (statusElem) statusElem.innerText = "No overlapping vertices detected. Layout is optimal.";
    window.metroChangeSummaryByRoot[rootNode] = ["Checked graph: No overlapping vertices were found."];
    updateSummaryOfChangesSection(rootNode);
    return;
  }

  // Build parent mapping using BFS
  const parentMap = {};
  const queue = [rootNode];
  const visited = new Set([rootNode]);
  while (queue.length > 0) {
    const u = queue.shift();
    (graph[u] || []).forEach(e => {
      if (!visited.has(e.to)) {
        visited.add(e.to);
        parentMap[e.to] = u;
        queue.push(e.to);
      }
    });
  }

  let rootOverrides = getActiveOverrides(rootNode);
  let bestOverrides = JSON.parse(JSON.stringify(rootOverrides));
  let currentCost = evalRes.cost;
  let summaryLog = [];

  const maxOuterRounds = 16;
  let outerRound = 0;

  // Loop until all overlaps are cleared or search budget exhausted
  while (evalRes.overlapCount > 0 && outerRound < maxOuterRounds) {
    outerRound++;
    let progressMade = false;

    // Target both vertices of every overlapping pair, plus their parents
    const targetSet = new Set();
    evalRes.overlappingPairs.forEach(pair => {
      if (pair.u !== rootNode) targetSet.add(pair.u);
      if (pair.v !== rootNode) targetSet.add(pair.v);
      if (parentMap[pair.u] && parentMap[pair.u] !== rootNode) targetSet.add(parentMap[pair.u]);
      if (parentMap[pair.v] && parentMap[pair.v] !== rootNode) targetSet.add(parentMap[pair.v]);
    });

    const candidateTargets = Array.from(targetSet);

    for (let targetNode of candidateTargets) {
      const parentNode = parentMap[targetNode];
      if (!parentNode) continue;

      const edgeKey = `${parentNode}-${targetNode}`;
      let nodeBestOverrides = null;
      let nodeBestCost = currentCost;
      let nodeBestAction = null;

      // 1. Angular sectors: 180° opposite (4), +90° (2), -90° (-2), +45° (1), -45° (-1), +135° (3), -135° (-3), default (0)
      const angleOffsets = [4, 2, -2, 1, -1, 3, -3, 0];

      // 2. Gender choices: Keep current, or flip
      const currentGender = getNodeGender(targetNode, rootNode);
      const flippedGender = currentGender === "M" ? "F" : "M";
      const genderChoices = [
        { flip: null, label: "" },
        { flip: flippedGender, label: `flipped gender to ${flippedGender}` }
      ];

      // 3. Turn directions: null (default heuristic), +1, -1
      const turns = [null, 1, -1];

      for (let gChoice of genderChoices) {
        for (let angle of angleOffsets) {
          for (let turn of turns) {
            const trialOverrides = JSON.parse(JSON.stringify(bestOverrides));

            if (angle !== 0) {
              trialOverrides.angleOffsets[edgeKey] = angle;
            } else {
              delete trialOverrides.angleOffsets[edgeKey];
            }

            if (gChoice.flip) {
              trialOverrides.genderFlips[targetNode] = gChoice.flip;
            } else {
              delete trialOverrides.genderFlips[targetNode];
            }

            if (turn !== null) {
              trialOverrides.turnDirections[edgeKey] = turn;
            } else {
              delete trialOverrides.turnDirections[edgeKey];
            }

            window.metroOverridesByRoot[rootNode] = trialOverrides;
            const trialEval = evaluateLayoutQuality(rootNode, alpha);

            if (trialEval.cost < nodeBestCost) {
              nodeBestCost = trialEval.cost;
              nodeBestOverrides = JSON.parse(JSON.stringify(trialOverrides));

              let descParts = [];
              if (angle === 4) descParts.push("placed on opposite side of parent (180°)");
              else if (angle !== 0) descParts.push(`shifted angle by ${angle * 45}°`);
              if (gChoice.flip) descParts.push(gChoice.label);
              if (turn !== null) descParts.push(`inverted bend to ${turn > 0 ? '+45°' : '-45°'}`);

              nodeBestAction = `Relocated vertex <strong>${targetNode}</strong>: ${descParts.join(", ")}.`;
            }
          }
        }
      }

      if (nodeBestOverrides && nodeBestCost < currentCost) {
        bestOverrides = nodeBestOverrides;
        currentCost = nodeBestCost;
        window.metroOverridesByRoot[rootNode] = bestOverrides;
        evalRes = evaluateLayoutQuality(rootNode, alpha);
        if (nodeBestAction) summaryLog.push(nodeBestAction);
        progressMade = true;

        if (evalRes.overlapCount === 0) break;
      }
    }

    // Secondary fallback: Micro-scale edge adjustment if angle channels are crowded
    if (!progressMade && evalRes.overlapCount > 0) {
      for (let targetNode of candidateTargets) {
        const parentNode = parentMap[targetNode];
        if (!parentNode) continue;
        const edgeKey = `${parentNode}-${targetNode}`;

        for (let scale of [0.86, 1.14, 0.76]) {
          const trialOverrides = JSON.parse(JSON.stringify(bestOverrides));
          trialOverrides.edgeScaleFactors[edgeKey] = scale;
          window.metroOverridesByRoot[rootNode] = trialOverrides;
          const trialEval = evaluateLayoutQuality(rootNode, alpha);

          if (trialEval.cost < currentCost) {
            currentCost = trialEval.cost;
            bestOverrides = trialOverrides;
            evalRes = trialEval;
            summaryLog.push(`Scaled branch (<strong>${parentNode} → ${targetNode}</strong>) by <strong>${scale}×</strong> to clear spacing.`);
            progressMade = true;
            break;
          }
        }
        if (progressMade) break;
      }
    }

    if (!progressMade) break;
  }

  // Commit best overrides and log
  window.metroOverridesByRoot[rootNode] = bestOverrides;

  const finalEval = evaluateLayoutQuality(rootNode, alpha);
  if (finalEval.overlapCount > 0) {
    const unresolvableNodes = new Set();
    finalEval.overlappingPairs.forEach(p => {
      unresolvableNodes.add(p.u);
      unresolvableNodes.add(p.v);
    });
    unresolvableNodes.forEach(node => {
      summaryLog.push(`<span style="color:#c0392b;">Could not resolve overlap for vertex <strong>${node}</strong>: no collision-free octilinear sector available.</span>`);
    });
  }

  window.metroChangeSummaryByRoot[rootNode] = summaryLog.length > 0 ? summaryLog : ["Checked all radial alternatives; layout cannot be improved further."];

  // Re-render and update UI with the overrides applied
  runFamilyMetroMapLayout(alpha, false);
  checkAndListOverlappingVertices();
  updateSummaryOfChangesSection(rootNode);

  if (statusElem) {
    if (finalEval.overlapCount === 0) {
      statusElem.innerText = `All overlaps fixed! (Applied ${summaryLog.length} geometric adjustments).`;
    } else {
      statusElem.innerText = `Partial resolution applied. Remaining overlapping vertices: ${finalEval.overlapCount}.`;
    }
  }
}
window.fixMetroOverlaps = fixMetroOverlaps;

// --- 7. Save Canvas as JPG (Dynamic Bounding Box) ---
function saveDrawingAsJPG() {
  const canvasEl = getDomEl("canvas");
  const svgEl = getDomEl("edges");
  if (!canvasEl || !svgEl) return;

  const nodeRadius = 8;
  const padding = 40;

  // 1. Gather all currently visible nodes
  const visibleNodes = Object.keys(nodes).filter(
    k => nodes[k] && nodes[k].style.display !== "none"
  );

  if (visibleNodes.length === 0) {
    alert("Nothing to save: no vertices are currently visible.");
    return;
  }

  // 2. Compute bounding box encompassing all visible vertices
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  visibleNodes.forEach(name => {
    const el = nodes[name];
    const x = el.offsetLeft;
    const y = el.offsetTop;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + nodeRadius * 2);
    maxY = Math.max(maxY, y + nodeRadius * 2);
  });

  // Also encompass active edge bends within bounding box
  if (window.edgeBends) {
    visibleNodes.forEach(u => {
      (graph[u] || []).forEach(e => {
        const v = e.to;
        if (!visibleNodes.includes(v)) return;
        const bend = window.edgeBends[`${u}-${v}`] || window.edgeBends[`${v}-${u}`];
        if (bend) {
          minX = Math.min(minX, bend.x - nodeRadius);
          minY = Math.min(minY, bend.y - nodeRadius);
          maxX = Math.max(maxX, bend.x + nodeRadius);
          maxY = Math.max(maxY, bend.y + nodeRadius);
        }
      });
    });
  }

  // Dynamic image dimensions
  const exportWidth = Math.ceil((maxX - minX) + padding * 2);
  const exportHeight = Math.ceil((maxY - minY) + padding * 2);
  const shiftX = padding - minX;
  const shiftY = padding - minY;

  // 3. Create dynamic offscreen canvas
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = exportWidth;
  exportCanvas.height = exportHeight;
  const ctx = exportCanvas.getContext("2d");

  // Fill canvas background with crisp white
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, exportWidth, exportHeight);

  // 4. Draw SVG edges shifted to fit inside canvas bounding box
  const clonedSvg = svgEl.cloneNode(true);
  clonedSvg.setAttribute("width", exportWidth);
  clonedSvg.setAttribute("height", exportHeight);

  const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
  g.setAttribute("transform", `translate(${shiftX}, ${shiftY})`);
  while (clonedSvg.firstChild) {
    g.appendChild(clonedSvg.firstChild);
  }
  clonedSvg.appendChild(g);

  const svgData = new XMLSerializer().serializeToString(clonedSvg);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  const img = new Image();

  img.onload = function() {
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    // 5. Draw visible vertices on top with offset
    visibleNodes.forEach(name => {
      const nodeEl = nodes[name];
      const cx = nodeEl.offsetLeft + nodeRadius + shiftX;
      const cy = nodeEl.offsetTop + nodeRadius + shiftY;

      const isMale = nodeEl.classList.contains("node-male");
      const bgColor = isMale ? "#3498db" : "#e91e63";
      const borderColor = isMale ? "#1b4f72" : "#880e4f";

      ctx.beginPath();
      ctx.arc(cx, cy, nodeRadius, 0, Math.PI * 2);
      ctx.fillStyle = bgColor;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = borderColor;
      ctx.stroke();

      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(name, cx, cy);
    });

    // 6. Download the resulting complete JPG
    const jpgUrl = exportCanvas.toDataURL("image/jpeg", 0.95);
    const downloadLink = document.createElement("a");
    downloadLink.download = `metro_map_${new Date().getTime()}.jpg`;
    downloadLink.href = jpgUrl;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
  };

  img.src = url;
}
window.saveDrawingAsJPG = saveDrawingAsJPG;