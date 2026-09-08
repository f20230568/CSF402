window.edgeBends = {};

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

// --- 4. Main Controller Function ---
function runFamilyMetroMapLayout(alpha = 0.75) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");

  // Step 1: Check if graph is an undirected tree
  const check = verifyGraphIsTree();
  if (!check.isTree) {
    alert("Family Metro Map Error: " + check.reason);
    if (statusElem) statusElem.innerText = "Error: Input graph is not a valid tree.";
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
    return;
  }

  // Step 3: Compute coordinates & bends
  const { coords, bends } = generateFamilyMetroCoordinates(rootNode, alpha, 90);

  // Step 4: Normalize layout with canvas padding
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

  // Apply node positions and gender colors
  Object.keys(coords).forEach(node => {
    if (nodes[node]) {
      nodes[node].style.left = Math.round(coords[node].x + offsetX) + "px";
      nodes[node].style.top = Math.round(coords[node].y + offsetY) + "px";

      // Color nodes based on MALE / FEMALE
      const gender = getNodeGender(node);
      nodes[node].classList.remove("node-male", "node-female");
      if (gender === "M") {
        nodes[node].classList.add("node-male");
      } else {
        nodes[node].classList.add("node-female");
      }
    }
  });

  // Align bend coordinates to center of nodes (radius is 8px for compact metro nodes)
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
  if (statusElem) {
    statusElem.innerText = `Family Metro Map layout applied (Root: ${rootNode}, α = ${alpha}). Blue = Male, Pink = Female.`;
  }
}