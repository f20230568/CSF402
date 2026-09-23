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

// Strategic Overrides for Overlap Resolution
window.metroOverrides = {
  edgeScaleFactors: {},   // e.g., "A-E": 0.90
  genderFlips: {},        // e.g., "E": "F"
  turnDirections: {},     // e.g., "A-E": -1 or 1
  angleOffsets: {}        // e.g., "A-E": 4 (180-degree opposite placement)
};

// Summary of automated fixes applied
window.metroChangeSummary = [];

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

function getNodeGender(name) {
  if (window.metroOverrides && window.metroOverrides.genderFlips && window.metroOverrides.genderFlips[name]) {
    return window.metroOverrides.genderFlips[name].toUpperCase();
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

// Update Summary of Changes Section
function updateSummaryOfChangesSection() {
  const summaryList = getDomEl("summaryList");
  if (!summaryList) return;

  summaryList.innerHTML = "";
  if (!window.metroChangeSummary || window.metroChangeSummary.length === 0) {
    const li = document.createElement("li");
    li.style.color = "#7f8c8d";
    li.textContent = "No automated adjustments applied.";
    summaryList.appendChild(li);
  } else {
    window.metroChangeSummary.forEach(item => {
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

    neighbors.forEach(v => {
      visitedNodes.add(v);
      const vGender = getNodeGender(v);

      const edgeKey = `${u}-${v}`;
      const revKey = `${v}-${u}`;
      const edgeScale = (window.metroOverrides && (window.metroOverrides.edgeScaleFactors[edgeKey] || window.metroOverrides.edgeScaleFactors[revKey])) || 1.0;
      const forcedTurn = (window.metroOverrides && (window.metroOverrides.turnDirections[edgeKey] !== undefined ? window.metroOverrides.turnDirections[edgeKey] : window.metroOverrides.turnDirections[revKey])) !== undefined
        ? (window.metroOverrides.turnDirections[edgeKey] !== undefined ? window.metroOverrides.turnDirections[edgeKey] : window.metroOverrides.turnDirections[revKey])
        : null;
      const angleOffset = (window.metroOverrides && (window.metroOverrides.angleOffsets[edgeKey] || window.metroOverrides.angleOffsets[revKey])) || 0;

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
function runFamilyMetroMapLayout(alpha = 0.75) {
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

  window.stepBfsState.active = false;

  const bfsLayers = computeBFSLayers(rootNode);
  if (bfsDisplayElem) {
    bfsDisplayElem.innerHTML = formatBFSLayersColoredHTML(bfsLayers);
  }

  const { coords, bends, offsetX, offsetY } = prepareMetroData(rootNode, alpha);

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
  updateSummaryOfChangesSection();
  
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
    updateSummaryOfChangesSection();
  }

  const state = window.stepBfsState;

  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL TREE DRAWN";
    checkAndListOverlappingVertices();
    updateSummaryOfChangesSection();
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
    bfsDisplayElem.innerHTML = formatBFSLayersColoredHTML(partialLayers);
  }

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
  updateSummaryOfChangesSection();

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
        overlappingPairs.push({ u, v, d });
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

  runFamilyMetroMapLayout(alpha);
  let evalRes = evaluateLayoutQuality(rootNode, alpha);

  if (evalRes.overlapCount === 0) {
    if (statusElem) statusElem.innerText = "No overlapping vertices detected. Layout is optimal.";
    window.metroChangeSummary = ["Checked graph: No overlapping vertices were found."];
    updateSummaryOfChangesSection();
    return;
  }

  // Build parent mapping via BFS
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

  let bestOverrides = JSON.parse(JSON.stringify(window.metroOverrides));
  let currentCost = evalRes.cost;
  let summaryLog = [];

  const maxOuterRounds = 12;
  let outerRound = 0;

  // Continue iterating until all overlaps are eliminated or attempts exhausted
  while (evalRes.overlapCount > 0 && outerRound < maxOuterRounds) {
    outerRound++;
    let progressMade = false;

    // Collect all unique nodes currently involved in any overlap
    const nodesToFixSet = new Set();
    evalRes.overlappingPairs.forEach(pair => {
      if (pair.u !== rootNode) nodesToFixSet.add(pair.u);
      if (pair.v !== rootNode) nodesToFixSet.add(pair.v);
    });

    const nodesToFix = Array.from(nodesToFixSet);

    for (let targetNode of nodesToFix) {
      const parentNode = parentMap[targetNode];
      if (!parentNode) continue;

      const edgeKey = `${parentNode}-${targetNode}`;
      let candidateBestOverrides = null;
      let candidateBestCost = currentCost;
      let candidateBestAction = null;

      // Generate all combination mutations for this node
      // 1. Angle offsets: 0, 180° (4), +90° (2), -90° (-2), +45° (1), -45° (-1), +135° (3), -135° (-3)
      const angleOffsets = [4, 2, -2, 1, -1, 3, -3, 0];
      // 2. Gender choices: Keep current, or flip
      const currentGender = getNodeGender(targetNode);
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
            // Build mutation state from current best
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

            window.metroOverrides = trialOverrides;
            const trialEval = evaluateLayoutQuality(rootNode, alpha);

            if (trialEval.cost < candidateBestCost) {
              candidateBestCost = trialEval.cost;
              candidateBestOverrides = JSON.parse(JSON.stringify(trialOverrides));
              
              let descParts = [];
              if (angle === 4) descParts.push("placed on opposite side of parent (180°)");
              else if (angle !== 0) descParts.push(`shifted angle by ${angle * 45}°`);
              if (gChoice.flip) descParts.push(gChoice.label);
              if (turn !== null) descParts.push(`inverted bend to ${turn > 0 ? '+45°' : '-45°'}`);

              candidateBestAction = `Relocated vertex <strong>${targetNode}</strong>: ${descParts.join(", ")}.`;
            }
          }
        }
      }

      // If an improving mutation was found for this node, apply it immediately
      if (candidateBestOverrides && candidateBestCost < currentCost) {
        bestOverrides = candidateBestOverrides;
        currentCost = candidateBestCost;
        window.metroOverrides = bestOverrides;
        evalRes = evaluateLayoutQuality(rootNode, alpha);
        if (candidateBestAction) {
          summaryLog.push(candidateBestAction);
        }
        progressMade = true;

        if (evalRes.overlapCount === 0) break;
      }
    }

    // Fallback: If angular re-routing is blocked, apply micro edge scaling
    if (!progressMade && evalRes.overlapCount > 0) {
      for (let targetNode of nodesToFix) {
        const parentNode = parentMap[targetNode];
        if (!parentNode) continue;
        const edgeKey = `${parentNode}-${targetNode}`;

        for (let scale of [0.88, 1.15, 0.78]) {
          const trialOverrides = JSON.parse(JSON.stringify(bestOverrides));
          trialOverrides.edgeScaleFactors[edgeKey] = scale;
          window.metroOverrides = trialOverrides;
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

  // Commit optimal layout configuration
  window.metroOverrides = bestOverrides;

  // Check remaining unresolved overlaps and log explicit notice if none could be found
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

  window.metroChangeSummary = summaryLog.length > 0 ? summaryLog : ["Checked all radial alternatives; layout cannot be improved further."];

  runFamilyMetroMapLayout(alpha);
  checkAndListOverlappingVertices();
  updateSummaryOfChangesSection();

  if (statusElem) {
    if (finalEval.overlapCount === 0) {
      statusElem.innerText = `All overlaps fixed! (Applied ${summaryLog.length} geometric adjustments).`;
    } else {
      statusElem.innerText = `Partial resolution applied. Remaining overlapping vertices: ${finalEval.overlapCount}.`;
    }
  }
}
window.fixMetroOverlaps = fixMetroOverlaps;