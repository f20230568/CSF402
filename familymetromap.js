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
  offsets: { x: 0, y: 0 },
  seenEdgeCollisions: [],
  seenVertexOverlaps: []
};

// Store overrides and change summaries per root to ensure deterministic replays
window.metroOverridesByRoot = {};
window.metroChangeSummaryByRoot = {};

// Empty override record. angleOffsets = T-junction / branch offset g (in units of pi/4) relative to the
// parent's orientation, turnDirections = bend sign s (+1 / -1) of a bended link, edgeScaleFactors = length
// factor for one edge, subtreeScaleFactors = local shrinking factor for all edges below a vertex
// (Lemma 4.3 of Korst et al.: shrinking a sub-tree enough always separates it from its neighbours).
function createEmptyOverrides() {
  return {
    edgeScaleFactors: {},
    genderFlips: {},
    turnDirections: {},
    angleOffsets: {},
    subtreeScaleFactors: {}
  };
}

function getActiveOverrides(root) {
  if (!window.metroOverridesByRoot[root]) {
    window.metroOverridesByRoot[root] = createEmptyOverrides();
  }
  const ov = window.metroOverridesByRoot[root];
  if (!ov.edgeScaleFactors) ov.edgeScaleFactors = {};
  if (!ov.genderFlips) ov.genderFlips = {};
  if (!ov.turnDirections) ov.turnDirections = {};
  if (!ov.angleOffsets) ov.angleOffsets = {};
  if (!ov.subtreeScaleFactors) ov.subtreeScaleFactors = {};
  return ov;
}

// Reads a per-edge override regardless of the direction in which the edge key was stored
// (a stored value of 0 is a valid override, so hasOwnProperty is used instead of ||).
function readEdgeOverride(map, u, v) {
  if (!map) return undefined;
  const k1 = `${u}-${v}`;
  const k2 = `${v}-${u}`;
  if (Object.prototype.hasOwnProperty.call(map, k1)) return map[k1];
  if (Object.prototype.hasOwnProperty.call(map, k2)) return map[k2];
  return undefined;
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

// Point-to-segment distance helper
function distToSegmentSquared(p, v, w) {
  const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
  if (l2 === 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return (p.x - (v.x + t * (w.x - v.x))) ** 2 + (p.y - (v.y + t * (w.y - v.y))) ** 2;
}

function distToSegment(p, v, w) {
  return Math.sqrt(distToSegmentSquared(p, v, w));
}

// Detect edge overlap, collinearity, crossing, or touching between two segments
// Returns: { result: true/false, type: 'overlap' | 'touch' | null }
function analyzeEdgeCollision(p1, p2, p3, p4, tolerance = 6.0) {
  // Fast reject: if the bounding boxes are further apart than the tolerance, the segments can neither
  // cross, share an endpoint, nor come within the touching distance (pure speed-up, same results).
  if (Math.min(p1.x, p2.x) - Math.max(p3.x, p4.x) > tolerance ||
      Math.min(p3.x, p4.x) - Math.max(p1.x, p2.x) > tolerance ||
      Math.min(p1.y, p2.y) - Math.max(p3.y, p4.y) > tolerance ||
      Math.min(p3.y, p4.y) - Math.max(p1.y, p2.y) > tolerance) {
    return { result: false, type: null };
  }

  function ccw(A, B, C) {
    return (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  }

  // Identify shared endpoints
  const eps = 1.0;
  const p1_p3 = Math.hypot(p1.x - p3.x, p1.y - p3.y) < eps;
  const p1_p4 = Math.hypot(p1.x - p4.x, p1.y - p4.y) < eps;
  const p2_p3 = Math.hypot(p2.x - p3.x, p2.y - p3.y) < eps;
  const p2_p4 = Math.hypot(p2.x - p4.x, p2.y - p4.y) < eps;
  const shareEndpoint = p1_p3 || p1_p4 || p2_p3 || p2_p4;

  // 1. Independent Segments Crossing
  if (!shareEndpoint) {
    const intersect = (ccw(p1, p3, p4) !== ccw(p2, p3, p4)) && (ccw(p1, p2, p3) !== ccw(p1, p2, p4));
    if (intersect) return { result: true, type: 'overlap' };
  }

  // 2. Adjacent Edges Sharing a Node
  if (shareEndpoint) {
    let common, other1, other2;
    if (p1_p3)      { common = p1; other1 = p2; other2 = p4; }
    else if (p1_p4) { common = p1; other1 = p2; other2 = p3; }
    else if (p2_p3) { common = p2; other1 = p1; other2 = p4; }
    else            { common = p2; other1 = p1; other2 = p3; }

    const angle1 = Math.atan2(other1.y - common.y, other1.x - common.x);
    const angle2 = Math.atan2(other2.y - common.y, other2.x - common.x);
    
    let diff = Math.abs(angle1 - angle2);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;

    // Only flag as collision if the two connected edges leave the shared vertex in the SAME direction (0 deg)
    if (diff < 0.05) {
      return { result: true, type: 'overlap' };
    }
    
    // Normal graph connection (different directions or 180-deg straight line continuation)
    return { result: false, type: null };
  }

  // 3. Proximity / Grazing Check for Independent Segments
  const d1 = distToSegment(p1, p3, p4);
  const d2 = distToSegment(p2, p3, p4);
  const d3 = distToSegment(p3, p1, p2);
  const d4 = distToSegment(p4, p1, p2);

  if (Math.min(d1, d2, d3, d4) < tolerance) {
    return { result: true, type: 'touch' };
  }

  return { result: false, type: null };
}

function edgeSegmentsOverlapOrTouch(p1, p2, p3, p4, tolerance = 6.0) {
  return analyzeEdgeCollision(p1, p2, p3, p4, tolerance).result;
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

// Overlapping Vertices Detection (Consolidates multi-node overlap components)
// options.highlightNew (optional): array of cluster keys already listed in the previous step;
//   overlap clusters not in this array are highlighted as newly detected.
// The cluster keys found in the latest call are stored in window.lastVertexOverlapClusterKeys.
function checkAndListOverlappingVertices(threshold = 16, options = {}) {
  const overlapList = getDomEl("overlapList");
  if (!overlapList) return [];

  overlapList.innerHTML = "";
  const nodeKeys = Object.keys(nodes).filter(k => nodes[k] && nodes[k].style.display !== "none");
  const adjacency = {};
  nodeKeys.forEach(k => { adjacency[k] = []; });

  const rawPairs = [];
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
        adjacency[u].push(v);
        adjacency[v].push(u);
        rawPairs.push({ u, v, dist: Math.round(dist) });
      }
    }
  }

  // Connected components algorithm to group transitive overlaps
  const visited = new Set();
  const clusters = [];

  nodeKeys.forEach(node => {
    if (!visited.has(node) && adjacency[node].length > 0) {
      const cluster = [];
      const queue = [node];
      visited.add(node);

      while (queue.length > 0) {
        const curr = queue.shift();
        cluster.push(curr);
        adjacency[curr].forEach(nbr => {
          if (!visited.has(nbr)) {
            visited.add(nbr);
            queue.push(nbr);
          }
        });
      }
      clusters.push(cluster);
    }
  });

  const clusterKeys = clusters.map(group => group.slice().sort().join(","));
  window.lastVertexOverlapClusterKeys = clusterKeys;

  const previouslySeen = (options && Array.isArray(options.highlightNew)) ? new Set(options.highlightNew) : null;

  if (clusters.length === 0) {
    const li = document.createElement("li");
    li.style.color = "#27ae60";
    li.style.fontWeight = "bold";
    li.textContent = "None";
    overlapList.appendChild(li);
  } else {
    clusters.forEach((group, idx) => {
      let avgX = 0, avgY = 0;
      group.forEach(n => {
        avgX += nodes[n].offsetLeft;
        avgY += nodes[n].offsetTop;
      });
      avgX = Math.round(avgX / group.length);
      avgY = Math.round(avgY / group.length);

      const li = document.createElement("li");
      li.style.padding = "3px 0";
      const nodesFormatted = group.map(n => `<strong style="color: #c0392b;">${n}</strong>`).join(", ");
      const isNew = previouslySeen && !previouslySeen.has(clusterKeys[idx]);
      const newBadge = isNew
        ? ` <span style="background:#f1c40f; color:#2c3e50; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:3px; margin-left:4px;">NEW</span>`
        : "";
      li.innerHTML = `Vertices ${nodesFormatted} overlap at approx (${avgX}, ${avgY})${newBadge}`;
      if (isNew) li.style.background = "#fff3cd";
      overlapList.appendChild(li);
    });
  }

  return rawPairs;
}
window.checkAndListOverlappingVertices = checkAndListOverlappingVertices;

// Overlapping or Touching Edges Detection (Distinguishes touches vs overlaps, prevents duplicate pairs)
// visibleSet (optional): when given, only edges whose BOTH endpoints are in the set are checked.
//   This lets the step-by-step BFS drawer reveal edge collisions incrementally, one step at a time.
// options.highlightNew (optional): array of edge-cluster keys already listed in the previous step;
//   clusters not in this array are highlighted as newly detected.
// The cluster keys found in the latest call are stored in window.lastEdgeOverlapClusterKeys.
function checkAndListEdgeOverlaps(rootNode = null, visibleSet = null, options = {}) {
  const edgeListEl = getDomEl("edgeOverlapList");
  if (!edgeListEl) return [];

  edgeListEl.innerHTML = "";
  if (!rootNode) {
    const startNodeInp = getDomEl("startNode");
    rootNode = (startNodeInp && startNodeInp.value) ? startNodeInp.value.trim().toUpperCase() : Object.keys(graph)[0];
  }

  if (!rootNode || !graph[rootNode]) {
    const li = document.createElement("li");
    li.style.color = "#7f8c8d";
    li.textContent = "None (No edge collisions detected)";
    edgeListEl.appendChild(li);
    return [];
  }

  const alpha = parseFloat(getDomEl("metroAlpha")?.value || "0.75");
  const { linesDrawn: allLines } = generateFamilyMetroCoordinates(rootNode, alpha, 90);

  // Restrict to edges that are currently drawn (both endpoints placed)
  const linesDrawn = visibleSet
    ? allLines.filter(seg => visibleSet.has(seg.u) && visibleSet.has(seg.v))
    : allLines;

  const detectedCollisions = [];
  const processedEdgePairs = new Set();

  for (let i = 0; i < linesDrawn.length; i++) {
    for (let j = i + 1; j < linesDrawn.length; j++) {
      const s1 = linesDrawn[i];
      const s2 = linesDrawn[j];

      // Skip comparing sub-segments belonging to the SAME edge
      if (s1.edgeKey === s2.edgeKey) continue;

      // Ensure each edge pair is evaluated once across all sub-segment combinations
      const pairKey = [s1.edgeKey, s2.edgeKey].sort().join("::");
      if (processedEdgePairs.has(pairKey)) continue;

      const analysis = analyzeEdgeCollision(s1.p1, s1.p2, s2.p1, s2.p2, 6.0);
      if (analysis.result) {
        processedEdgePairs.add(pairKey);
        detectedCollisions.push({
          pairKey: pairKey,
          edge1: s1.edgeKey,
          edge2: s2.edgeKey,
          u1: s1.u, v1: s1.v,
          u2: s2.u, v2: s2.v,
          type: analysis.type
        });
      }
    }
  }

  // Group transitive edge collisions into clusters (connected components),
  // the same way overlapping vertices are grouped (e.g. "Edges B-F, F-H, F-N overlap").
  const edgeAdj = {};
  detectedCollisions.forEach(c => {
    if (!edgeAdj[c.edge1]) edgeAdj[c.edge1] = [];
    if (!edgeAdj[c.edge2]) edgeAdj[c.edge2] = [];
    edgeAdj[c.edge1].push(c.edge2);
    edgeAdj[c.edge2].push(c.edge1);
  });

  const edgeVisited = new Set();
  const edgeClusters = [];
  Object.keys(edgeAdj).forEach(startEdge => {
    if (edgeVisited.has(startEdge)) return;
    const cluster = [];
    const queue = [startEdge];
    edgeVisited.add(startEdge);
    while (queue.length > 0) {
      const curr = queue.shift();
      cluster.push(curr);
      edgeAdj[curr].forEach(nbr => {
        if (!edgeVisited.has(nbr)) {
          edgeVisited.add(nbr);
          queue.push(nbr);
        }
      });
    }
    cluster.sort();
    const clusterSet = new Set(cluster);
    // A cluster is a real overlap/collision if any pair inside it overlaps; otherwise it only touches
    const hasOverlap = detectedCollisions.some(c => clusterSet.has(c.edge1) && c.type !== "touch");
    edgeClusters.push({ edges: cluster, key: cluster.join(","), type: hasOverlap ? "overlap" : "touch" });
  });

  window.lastEdgeOverlapClusterKeys = edgeClusters.map(c => c.key);

  const previouslySeen = Array.isArray(options.highlightNew) ? new Set(options.highlightNew) : null;

  if (edgeClusters.length === 0) {
    const li = document.createElement("li");
    li.style.color = "#27ae60";
    li.style.fontWeight = "bold";
    li.textContent = "None";
    edgeListEl.appendChild(li);
  } else {
    edgeClusters.forEach(cluster => {
      const li = document.createElement("li");
      li.style.padding = "3px 0";
      const isNew = previouslySeen && !previouslySeen.has(cluster.key);
      const newBadge = isNew
        ? ` <span style="background:#f1c40f; color:#2c3e50; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:3px; margin-left:4px;">NEW</span>`
        : "";
      if (cluster.type === "touch") {
        const edgesFormatted = cluster.edges.map(e => `<strong style="color: #e67e22;">${e}</strong>`).join(", ");
        li.innerHTML = `Edges ${edgesFormatted} touch / graze each other${newBadge}`;
      } else {
        const edgesFormatted = cluster.edges.map(e => `<strong style="color: #c0392b;">${e}</strong>`).join(", ");
        li.innerHTML = `Edges ${edgesFormatted} collide / overlap${newBadge}`;
      }
      if (isNew) li.style.background = "#fff3cd";
      edgeListEl.appendChild(li);
    });
  }

  return detectedCollisions;
}
window.checkAndListEdgeOverlaps = checkAndListEdgeOverlaps;

function updateSummaryOfChangesSection(root = null) {
  const summaryList = getDomEl("summaryList");
  if (!summaryList) return;

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
// Layout follows Korst, Pronk & van Wijk (2020), adapted to general (non-binary) trees:
//  * Orientation rule (Sec. 4): female vertices have an even k (horizontal/vertical), male vertices an odd k
//    (diagonal). A link leaves its parent u with first-segment direction k(u) + g, where g = 0 continues the
//    parent's metro line and g = +/-2 is a perpendicular T-junction. If that direction already has the right
//    parity for the child it is a straight link; otherwise a bended link of two equal segments of length
//    d / sqrt(2 + sqrt(2)) is used, the second one turned by s = +/-1 (45 deg). For vertices with more than three
//    children the diagonal offsets g = +/-1, +/-3 are used as extra branch directions.
//  * Every edge leaving a vertex uses its own first-segment direction (no two links share a start segment, and
//    none reuses the incoming line), which removes the "edges leave the vertex in the same direction" overlaps.
//  * Inter-node distance alpha^g (Sec. 4.1) uses the generation of the METRO LINE, not the BFS depth: a child
//    that continues its parent's line (g = 0) keeps the line generation, a side line (T-junction) adds one.
//    A minimum segment length keeps vertex disks apart (the paper's "satisfying" condition).
//  * The binary choices are made generation by generation (breadth first, like Clockwise in Sec. 5) with a
//    small beam search over the joint choices for all children of a vertex, scored lexicographically like
//    C(M) = (c1, c2): first no crossings / vertex conflicts, then a large minimum distance, then free room for
//    the child's own sub-tree, then metro-like preferences, then a large average distance.
const METRO_MIN_SEGMENT_PX = 34;       // floor for alpha^g lengths (node disks are 16 px)
const METRO_ABS_MIN_SEGMENT_PX = 20;   // hard floor even when a sub-tree is shrunk by the fixers
const METRO_NODE_CLEARANCE_PX = 26;    // a new vertex closer than this to another vertex is a conflict
const METRO_LINE_CLEARANCE_PX = 12;    // a vertex closer than this to a foreign line is a conflict
const METRO_BEAM_WIDTH = 4;

function metroEdgeGeometry(p, firstDir, s, len) {
  if (s === 0) {
    const a = getBaseAngle(firstDir);
    return {
      pos: { x: p.x + len * Math.cos(a), y: p.y + len * Math.sin(a) },
      bend: null,
      finalK: firstDir
    };
  }
  const seg = len / Math.sqrt(2 + Math.sqrt(2));
  const a1 = getBaseAngle(firstDir);
  const bend = { x: p.x + seg * Math.cos(a1), y: p.y + seg * Math.sin(a1) };
  const finalK = ((firstDir + s) % 8 + 8) % 8;
  const a2 = getBaseAngle(finalK);
  return {
    pos: { x: bend.x + seg * Math.cos(a2), y: bend.y + seg * Math.sin(a2) },
    bend: bend,
    finalK: finalK
  };
}

function metroBranchPreference(g) {
  const table = { "0": 0, "2": 1, "-2": 1, "1": 2, "-1": 2, "3": 3, "-3": 3, "4": 4, "-4": 4 };
  return table[String(g)] !== undefined ? table[String(g)] : 4;
}

function generateFamilyMetroCoordinates(rootName, alpha = 0.75, baseSegmentLength = 90) {
  const coords = {};
  const orientations = {};
  const localBends = {};
  const linesDrawn = [];

  if (!rootName || !graph[rootName]) {
    return { coords, bends: localBends, linesDrawn, orientations };
  }

  const startX = 350;
  const startY = 220;
  coords[rootName] = { x: startX, y: startY };

  const ov = getActiveOverrides(rootName);
  const rootGender = getNodeGender(rootName, rootName);
  orientations[rootName] = rootGender === "F" ? 2 : 3;

  // Rooted structure of the tree (BFS order = generation by generation)
  const parentOf = {};
  const childrenOf = {};
  const order = [rootName];
  const seen = new Set([rootName]);
  for (let i = 0; i < order.length; i++) {
    const u = order[i];
    childrenOf[u] = [];
    (graph[u] || []).forEach(e => {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        parentOf[e.to] = u;
        childrenOf[u].push(e.to);
        order.push(e.to);
      }
    });
  }
  const subtreeSize = {};
  for (let i = order.length - 1; i >= 0; i--) {
    const u = order[i];
    subtreeSize[u] = 1 + childrenOf[u].reduce((sum, c) => sum + subtreeSize[c], 0);
  }

  const lineGen = { [rootName]: 0 };
  const scaleMul = { [rootName]: ov.subtreeScaleFactors[rootName] || 1 };
  const placedNames = [rootName];

  const samePoint = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

  // Candidate links for child v of u
  function buildOptions(u, v) {
    const uK = orientations[u];
    const vGender = getNodeGender(v, rootName);
    const forcedG = readEdgeOverride(ov.angleOffsets, u, v);
    const forcedTurn = readEdgeOverride(ov.turnDirections, u, v);
    const edgeScale = readEdgeOverride(ov.edgeScaleFactors, u, v) || 1.0;
    const gList = forcedG !== undefined ? [forcedG] : [0, 2, -2, 1, -1, 3, -3, 4];

    const opts = [];
    gList.forEach(g => {
      const firstDir = ((uK + g) % 8 + 8) % 8;
      const lg = g === 0 ? lineGen[u] : lineGen[u] + 1;
      let len = Math.max(baseSegmentLength * Math.pow(alpha, lg), METRO_MIN_SEGMENT_PX);
      len = Math.max(len * edgeScale * scaleMul[u], METRO_ABS_MIN_SEGMENT_PX);

      const straight = (firstDir % 2 === 0) === (vGender === "F");
      let sList;
      if (straight) sList = [0];
      else if (forcedTurn === 1 || forcedTurn === -1) sList = [forcedTurn];
      else sList = [1, -1];

      sList.forEach(sTurn => {
        opts.push({ g, s: sTurn, firstDir, lg, len, pref: metroBranchPreference(g) });
      });
    });
    return opts;
  }

  // Score of placing one link, given committed geometry plus the tentative siblings of this beam state
  // nearNodes / nearSegs: committed geometry within reach of u (everything farther away cannot change the score)
  function scorePlacement(u, v, geom, len, tentative, nearNodes, nearSegs) {
    const uPos = coords[u];
    const pos = geom.pos;
    const newSegs = geom.bend
      ? [{ p1: uPos, p2: geom.bend }, { p1: geom.bend, p2: pos }]
      : [{ p1: uPos, p2: pos }];

    let vertexConf = 0;
    let edgeConf = 0;
    let clearance = Infinity;

    const checkNode = (name, pt) => {
      if (name === u) return;
      const dn = Math.hypot(pt.x - pos.x, pt.y - pos.y);
      if (dn < METRO_NODE_CLEARANCE_PX) vertexConf++;
      if (dn < clearance) clearance = dn;
      newSegs.forEach(sg => {
        if (distToSegment(pt, sg.p1, sg.p2) < METRO_LINE_CLEARANCE_PX) vertexConf++;
      });
    };
    nearNodes.forEach(n => checkNode(n, coords[n]));
    tentative.forEach(it => checkNode(it.v, it.pos));

    const checkSeg = (ex) => {
      const incidentToU = samePoint(ex.p1, uPos) || samePoint(ex.p2, uPos);
      const ds = distToSegment(pos, ex.p1, ex.p2);
      if (ds < METRO_LINE_CLEARANCE_PX) vertexConf++;
      if (!incidentToU && ds * 1.5 < clearance) clearance = ds * 1.5;
      newSegs.forEach(sg => {
        if (analyzeEdgeCollision(sg.p1, sg.p2, ex.p1, ex.p2, 6.0).result) edgeConf++;
      });
    };
    nearSegs.forEach(checkSeg);
    tentative.forEach(it => it.segs.forEach(checkSeg));

    // Free room in front of v for its own sub-tree (one-step look-ahead)
    let roomPenalty = 0;
    if (childrenOf[v] && childrenOf[v].length > 0) {
      const a = getBaseAngle(geom.finalK);
      let room = Infinity;
      [0.6, 1.2].forEach(t => {
        const sp = { x: pos.x + t * len * Math.cos(a), y: pos.y + t * len * Math.sin(a) };
        nearNodes.forEach(n => {
          if (n === u) return;
          room = Math.min(room, Math.hypot(coords[n].x - sp.x, coords[n].y - sp.y));
        });
        tentative.forEach(it => {
          room = Math.min(room, Math.hypot(it.pos.x - sp.x, it.pos.y - sp.y));
        });
        nearSegs.forEach(ex => {
          if (samePoint(ex.p1, uPos) || samePoint(ex.p2, uPos)) return;
          room = Math.min(room, distToSegment(sp, ex.p1, ex.p2));
        });
      });
      if (room === Infinity) room = len;
      const weight = Math.min(subtreeSize[v] - 1, 4) / 2;
      roomPenalty = Math.max(0, len - room) * 15 * weight;
    }

    if (clearance === Infinity) clearance = len;

    return vertexConf * 1e6
      + edgeConf * 1e5
      + Math.max(0, 0.9 * len - clearance) * 40
      + roomPenalty;
    // (preference and average-distance terms are added by the caller)
  }

  for (const u of order) {
    const kids = childrenOf[u]
      .map((c, idx) => ({ c, idx }))
      .sort((a, b) => (subtreeSize[b.c] - subtreeSize[a.c]) || (a.idx - b.idx))
      .map(o => o.c);
    if (kids.length === 0) continue;

    const uPos = coords[u];
    const blocked = new Set();
    if (u !== rootName) blocked.add((orientations[u] + 4) % 8);   // the incoming metro line

    // Spatial pruning: only geometry near u can interact with the new links or the look-ahead samples
    const optsByKid = {};
    let maxLen = 0;
    kids.forEach(v => {
      optsByKid[v] = buildOptions(u, v);
      optsByKid[v].forEach(o => { if (o.len > maxLen) maxLen = o.len; });
    });
    const reach = maxLen * 2.4 + METRO_NODE_CLEARANCE_PX + 10;
    const nearNodes = placedNames.filter(n => Math.hypot(coords[n].x - uPos.x, coords[n].y - uPos.y) <= reach);
    const nearSegs = linesDrawn.filter(ex => distToSegment(uPos, ex.p1, ex.p2) <= reach);

    let beam = [{ cost: 0, items: [] }];

    kids.forEach(v => {
      const opts = optsByKid[v];

      const expand = (enforceDistinct) => {
        const out = [];
        beam.forEach(state => {
          const used = new Set(blocked);
          state.items.forEach(it => used.add(it.firstDir));
          opts.forEach(opt => {
            if (enforceDistinct && used.has(opt.firstDir)) return;
            const geom = metroEdgeGeometry(uPos, opt.firstDir, opt.s, opt.len);
            let score = scorePlacement(u, v, geom, opt.len, state.items, nearNodes, nearSegs);
            score += opt.pref * 12;
            // c2-like term: prefer positions far from the rest of the drawing on average
            let sum = 0, cnt = 0;
            placedNames.forEach(n => { sum += Math.hypot(coords[n].x - geom.pos.x, coords[n].y - geom.pos.y); cnt++; });
            score -= (cnt > 0 ? sum / cnt : 0) * 0.02;

            const segs = geom.bend
              ? [{ p1: uPos, p2: geom.bend }, { p1: geom.bend, p2: geom.pos }]
              : [{ p1: uPos, p2: geom.pos }];
            out.push({
              cost: state.cost + score,
              items: state.items.concat([{
                v, pos: geom.pos, bend: geom.bend, finalK: geom.finalK,
                firstDir: opt.firstDir, lg: opt.lg, segs
              }])
            });
          });
        });
        return out;
      };

      let next = expand(true);
      if (next.length === 0) next = expand(false);   // more than 7 children or conflicting overrides
      next.sort((a, b) => a.cost - b.cost);           // stable sort keeps the result deterministic
      beam = next.slice(0, METRO_BEAM_WIDTH);
    });

    const best = beam[0];
    best.items.forEach(it => {
      const v = it.v;
      coords[v] = it.pos;
      orientations[v] = it.finalK;
      lineGen[v] = it.lg;
      scaleMul[v] = scaleMul[u] * (ov.subtreeScaleFactors[v] || 1);
      placedNames.push(v);

      const canonicalKey = [u, v].sort().join("-");
      if (it.bend) {
        localBends[`${u}-${v}`] = it.bend;
        linesDrawn.push({ p1: uPos, p2: it.bend, edgeKey: canonicalKey, u, v });
        linesDrawn.push({ p1: it.bend, p2: it.pos, edgeKey: canonicalKey, u, v });
      } else {
        linesDrawn.push({ p1: uPos, p2: it.pos, edgeKey: canonicalKey, u, v });
      }
    });
  }

  return { coords, bends: localBends, linesDrawn, orientations };
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
    checkAndListEdgeOverlaps();
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
    checkAndListEdgeOverlaps();
    updateSummaryOfChangesSection();
    return;
  }

  if (resetOverrides) {
    window.metroOverridesByRoot[rootNode] = createEmptyOverrides();
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
  checkAndListEdgeOverlaps(rootNode);
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
    checkAndListEdgeOverlaps();
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
    checkAndListEdgeOverlaps();
    updateSummaryOfChangesSection();
    return;
  }

  if (!window.stepBfsState.active || window.stepBfsState.root !== rootNode || window.stepBfsState.alpha !== alpha) {
    // A fresh step-by-step run starts from exactly the same state as "Run Full Metro Layout"
    // (overrides from earlier fixes are cleared), so both buttons produce the identical drawing.
    window.metroOverridesByRoot[rootNode] = createEmptyOverrides();
    window.metroChangeSummaryByRoot[rootNode] = [];

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
      alpha: alpha,
      stepIndex: 0,
      order: flattenedOrder,
      fullLayers: fullLayers,
      currentDrawnLayers: [],
      coords: coords,
      bends: bends,
      offsets: { x: offsetX, y: offsetY },
      seenEdgeCollisions: [],
      seenVertexOverlaps: []
    };

    if (bfsDisplayElem) bfsDisplayElem.innerHTML = "[]";
    checkAndListOverlappingVertices();
    checkAndListEdgeOverlaps(rootNode, new Set());
    updateSummaryOfChangesSection(rootNode);
  }

  const state = window.stepBfsState;

  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL TREE DRAWN";
    checkAndListOverlappingVertices(16, { highlightNew: state.seenVertexOverlaps || [] });
    checkAndListEdgeOverlaps(rootNode, new Set(state.order), { highlightNew: state.seenEdgeCollisions || [] });
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

  // Incrementally reveal vertex overlaps: only visible vertices are checked,
  // and overlap groups that appeared in this step are highlighted as NEW.
  checkAndListOverlappingVertices(16, { highlightNew: state.seenVertexOverlaps || [] });
  state.seenVertexOverlaps = (window.lastVertexOverlapClusterKeys || []).slice();

  // Incrementally reveal edge collisions: only edges drawn so far are checked,
  // and collisions that appeared in this step are highlighted as NEW.
  checkAndListEdgeOverlaps(rootNode, placedSet, {
    highlightNew: state.seenEdgeCollisions || []
  });
  state.seenEdgeCollisions = (window.lastEdgeOverlapClusterKeys || []).slice();

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

// Layout Evaluation Metric: penalizes vertex overlaps, edge crossings, and touching lines
function evaluateLayoutQuality(rootNode, alpha) {
  const { coords, bends, linesDrawn, orientations } = generateFamilyMetroCoordinates(rootNode, alpha, 90);
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
  const collidingEdgePairs = [];
  const processedEdgePairs = new Set();

  for (let i = 0; i < linesDrawn.length; i++) {
    for (let j = i + 1; j < linesDrawn.length; j++) {
      const s1 = linesDrawn[i];
      const s2 = linesDrawn[j];

      if (s1.edgeKey === s2.edgeKey) continue;

      if (edgeSegmentsOverlapOrTouch(s1.p1, s1.p2, s2.p1, s2.p2, 6.0)) {
        const pairKey = s1.edgeKey < s2.edgeKey ? `${s1.edgeKey}::${s2.edgeKey}` : `${s2.edgeKey}::${s1.edgeKey}`;
        if (processedEdgePairs.has(pairKey)) continue;
        processedEdgePairs.add(pairKey);
        lineIntersections++;
        collidingEdgePairs.push({ s1, s2 });
      }
    }
  }

  const cost = (overlapCount * 100000) + (lineIntersections * 5000) - (minDistance === Infinity ? 0 : minDistance);
  return { cost, overlapCount, lineIntersections, minDistance, overlappingPairs, collidingEdgePairs, coords, bends, linesDrawn, orientations };
}

// --- 6. Shared helpers for the overlap fixers ---
// The fixers work like the paper's suggested post-processing ("disentangled or beautified ... through
// flipping sub-trees"): they force the binary choices (branch side g, bend sign s) of one link at a time and let
// the layout algorithm re-place everything below it, and as a last resort they shrink a whole sub-tree locally
// (Lemma 4.3: a small enough shrinking factor always separates neighbouring sub-trees).
// Gender is never changed: the generalized orientation rule allows any branch direction for either gender.
// Evaluation budget of one fixer run (deterministic; smaller for big trees because each evaluation costs more)
function metroFixBudget() {
  const n = Object.keys(graph).length || 1;
  return Math.max(150, Math.min(500, Math.round(25000 / n)));
}

function buildMetroParentMap(rootNode) {
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
  return parentMap;
}

// All (g, s) combinations worth trying for the link parent -> target. "undefined" means: leave the choice to
// the layout algorithm. Turn variants are skipped when the chosen direction gives a straight link.
function buildMetroFixTrials(rootNode, parentNode, targetNode, orientations) {
  const gChoices = [undefined, 2, -2, 0, 1, -1, 3, -3];
  if (parentNode === rootNode) gChoices.push(4);
  const targetIsF = getNodeGender(targetNode, rootNode) === "F";
  const parentK = orientations && orientations[parentNode] !== undefined ? orientations[parentNode] : 0;

  const trials = [];
  gChoices.forEach(g => {
    let turnChoices = [undefined, 1, -1];
    if (g !== undefined) {
      const firstDir = ((parentK + g) % 8 + 8) % 8;
      const straight = (firstDir % 2 === 0) === targetIsF;
      if (straight) turnChoices = [undefined];
    }
    turnChoices.forEach(t => {
      if (g === undefined && t === undefined) return;   // identical to the current layout
      trials.push({ g, t });
    });
  });
  return trials;
}

function describeMetroFixTrial(g, t) {
  const parts = [];
  if (g === 0) parts.push("continued on parent's metro line");
  else if (g === 2) parts.push("branched as T-junction (+90°)");
  else if (g === -2) parts.push("branched as T-junction (-90°)");
  else if (g === 4) parts.push("placed on opposite side of parent (180°)");
  else if (g !== undefined) parts.push(`branched at ${g * 45}°`);
  if (t !== undefined) parts.push(`bend set to ${t > 0 ? "+45°" : "-45°"}`);
  return parts.join(", ");
}

function applyMetroFixTrial(baseOverrides, edgeKey, g, t) {
  const trial = JSON.parse(JSON.stringify(baseOverrides));
  if (!trial.subtreeScaleFactors) trial.subtreeScaleFactors = {};
  if (g !== undefined) trial.angleOffsets[edgeKey] = g;
  else delete trial.angleOffsets[edgeKey];
  if (t !== undefined) trial.turnDirections[edgeKey] = t;
  else delete trial.turnDirections[edgeKey];
  return trial;
}

// --- 6A. Fix Vertex Overlaps ---
function fixMetroOverlaps(alpha = 0.75) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");

  let rootNode = (startNodeInp && startNodeInp.value && graph[startNodeInp.value.trim().toUpperCase()])
    ? startNodeInp.value.trim().toUpperCase()
    : Object.keys(graph)[0];

  if (!rootNode) return;

  runFamilyMetroMapLayout(alpha, false);
  let evalRes = evaluateLayoutQuality(rootNode, alpha);

  if (evalRes.overlapCount === 0) {
    if (statusElem) statusElem.innerText = "No overlapping vertices detected. Layout is optimal.";
    window.metroChangeSummaryByRoot[rootNode] = ["Checked graph: No overlapping vertices were found."];
    updateSummaryOfChangesSection(rootNode);
    return;
  }

  const parentMap = buildMetroParentMap(rootNode);

  let rootOverrides = getActiveOverrides(rootNode);
  let bestOverrides = JSON.parse(JSON.stringify(rootOverrides));
  let currentCost = evalRes.cost;
  let summaryLog = [];
  let evaluations = 0;
  const maxEvaluations = metroFixBudget();
  const budgetLeft = () => evaluations < maxEvaluations;
  const tryOverrides = (ovr) => {
    evaluations++;
    window.metroOverridesByRoot[rootNode] = ovr;
    return evaluateLayoutQuality(rootNode, alpha);
  };

  const maxOuterRounds = 16;
  let outerRound = 0;

  while (evalRes.overlapCount > 0 && outerRound < maxOuterRounds && budgetLeft()) {
    outerRound++;
    let progressMade = false;

    // Overlapping vertices, their parents and grandparents (re-routing an ancestor moves the whole sub-tree)
    const targetSet = new Set();
    evalRes.overlappingPairs.forEach(pair => {
      [pair.u, pair.v].forEach(n => {
        let x = n;
        for (let depth = 0; depth < 3 && x && x !== rootNode; depth++) {
          targetSet.add(x);
          x = parentMap[x];
        }
      });
    });

    const candidateTargets = Array.from(targetSet);

    for (let targetNode of candidateTargets) {
      if (!budgetLeft()) break;
      const parentNode = parentMap[targetNode];
      if (!parentNode) continue;

      const edgeKey = `${parentNode}-${targetNode}`;
      let nodeBestOverrides = null;
      let nodeBestCost = currentCost;
      let nodeBestAction = null;

      const trials = buildMetroFixTrials(rootNode, parentNode, targetNode, evalRes.orientations);
      for (let trialDef of trials) {
        if (!budgetLeft()) break;
        const trialOverrides = applyMetroFixTrial(bestOverrides, edgeKey, trialDef.g, trialDef.t);
        const trialEval = tryOverrides(trialOverrides);

        if (trialEval.cost < nodeBestCost) {
          nodeBestCost = trialEval.cost;
          nodeBestOverrides = trialOverrides;
          nodeBestAction = `Relocated vertex <strong>${targetNode}</strong>: ${describeMetroFixTrial(trialDef.g, trialDef.t) || "re-routed"}.`;
        }
      }

      if (nodeBestOverrides && nodeBestCost < currentCost) {
        bestOverrides = nodeBestOverrides;
        currentCost = nodeBestCost;
        evalRes = tryOverrides(bestOverrides);
        if (nodeBestAction) summaryLog.push(nodeBestAction);
        progressMade = true;
        if (evalRes.overlapCount === 0) break;
      }
    }

    // Fallback 1: change the length of a single link
    if (!progressMade && evalRes.overlapCount > 0) {
      for (let targetNode of candidateTargets) {
        if (!budgetLeft()) break;
        const parentNode = parentMap[targetNode];
        if (!parentNode) continue;
        const edgeKey = `${parentNode}-${targetNode}`;

        for (let scale of [0.86, 1.14, 0.76, 1.3]) {
          const trialOverrides = JSON.parse(JSON.stringify(bestOverrides));
          trialOverrides.edgeScaleFactors[edgeKey] = scale;
          const trialEval = tryOverrides(trialOverrides);

          if (trialEval.cost < currentCost) {
            currentCost = trialEval.cost;
            bestOverrides = trialOverrides;
            evalRes = trialEval;
            summaryLog.push(`Scaled branch (<strong>${parentNode} → ${targetNode}</strong>) by <strong>${scale}×</strong> to clear vertex overlap.`);
            progressMade = true;
            break;
          }
        }
        if (progressMade) break;
      }
    }

    // Fallback 2 (Lemma 4.3): shrink a whole sub-tree with a local shrinking factor
    if (!progressMade && evalRes.overlapCount > 0) {
      for (let targetNode of candidateTargets.concat(candidateTargets.map(n => parentMap[n]).filter(Boolean))) {
        if (!budgetLeft()) break;
        const current = (bestOverrides.subtreeScaleFactors || {})[targetNode] || 1;
        for (let factor of [0.8, 0.65, 0.5]) {
          const trialOverrides = JSON.parse(JSON.stringify(bestOverrides));
          if (!trialOverrides.subtreeScaleFactors) trialOverrides.subtreeScaleFactors = {};
          trialOverrides.subtreeScaleFactors[targetNode] = +(current * factor).toFixed(3);
          const trialEval = tryOverrides(trialOverrides);

          if (trialEval.cost < currentCost) {
            currentCost = trialEval.cost;
            bestOverrides = trialOverrides;
            evalRes = trialEval;
            summaryLog.push(`Shrunk sub-tree below <strong>${targetNode}</strong> by local shrinking factor <strong>${factor}</strong> to clear vertex overlap.`);
            progressMade = true;
            break;
          }
        }
        if (progressMade) break;
      }
    }

    if (!progressMade) break;
  }

  window.metroOverridesByRoot[rootNode] = bestOverrides;

  const finalEval = evaluateLayoutQuality(rootNode, alpha);
  if (finalEval.overlapCount > 0) {
    const unresolvableNodes = new Set();
    finalEval.overlappingPairs.forEach(p => {
      unresolvableNodes.add(p.u);
      unresolvableNodes.add(p.v);
    });
    unresolvableNodes.forEach(node => {
      summaryLog.push(`<span style="color:#c0392b;">Could not resolve vertex overlap for <strong>${node}</strong>: no collision-free octilinear sector available.</span>`);
    });
  }

  window.metroChangeSummaryByRoot[rootNode] = summaryLog.length > 0 ? summaryLog : ["Checked all radial alternatives; vertex layout cannot be improved further."];

  runFamilyMetroMapLayout(alpha, false);
  checkAndListOverlappingVertices();
  checkAndListEdgeOverlaps(rootNode);
  updateSummaryOfChangesSection(rootNode);

  if (statusElem) {
    if (finalEval.overlapCount === 0) {
      statusElem.innerText = `All vertex overlaps fixed! (Applied ${summaryLog.length} geometric adjustments).`;
    } else {
      statusElem.innerText = `Partial resolution applied. Remaining overlapping vertices: ${finalEval.overlapCount}.`;
    }
  }
}
window.fixMetroOverlaps = fixMetroOverlaps;

// --- 6B. Fix Edge Overlaps, Grazing, and Touching Lines ---
function fixMetroEdgeOverlaps(alpha = 0.75) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");

  let rootNode = (startNodeInp && startNodeInp.value && graph[startNodeInp.value.trim().toUpperCase()])
    ? startNodeInp.value.trim().toUpperCase()
    : Object.keys(graph)[0];

  if (!rootNode) return;

  runFamilyMetroMapLayout(alpha, false);
  let evalRes = evaluateLayoutQuality(rootNode, alpha);

  if (evalRes.lineIntersections === 0) {
    if (statusElem) statusElem.innerText = "No edge collisions, touching lines, or overlaps detected.";
    window.metroChangeSummaryByRoot[rootNode] = ["Checked graph: No overlapping or touching edges found."];
    updateSummaryOfChangesSection(rootNode);
    return;
  }

  const parentMap = buildMetroParentMap(rootNode);

  let rootOverrides = getActiveOverrides(rootNode);
  let bestOverrides = JSON.parse(JSON.stringify(rootOverrides));
  let currentCost = evalRes.cost;
  let summaryLog = [];
  let evaluations = 0;
  const maxEvaluations = metroFixBudget();
  const budgetLeft = () => evaluations < maxEvaluations;
  const tryOverrides = (ovr) => {
    evaluations++;
    window.metroOverridesByRoot[rootNode] = ovr;
    return evaluateLayoutQuality(rootNode, alpha);
  };

  const maxOuterRounds = 16;
  let outerRound = 0;

  while (evalRes.lineIntersections > 0 && outerRound < maxOuterRounds && budgetLeft()) {
    outerRound++;
    let progressMade = false;

    // Child endpoints of colliding edges, plus their parents and grandparents
    const targetSet = new Set();
    evalRes.collidingEdgePairs.forEach(pair => {
      [pair.s1, pair.s2].forEach(sg => {
        const child = parentMap[sg.v] === sg.u ? sg.v : sg.u;
        let x = child;
        for (let depth = 0; depth < 3 && x && x !== rootNode; depth++) {
          targetSet.add(x);
          x = parentMap[x];
        }
      });
    });

    const candidateTargets = Array.from(targetSet);

    for (let targetNode of candidateTargets) {
      if (!budgetLeft()) break;
      const parentNode = parentMap[targetNode];
      if (!parentNode) continue;

      const edgeKey = `${parentNode}-${targetNode}`;
      let nodeBestOverrides = null;
      let nodeBestCost = currentCost;
      let nodeBestAction = null;

      const trials = buildMetroFixTrials(rootNode, parentNode, targetNode, evalRes.orientations);
      for (let trialDef of trials) {
        if (!budgetLeft()) break;
        const trialOverrides = applyMetroFixTrial(bestOverrides, edgeKey, trialDef.g, trialDef.t);
        const trialEval = tryOverrides(trialOverrides);

        if (trialEval.cost < nodeBestCost && trialEval.overlapCount <= evalRes.overlapCount) {
          nodeBestCost = trialEval.cost;
          nodeBestOverrides = trialOverrides;
          nodeBestAction = `Resolved edge collision on (<strong>${parentNode} → ${targetNode}</strong>): ${describeMetroFixTrial(trialDef.g, trialDef.t) || "re-routed"}.`;
        }
      }

      if (nodeBestOverrides && nodeBestCost < currentCost) {
        bestOverrides = nodeBestOverrides;
        currentCost = nodeBestCost;
        evalRes = tryOverrides(bestOverrides);
        if (nodeBestAction) summaryLog.push(nodeBestAction);
        progressMade = true;
        if (evalRes.lineIntersections === 0) break;
      }
    }

    // Fallback 1: change the length of a single link
    if (!progressMade && evalRes.lineIntersections > 0) {
      for (let targetNode of candidateTargets) {
        if (!budgetLeft()) break;
        const parentNode = parentMap[targetNode];
        if (!parentNode) continue;
        const edgeKey = `${parentNode}-${targetNode}`;

        for (let scale of [0.88, 1.12, 0.78, 1.3]) {
          const trialOverrides = JSON.parse(JSON.stringify(bestOverrides));
          trialOverrides.edgeScaleFactors[edgeKey] = scale;
          const trialEval = tryOverrides(trialOverrides);

          if (trialEval.cost < currentCost && trialEval.overlapCount <= evalRes.overlapCount) {
            currentCost = trialEval.cost;
            bestOverrides = trialOverrides;
            evalRes = trialEval;
            summaryLog.push(`Shortened edge (<strong>${parentNode} → ${targetNode}</strong>) by factor <strong>${scale}×</strong> to prevent touching adjacent line.`);
            progressMade = true;
            break;
          }
        }
        if (progressMade) break;
      }
    }

    // Fallback 2 (Lemma 4.3): shrink a whole sub-tree with a local shrinking factor
    if (!progressMade && evalRes.lineIntersections > 0) {
      for (let targetNode of candidateTargets.concat(candidateTargets.map(n => parentMap[n]).filter(Boolean))) {
        if (!budgetLeft()) break;
        const current = (bestOverrides.subtreeScaleFactors || {})[targetNode] || 1;
        for (let factor of [0.8, 0.65, 0.5]) {
          const trialOverrides = JSON.parse(JSON.stringify(bestOverrides));
          if (!trialOverrides.subtreeScaleFactors) trialOverrides.subtreeScaleFactors = {};
          trialOverrides.subtreeScaleFactors[targetNode] = +(current * factor).toFixed(3);
          const trialEval = tryOverrides(trialOverrides);

          if (trialEval.cost < currentCost && trialEval.overlapCount <= evalRes.overlapCount) {
            currentCost = trialEval.cost;
            bestOverrides = trialOverrides;
            evalRes = trialEval;
            summaryLog.push(`Shrunk sub-tree below <strong>${targetNode}</strong> by local shrinking factor <strong>${factor}</strong> to clear edge collision.`);
            progressMade = true;
            break;
          }
        }
        if (progressMade) break;
      }
    }

    if (!progressMade) break;
  }

  window.metroOverridesByRoot[rootNode] = bestOverrides;

  const finalEval = evaluateLayoutQuality(rootNode, alpha);
  if (finalEval.lineIntersections > 0) {
    summaryLog.push(`<span style="color:#c0392b;">Partial edge resolution: ${finalEval.lineIntersections} edge segment collisions/touching lines remain tightly bounded.</span>`);
  }

  window.metroChangeSummaryByRoot[rootNode] = summaryLog.length > 0 ? summaryLog : ["Checked all edge orientation paths; layout cannot clear more line overlaps."];

  runFamilyMetroMapLayout(alpha, false);
  checkAndListOverlappingVertices();
  checkAndListEdgeOverlaps(rootNode);
  updateSummaryOfChangesSection(rootNode);

  if (statusElem) {
    if (finalEval.lineIntersections === 0) {
      statusElem.innerText = `All edge overlaps/touching lines resolved! (${summaryLog.length} adjustments applied).`;
    } else {
      statusElem.innerText = `Edge overlap resolution applied. Remaining collisions: ${finalEval.lineIntersections}.`;
    }
  }
}
window.fixMetroEdgeOverlaps = fixMetroEdgeOverlaps;

// --- 7. Save Canvas as JPG ---
function saveDrawingAsJPG() {
  const canvasEl = getDomEl("canvas");
  const svgEl = getDomEl("edges");
  if (!canvasEl || !svgEl) return;

  const nodeRadius = 8;
  const padding = 40;

  const visibleNodes = Object.keys(nodes).filter(
    k => nodes[k] && nodes[k].style.display !== "none"
  );

  if (visibleNodes.length === 0) {
    alert("Nothing to save: no vertices are currently visible.");
    return;
  }

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

  const exportWidth = Math.ceil((maxX - minX) + padding * 2);
  const exportHeight = Math.ceil((maxY - minY) + padding * 2);
  const shiftX = padding - minX;
  const shiftY = padding - minY;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = exportWidth;
  exportCanvas.height = exportHeight;
  const ctx = exportCanvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, exportWidth, exportHeight);

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