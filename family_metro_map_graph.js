// family_metro_map_graph.js
// Family Metro Map layout for GENERAL graphs (cycles allowed, possibly disconnected), at most 8 neighbours per
// vertex. A BFS spanning tree is drawn exactly like the tree version (familymetromap.js); every remaining
// ("cycle") edge is drawn as a London-Underground-style metro link: straight along one of the 8 directions, or
// with exactly one 45-degree bend. Cycle edges are routed while the layout is built, so the beam search places
// vertices where their cycle edges can close without crossings. For a tree the result is identical to the tree
// version.

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
  tracker: null
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

// --- 1. Graph Verification ---
// Any graph is allowed (cycles, several components) as long as every vertex has at most 8 neighbours:
// a metro map has 8 directions, and every edge at a vertex needs its own direction.
const METRO_MAX_DEGREE = 8;

function verifyGraphForMetro() {
  const nodeKeys = Object.keys(graph);
  if (nodeKeys.length === 0) return { isValid: false, reason: "Graph is empty. Please add or import nodes first." };

  const tooMany = nodeKeys.filter(u => (graph[u] || []).length > METRO_MAX_DEGREE);
  if (tooMany.length > 0) {
    const list = tooMany.slice(0, 8).map(u => `${u} (${graph[u].length})`).join(", ");
    return {
      isValid: false,
      reason: `Every vertex may have at most ${METRO_MAX_DEGREE} neighbours (one per metro direction). ` +
              `Too many neighbours: ${list}${tooMany.length > 8 ? ", ..." : ""}.`
    };
  }

  const loops = nodeKeys.filter(u => (graph[u] || []).some(e => e.to === u));
  if (loops.length > 0) {
    return { isValid: false, reason: `Self-loops are not supported (vertex ${loops.slice(0, 5).join(", ")}).` };
  }
  return { isValid: true };
}

// Roots of the BFS spanning forest: the chosen root first, then the first unvisited vertex of every other
// connected component (in vertex order).
function metroComponentRoots(rootName) {
  const roots = [];
  const seen = new Set();
  const visit = r => {
    roots.push(r);
    seen.add(r);
    const queue = [r];
    for (let i = 0; i < queue.length; i++) {
      (graph[queue[i]] || []).forEach(e => {
        if (!seen.has(e.to)) {
          seen.add(e.to);
          queue.push(e.to);
        }
      });
    }
  };
  if (rootName && graph[rootName]) visit(rootName);
  Object.keys(graph).forEach(v => { if (!seen.has(v)) visit(v); });
  return roots;
}

// True if the graph has at least one cycle (|E| > |V| - number of components)
function metroGraphHasCycle() {
  const V = Object.keys(graph).length;
  if (V === 0) return false;
  let degreeSum = 0;
  for (const u in graph) degreeSum += (graph[u] || []).length;
  const components = metroComponentRoots(Object.keys(graph)[0]).length;
  return degreeSum / 2 > V - components;
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
const METRO_NO_COLLISION = Object.freeze({ result: false, type: null });

function analyzeEdgeCollision(p1, p2, p3, p4, tolerance = 6.0) {
  // Fast reject: if the bounding boxes are further apart than the tolerance, the segments can neither
  // cross, share an endpoint, nor come within the touching distance (pure speed-up, same results).
  if (Math.min(p1.x, p2.x) - Math.max(p3.x, p4.x) > tolerance ||
      Math.min(p3.x, p4.x) - Math.max(p1.x, p2.x) > tolerance ||
      Math.min(p1.y, p2.y) - Math.max(p3.y, p4.y) > tolerance ||
      Math.min(p3.y, p4.y) - Math.max(p1.y, p2.y) > tolerance) {
    return METRO_NO_COLLISION;
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
// BFS layers of the spanning forest: layer d holds every vertex at depth d below its component root
// (the chosen root's component first). For a connected graph these are the ordinary BFS layers.
function computeBFSLayers(rootName) {
  if (!graph[rootName]) return [];
  const layers = [];
  const visited = new Set();
  metroComponentRoots(rootName).forEach(r => {
    visited.add(r);
    let currentLayer = [r];
    let depth = 0;
    while (currentLayer.length > 0) {
      if (!layers[depth]) layers[depth] = [];
      currentLayer.forEach(v => layers[depth].push(v));
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
      depth++;
    }
  });
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

  const keyRank = {};
  nodeKeys.forEach((k, i) => { keyRank[k] = i; });
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
      cluster.sort((a, b) => keyRank[a] - keyRank[b]);   // vertices of a group in input order
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
  const { linesDrawn: allLines } = generateFamilyMetroCoordinates(rootNode, alpha, metroBaseSegmentLength());

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
  Object.keys(edgeAdj).sort().forEach(startEdge => {
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

// --- 3. Graph Traversal & Metro Map Coordinate Solver ---
// Spanning tree: BFS from the root (every other component from its own first vertex). Tree edges are placed
// exactly as in the tree version below; every other edge (a "cycle edge") is routed as a metro link at the
// moment its second endpoint is placed (see metroLayoutComponent and metroCycleEdgeShapes).
// Tree-edge rules (unchanged):
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
// Weights of the soft terms of a placement's score (the hard terms, vertex and edge conflicts, always dominate):
// clear = keep 0.9 x link length free around the new vertex, room = free room for the child's sub-tree,
// pref = metro preferences (continue the line, then T-junctions, ...), avg = stay far from the drawing on average.
// The layout search (section 3b) also tries a few other weightings; none of them changes an edge length.
const METRO_DEFAULT_WEIGHTS = { clear: 40, room: 1, pref: 12, avg: 0.02 };

// Starting (base) edge length of the root's metro line, chosen by tree size.
//   up to 100 vertices : 90 px (unchanged)
//   101-125 : 120 px   126-150 : 150 px   151-175 : 180 px   176-200 : 210 px
//   201-225 : 240 px   226-250 : 270 px   251-275 : 300 px   276-300 : 330 px
// i.e. +30 px for every further band of 25 vertices. Larger trees need more room, because the
// clearance thresholds (26 / 12 / 6 px) and the 34 px minimum link length do not grow with the tree.
const METRO_BASE_SEGMENT_PX = 90;
const METRO_BASE_STEP_PX = 30;          // added per band of 25 vertices above 100
const METRO_BASE_BAND_SIZE = 25;
const METRO_BASE_MAX_BANDS = 8;         // 276-300 vertices (the largest drawable tree)

function metroBaseSegmentLength() {
  const n = (typeof graph !== "undefined" && graph) ? Object.keys(graph).length : 0;
  if (n <= 100) return METRO_BASE_SEGMENT_PX;
  const band = Math.min(METRO_BASE_MAX_BANDS, Math.ceil((n - 100) / METRO_BASE_BAND_SIZE));
  return METRO_BASE_SEGMENT_PX + METRO_BASE_STEP_PX * band;
}

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

// --- Cycle edges: London-Underground-style links between two given points ---
// A cycle edge joins two vertices that are both already placed, so its shape follows from their positions.
// Every direction a -> b lies inside one 45-degree sector between two neighbouring metro directions d1, d2,
// so the edge is either straight (a -> b is exactly one of the 8 directions) or has exactly one 45-degree bend
// (interior angle 135 degrees): first along d1 then d2, or first along d2 then d1. These are the only shapes.
const METRO_CYCLE_BEND_PENALTY = 12;          // same scale as the branch preference of tree links
const METRO_CYCLE_SHORT_SEGMENT_PX = 16;      // a bend closer than this to a vertex is penalised
const METRO_COMPONENT_GAP_PX = 120;           // gap between the drawings of separate components
const METRO_CYCLE_LENGTH_WEIGHT = 0;          // cost per px of cycle-edge length (keeps cycles short)
const METRO_CYCLE_PULL_WEIGHT = 1;            // cost per px between v and the placed parent of a not-yet-placed cycle neighbour

function metroCycleEdgeShapes(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return [];

  let ang = Math.atan2(dy, dx);
  if (ang < 0) ang += 2 * Math.PI;
  const sector = ang / (Math.PI / 4);
  const k = Math.floor(sector);
  const d1 = ((k % 8) + 8) % 8;
  const d2 = (d1 + 1) % 8;
  const e1 = { x: Math.cos(d1 * Math.PI / 4), y: Math.sin(d1 * Math.PI / 4) };
  const e2 = { x: Math.cos(d2 * Math.PI / 4), y: Math.sin(d2 * Math.PI / 4) };
  const det = e1.x * e2.y - e1.y * e2.x;            // sin(45 deg)
  const s1 = (dx * e2.y - dy * e2.x) / det;         // length along d1
  const s2 = (e1.x * dy - e1.y * dx) / det;         // length along d2

  // Straight link (a sub-pixel second segment is invisible, so it counts as straight)
  if (Math.min(s1, s2) < 1.0) {
    const d = s1 >= s2 ? d1 : d2;
    return [{ segs: [{ p1: a, p2: b }], bend: null, portFrom: d, portTo: (d + 4) % 8, minSeg: L, length: L }];
  }

  const bendA = { x: a.x + s1 * e1.x, y: a.y + s1 * e1.y };   // first d1, then d2
  const bendB = { x: a.x + s2 * e2.x, y: a.y + s2 * e2.y };   // first d2, then d1
  const minSeg = Math.min(s1, s2);
  return [
    { segs: [{ p1: a, p2: bendA }, { p1: bendA, p2: b }], bend: bendA, portFrom: d1, portTo: (d2 + 4) % 8, minSeg, length: s1 + s2 },
    { segs: [{ p1: a, p2: bendB }, { p1: bendB, p2: b }], bend: bendB, portFrom: d2, portTo: (d1 + 4) % 8, minSeg, length: s1 + s2 }
  ];
}

function metroBoundingBox(coords, bends) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = p => {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  };
  Object.keys(coords).forEach(n => add(coords[n]));
  Object.keys(bends).forEach(k => add(bends[k]));
  return { minX, minY, maxX, maxY };
}

// layoutConfig (optional): { base, beamWidth, alphaFactor } chosen by the layout search (section 3b).
// When it is not passed, the cached result of that search is used where it applies (trees with more than
// 100 vertices, graphs with cycles); trees with at most 100 vertices always use the original settings
// (90 px, beam width 4, the given alpha), so trees are drawn exactly as by the tree version.
// trace (optional, used by the automatic repair to save time): trace.record receives the links chosen at every
// vertex; with trace.replay = { decisions, until }, vertices placed before `until` (and every vertex of another
// component) reuse the recorded links instead of searching again (valid when only links leaving `until` changed).
function generateFamilyMetroCoordinates(rootName, alpha = 0.75, baseSegmentLength = metroBaseSegmentLength(), layoutConfig, trace) {
  const coords = {};
  const orientations = {};
  const localBends = {};
  const linesDrawn = [];

  if (!rootName || !graph[rootName]) {
    return { coords, bends: localBends, linesDrawn, orientations };
  }

  const largeCfg = (layoutConfig !== undefined) ? layoutConfig : getMetroLargeTreeConfig(rootName, alpha);
  let beamWidth = METRO_BEAM_WIDTH;
  let weights = METRO_DEFAULT_WEIGHTS;
  if (largeCfg) {
    baseSegmentLength = largeCfg.base;
    alpha = alpha * largeCfg.alphaFactor;
    beamWidth = largeCfg.beamWidth;
    if (largeCfg.weights) weights = largeCfg.weights;
  }

  const ov = getActiveOverrides(rootName);
  const compRoots = metroComponentRoots(rootName);

  // Connected graph: one component, drawn exactly where the tree version draws it
  if (compRoots.length === 1) {
    return metroLayoutComponent(rootName, rootName, alpha, baseSegmentLength, beamWidth, ov, weights, trace);
  }

  // Several components: each is laid out on its own and placed to the right of the previous ones
  let box = null;
  compRoots.forEach((compRoot, idx) => {
    const part = metroLayoutComponent(compRoot, rootName, alpha, baseSegmentLength, beamWidth, ov, weights, trace);
    let dx = 0, dy = 0;
    if (idx > 0) {
      const pb = metroBoundingBox(part.coords, part.bends);
      dx = box.maxX + METRO_COMPONENT_GAP_PX - pb.minX;
      dy = box.minY - pb.minY;
    }
    const moved = {};
    const shift = p => {
      if (!moved[p.x + "," + p.y]) moved[p.x + "," + p.y] = { x: p.x + dx, y: p.y + dy };
      return moved[p.x + "," + p.y];
    };
    Object.keys(part.coords).forEach(n => {
      coords[n] = shift(part.coords[n]);
      orientations[n] = part.orientations[n];
    });
    Object.keys(part.bends).forEach(key => { localBends[key] = shift(part.bends[key]); });
    part.linesDrawn.forEach(sg => linesDrawn.push(Object.assign({}, sg, { p1: shift(sg.p1), p2: shift(sg.p2) })));
    box = metroBoundingBox(coords, localBends);
  });

  return { coords, bends: localBends, linesDrawn, orientations };
}

// Layout of one connected component, rooted at rootName. mainRoot is the user's root (overrides and gender
// flips are stored under it). Tree edges of the BFS spanning tree are placed by the beam search exactly as in
// the tree version; cycle edges are routed when their second endpoint is placed, and their cost (crossings,
// passing through vertices, bends) is part of that endpoint's placement score.
function metroLayoutComponent(rootName, mainRoot, alpha, baseSegmentLength, beamWidth, ov, W = METRO_DEFAULT_WEIGHTS, trace) {
  const coords = {};
  const orientations = {};
  const localBends = {};
  const linesDrawn = [];
  // Spatial index of linesDrawn (uniform grid), so a cycle route is only checked against lines near it
  const GRID_CELL = 80;
  const lineGrid = new Map();
  let lineStamp = 0;
  const lineSeen = [];
  function addLine(sg) {
    const id = linesDrawn.length;
    linesDrawn.push(sg);
    lineSeen.push(0);
    const cx0 = Math.floor((Math.min(sg.p1.x, sg.p2.x) - 6) / GRID_CELL), cx1 = Math.floor((Math.max(sg.p1.x, sg.p2.x) + 6) / GRID_CELL);
    const cy0 = Math.floor((Math.min(sg.p1.y, sg.p2.y) - 6) / GRID_CELL), cy1 = Math.floor((Math.max(sg.p1.y, sg.p2.y) + 6) / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cx + "," + cy;
        let cell = lineGrid.get(key);
        if (!cell) { cell = []; lineGrid.set(key, cell); }
        cell.push(id);
      }
    }
  }
  // Calls fn once for every drawn line whose (grown) bounding box can meet one of the boxes
  function forLinesNear(boxes, fn) {
    lineStamp++;
    for (const b of boxes) {
      const cx0 = Math.floor(b.x0 / GRID_CELL), cx1 = Math.floor(b.x1 / GRID_CELL);
      const cy0 = Math.floor(b.y0 / GRID_CELL), cy1 = Math.floor(b.y1 / GRID_CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const cell = lineGrid.get(cx + "," + cy);
          if (!cell) continue;
          for (const id of cell) {
            if (lineSeen[id] === lineStamp) continue;
            lineSeen[id] = lineStamp;
            fn(linesDrawn[id]);
          }
        }
      }
    }
  }

  const startX = 350;
  const startY = 220;
  coords[rootName] = { x: startX, y: startY };

  const rootGender = getNodeGender(rootName, mainRoot);
  orientations[rootName] = rootGender === "F" ? 2 : 3;

  // BFS spanning tree of the component (BFS order = generation by generation)
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

  // Cycle-edge neighbours: graph neighbours that are neither the BFS parent nor a BFS child
  const cycleNbrs = {};
  order.forEach(x => {
    cycleNbrs[x] = (graph[x] || []).map(e => e.to).filter(y => parentOf[x] !== y && parentOf[y] !== x);
  });

  const lineGen = { [rootName]: 0 };
  const scaleMul = { [rootName]: ov.subtreeScaleFactors[rootName] || 1 };
  const placedNames = [rootName];
  const placedSet = new Set([rootName]);
  // Directions already used at each placed vertex (incoming link, links to children, cycle edges)
  const usedPorts = { [rootName]: new Set() };

  const samePoint = (a, b) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  const nearSegment = (pt, sg, limit) => {
    if (pt.x < Math.min(sg.p1.x, sg.p2.x) - limit || pt.x > Math.max(sg.p1.x, sg.p2.x) + limit ||
        pt.y < Math.min(sg.p1.y, sg.p2.y) - limit || pt.y > Math.max(sg.p1.y, sg.p2.y) + limit) return false;
    return distToSegment(pt, sg.p1, sg.p2) < limit;
  };

  // Candidate links for child v of u
  function buildOptions(u, v) {
    const uK = orientations[u];
    const vGender = getNodeGender(v, mainRoot);
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

  // Score of placing one link = part from the committed geometry (the same for every beam state, so it is
  // computed once per candidate link) + part from the tentative siblings of the beam state.
  // nearNodes / nearSegs: committed geometry within reach of u (everything farther away cannot change the score)
  function committedPart(u, v, geom, len, nearNodes, nearSegs) {
    const uPos = coords[u];
    const pos = geom.pos;
    const newSegs = geom.bend
      ? [{ p1: uPos, p2: geom.bend }, { p1: geom.bend, p2: pos }]
      : [{ p1: uPos, p2: pos }];
    const part = { vertexConf: 0, edgeConf: 0, clearance: Infinity, room: Infinity, newSegs, samples: null };

    for (const n of nearNodes) {
      if (n === u) continue;
      scoreNode(part, pos, newSegs, coords[n]);
    }
    for (const ex of nearSegs) scoreSeg(part, uPos, pos, newSegs, ex);

    // Free room in front of v for its own sub-tree (one-step look-ahead): two sample points along v's line
    if (childrenOf[v] && childrenOf[v].length > 0) {
      const a = getBaseAngle(geom.finalK);
      part.samples = [0.6, 1.2].map(t => ({ x: pos.x + t * len * Math.cos(a), y: pos.y + t * len * Math.sin(a) }));
      for (const sp of part.samples) {
        for (const n of nearNodes) {
          if (n === u) continue;
          part.room = Math.min(part.room, Math.hypot(coords[n].x - sp.x, coords[n].y - sp.y));
        }
        for (const ex of nearSegs) {
          if (samePoint(ex.p1, uPos) || samePoint(ex.p2, uPos)) continue;
          part.room = Math.min(part.room, distToSegment(sp, ex.p1, ex.p2));
        }
      }
    }
    return part;
  }

  function scoreNode(acc, pos, newSegs, pt) {
    const dn = Math.hypot(pt.x - pos.x, pt.y - pos.y);
    if (dn < METRO_NODE_CLEARANCE_PX) acc.vertexConf++;
    if (dn < acc.clearance) acc.clearance = dn;
    for (const sg of newSegs) {
      if (distToSegment(pt, sg.p1, sg.p2) < METRO_LINE_CLEARANCE_PX) acc.vertexConf++;
    }
  }

  function scoreSeg(acc, uPos, pos, newSegs, ex) {
    const incidentToU = samePoint(ex.p1, uPos) || samePoint(ex.p2, uPos);
    const ds = distToSegment(pos, ex.p1, ex.p2);
    if (ds < METRO_LINE_CLEARANCE_PX) acc.vertexConf++;
    if (!incidentToU && ds * 1.5 < acc.clearance) acc.clearance = ds * 1.5;
    for (const sg of newSegs) {
      if (analyzeEdgeCollision(sg.p1, sg.p2, ex.p1, ex.p2, 6.0).result) acc.edgeConf++;
    }
  }

  function scorePlacement(u, v, geom, len, tentative, base) {
    const uPos = coords[u];
    const pos = geom.pos;
    const acc = { vertexConf: base.vertexConf, edgeConf: base.edgeConf, clearance: base.clearance };
    for (const it of tentative) scoreNode(acc, pos, base.newSegs, it.pos);
    for (const it of tentative) for (const ex of it.segs) scoreSeg(acc, uPos, pos, base.newSegs, ex);

    let roomPenalty = 0;
    if (base.samples) {
      let room = base.room;
      for (const sp of base.samples) {
        for (const it of tentative) room = Math.min(room, Math.hypot(it.pos.x - sp.x, it.pos.y - sp.y));
      }
      if (room === Infinity) room = len;
      const weight = Math.min(subtreeSize[v] - 1, 4) / 2;
      roomPenalty = Math.max(0, len - room) * 15 * weight;
    }

    const clearance = acc.clearance === Infinity ? len : acc.clearance;

    return acc.vertexConf * 1e6
      + acc.edgeConf * 1e5
      + Math.max(0, 0.9 * len - clearance) * W.clear
      + roomPenalty * W.room;
    // (preference and average-distance terms are added by the caller)
  }

  // Best metro route for the cycle edge w - v (w already placed, v at candidate position vPos).
  // Cost: 1e6 per vertex the route passes through (closer than 12 px), 1e5 per crossing / touching edge or
  // shared start direction, plus a small bend penalty and a penalty for a bend very close to a vertex.
  // ownSegs: the candidate's own tree link and the cycle edges of v routed before this one.
  // committedCache (optional): costs from the committed geometry per shape, shared by all beam states
  // (only valid while w's position is committed, i.e. the same for every state).
  function routeCycleEdge(v, vPos, w, wPos, state, ownSegs, committedCache) {
    const shapes = metroCycleEdgeShapes(wPos, vPos);
    if (shapes.length === 0) {
      return { w, cost: 1e6, segs: [], bend: null, portW: null, portV: null };   // v placed on top of w
    }
    let best = null;
    shapes.forEach((sh, si) => {
      const checkVertex = (name, pt) => {
        if (name === v || name === w) return;
        sh.segs.forEach(sg => { if (nearSegment(pt, sg, METRO_LINE_CLEARANCE_PX)) c += 1e6; });
      };
      // Bounding boxes of the route's segments (grown by the 6 px touching distance) for a quick reject
      const boxes = sh.segs.map(sg => ({
        x0: Math.min(sg.p1.x, sg.p2.x) - 6, x1: Math.max(sg.p1.x, sg.p2.x) + 6,
        y0: Math.min(sg.p1.y, sg.p2.y) - 6, y1: Math.max(sg.p1.y, sg.p2.y) + 6 }));
      const checkSeg = ex => {
        const ex0 = ex.p1.x < ex.p2.x ? ex.p1.x : ex.p2.x, ex1 = ex.p1.x < ex.p2.x ? ex.p2.x : ex.p1.x;
        const ey0 = ex.p1.y < ex.p2.y ? ex.p1.y : ex.p2.y, ey1 = ex.p1.y < ex.p2.y ? ex.p2.y : ex.p1.y;
        for (let k = 0; k < sh.segs.length; k++) {
          const b = boxes[k];
          if (ex1 < b.x0 || ex0 > b.x1 || ey1 < b.y0 || ey0 > b.y1) continue;
          const sg = sh.segs[k];
          if (analyzeEdgeCollision(sg.p1, sg.p2, ex.p1, ex.p2, 6.0).result) c += 1e5;
        }
      };

      let c;
      if (committedCache && committedCache[si] !== undefined) {
        c = committedCache[si];
      } else {
        c = sh.bend ? METRO_CYCLE_BEND_PENALTY : 0;
        if (sh.minSeg < METRO_CYCLE_SHORT_SEGMENT_PX) c += (METRO_CYCLE_SHORT_SEGMENT_PX - sh.minSeg) * 4;
        c += METRO_CYCLE_LENGTH_WEIGHT * sh.length;
        placedNames.forEach(n => checkVertex(n, coords[n]));
        forLinesNear(boxes, checkSeg);
        if (committedCache) committedCache[si] = c;
      }

      state.items.forEach(it => checkVertex(it.v, it.pos));
      state.items.forEach(it => it.segs.forEach(checkSeg));
      ownSegs.forEach(checkSeg);

      if (!best || c < best.cost) {
        best = { w, cost: c, segs: sh.segs, bend: sh.bend, portW: sh.portFrom, portV: sh.portTo };
      }
    });
    return best;
  }

  // Replay (automatic repair): in the component that contains `until`, the vertices before it are replayed;
  // the other components did not change at all and are replayed completely.
  let replaying = !!(trace && trace.replay && trace.replay.decisions);
  for (const u of order) {
    if (replaying && u === trace.replay.until) replaying = false;
    if (replaying && trace.replay.decisions[u]) {
      commitLinks(u, trace.replay.decisions[u]);
      continue;
    }
    const kids = childrenOf[u]
      .map((c, idx) => ({ c, idx }))
      .sort((a, b) => (subtreeSize[b.c] - subtreeSize[a.c]) || (a.idx - b.idx))
      .map(o => o.c);
    if (kids.length === 0) continue;

    const uPos = coords[u];
    // Directions already taken at u: its incoming metro line and any cycle edges routed to u
    const blocked = new Set(usedPorts[u]);
    if (u !== rootName) blocked.add((orientations[u] + 4) % 8);

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

      // Everything about a candidate link that does not depend on the beam state is computed once
      const optCache = new Array(opts.length);
      const prepared = (i) => {
        if (optCache[i]) return optCache[i];
        const opt = opts[i];
        const geom = metroEdgeGeometry(uPos, opt.firstDir, opt.s, opt.len);
        const base = committedPart(u, v, geom, opt.len, nearNodes, nearSegs);
        // c2-like term: prefer positions far from the rest of the drawing on average
        let sum = 0;
        for (const n of placedNames) sum += Math.hypot(coords[n].x - geom.pos.x, coords[n].y - geom.pos.y);
        const avgDist = placedNames.length > 0 ? sum / placedNames.length : 0;
        optCache[i] = { geom, base, avgDist, routeCache: {} };
        return optCache[i];
      };

      const expand = (enforceDistinct) => {
        const out = [];
        beam.forEach(state => {
          const used = new Set(blocked);
          state.items.forEach(it => used.add(it.firstDir));
          let tentPos = null;
          opts.forEach((opt, i) => {
            if (enforceDistinct && used.has(opt.firstDir)) return;
            const pc = prepared(i);
            const geom = pc.geom;
            let score = scorePlacement(u, v, geom, opt.len, state.items, pc.base);
            score += opt.pref * W.pref;
            score -= pc.avgDist * W.avg;

            const segs = pc.base.newSegs;

            // Cycle edges from v to vertices that are already placed (or placed earlier in this beam state)
            const routes = [];
            let ownSegs = segs;
            if (cycleNbrs[v].length > 0) {
              if (!tentPos) {
                tentPos = {};
                state.items.forEach(it => { tentPos[it.v] = it.pos; });
              }
              cycleNbrs[v].forEach(w => {
                const wPos = placedSet.has(w) ? coords[w] : tentPos[w];
                if (!wPos) {
                  // w is placed later, next to its BFS parent: keep v close to that parent so the cycle stays short
                  const p = parentOf[w];
                  const pPos = p === undefined ? null : (placedSet.has(p) ? coords[p] : (p === v ? null : tentPos[p]));
                  if (pPos && METRO_CYCLE_PULL_WEIGHT > 0) {
                    score += METRO_CYCLE_PULL_WEIGHT * Math.hypot(geom.pos.x - pPos.x, geom.pos.y - pPos.y);
                  }
                  return;                                // routed later, when w is placed
                }
                // Committed part of the route cost can be shared by all beam states when w is committed
                let cache = null;
                if (placedSet.has(w)) cache = pc.routeCache[w] || (pc.routeCache[w] = []);
                const r = routeCycleEdge(v, geom.pos, w, wPos, state, ownSegs, cache);
                score += r.cost;
                routes.push(r);
                ownSegs = ownSegs.concat(r.segs);
              });
            }

            out.push({
              cost: state.cost + score,
              items: state.items.concat([{
                v, pos: geom.pos, bend: geom.bend, finalK: geom.finalK,
                firstDir: opt.firstDir, lg: opt.lg, segs: ownSegs, routes
              }])
            });
          });
        });
        return out;
      };

      let next = expand(true);
      if (next.length === 0) next = expand(false);   // no free direction left or conflicting overrides
      next.sort((a, b) => a.cost - b.cost);           // stable sort keeps the result deterministic
      beam = next.slice(0, beamWidth);
    });

    commitLinks(u, beam[0].items);
  }

  function commitLinks(u, items) {
    const uPos = coords[u];
    if (trace && trace.record) trace.record[u] = items;
    items.forEach(it => {
      const v = it.v;
      coords[v] = it.pos;
      orientations[v] = it.finalK;
      lineGen[v] = it.lg;
      scaleMul[v] = scaleMul[u] * (ov.subtreeScaleFactors[v] || 1);
      placedNames.push(v);
      placedSet.add(v);

      const canonicalKey = [u, v].sort().join("-");
      if (it.bend) {
        localBends[`${u}-${v}`] = it.bend;
        addLine({ p1: uPos, p2: it.bend, edgeKey: canonicalKey, u, v });
        addLine({ p1: it.bend, p2: it.pos, edgeKey: canonicalKey, u, v });
      } else {
        addLine({ p1: uPos, p2: it.pos, edgeKey: canonicalKey, u, v });
      }

      usedPorts[u].add(it.firstDir);
      usedPorts[v] = new Set([(it.finalK + 4) % 8]);

      // Cycle edges of v (to vertices placed before it)
      it.routes.forEach(r => {
        const key = [r.w, v].sort().join("-");
        if (r.bend) localBends[`${r.w}-${v}`] = r.bend;
        r.segs.forEach(sg => addLine({ p1: sg.p1, p2: sg.p2, edgeKey: key, u: r.w, v, cycle: true }));
        if (r.portW !== null) usedPorts[r.w].add(r.portW);
        if (r.portV !== null) usedPorts[v].add(r.portV);
      });
    });
  }

  return { coords, bends: localBends, linesDrawn, orientations };
}

// --- 3b. Large trees (more than 100 vertices): search over layout settings ---
// For a large tree the single default run leaves many overlaps, so several settings are tried and the layout
// with the fewest overlaps is kept (fewest overlapping vertex pairs first, then fewest colliding edge pairs).
// Settings: starting edge length (factor f times the size-based length of metroBaseSegmentLength), beam
// width B (1 = greedy), and an extra length shrink per generation (alphaFactor, effective alpha = alpha x factor).
// Stages are tried in order; a later stage (more extra shrink) is only tried while overlaps remain, and on a
// tie the earlier candidate wins, so the user's alpha is kept whenever that is enough. The first stage also
// contains the previous default (f = 1, B = 4), so the result is never worse than before.
// The choice is made once per tree / root / alpha (with no fixer overrides) and cached, so Run Full Metro
// Layout, Step by Step BFS Draw, the overlap lists and the Fix buttons all use the same layout.
const METRO_LARGE_TREE_MIN_VERTICES = 101;
const METRO_SEARCH_FOR_CYCLIC_GRAPHS = true;
// The Overlapping Vertices panel measures whole-pixel positions on screen; rounding can shorten a distance by
// up to sqrt(2) px, so the search counts pairs closer than 16 + 1.5 px as overlapping to be safe.
const METRO_SEARCH_VERTEX_THRESHOLD_PX = 17.5;
const METRO_LARGE_TREE_STAGES = [
  // Within a stage, candidates go from shorter to longer edges, so the most compact clean layout wins.
  { alphaFactor: 1.0, candidates: [ { f: 1, B: 4 }, { f: 1, B: 1 }, { f: 1, B: 2 }, { f: 1.25, B: 2 }, { f: 1.5, B: 2 },
                                    { f: 1.75, B: 2 }, { f: 2, B: 1 }, { f: 2.5, B: 1 }, { f: 3, B: 2 } ] },
  { alphaFactor: 0.8, candidates: [ { f: 1.5, B: 2 }, { f: 1.75, B: 2 }, { f: 3, B: 1 }, { f: 3, B: 2 } ] },
  { alphaFactor: 0.7, candidates: [ { f: 1.25, B: 1 }, { f: 1.5, B: 1 }, { f: 1.75, B: 1 } ] },
  { alphaFactor: 0.6, candidates: [ { f: 2, B: 1 }, { f: 2.5, B: 1 }, { f: 2.5, B: 2 } ] },
  { alphaFactor: 0.5, candidates: [ { f: 2, B: 1 }, { f: 2.5, B: 2 }, { f: 3, B: 1 }, { f: 3, B: 2 } ] }
];
// Trees with at most 100 vertices keep their edge lengths (start edge 90 px, the given alpha, no extra shrink):
// only the placement search (beam width) and the weighting of the soft terms are varied.
const METRO_SMALL_TREE_MAX_VERTICES = 100;
const METRO_SMALL_TREE_STAGES = [
  { alphaFactor: 1.0, candidates: [ { f: 1, B: 4 }, { f: 1, B: 1 }, { f: 1, B: 2 }, { f: 1, B: 3 },
                                    { f: 1, B: 6 }, { f: 1, B: 8 }, { f: 1, B: 12 } ] }
];
// Other weightings of the soft placement terms (none of them changes an edge length)
const METRO_WEIGHT_VARIANTS = [
  null,                                                   // METRO_DEFAULT_WEIGHTS
  { clear: 80,  room: 2, pref: 6,  avg: 0.02 },
  { clear: 40,  room: 3, pref: 12, avg: 0.05 },
  { clear: 120, room: 4, pref: 4,  avg: 0 }
];
window.metroLargeTreeConfigCache = {};

function metroGraphSignature() {
  // Genders are part of the signature (male written as A_), so a cached search result is never reused
  // after the genders change (Randomize Genders, or a list/matrix with other genders)
  const g = v => v + (getNodeGender(v) === "M" ? "_" : "");
  return Object.keys(graph).map(u => g(u) + ":" + (graph[u] || []).map(e => e.to).join(",")).join(";");
}

// The search (and the automatic repair after it) is used for every graph with at least 2 vertices.
// Graphs with a cycle and trees with more than 100 vertices may also get other edge lengths (the stages of
// METRO_LARGE_TREE_STAGES); trees with at most 100 vertices keep their edge lengths (METRO_SMALL_TREE_STAGES).
function metroLayoutSearchApplies() {
  return Object.keys(graph).length >= 2;
}

function metroSearchUsesSmallStages() {
  const n = Object.keys(graph).length;
  if (n >= METRO_LARGE_TREE_MIN_VERTICES) return false;
  return !(METRO_SEARCH_FOR_CYCLIC_GRAPHS && metroGraphHasCycle());
}

function getMetroLargeTreeConfig(rootName, alpha) {
  if (!rootName || !graph[rootName] || !metroLayoutSearchApplies()) return null;

  const key = metroGraphSignature() + "|" + rootName + "|" + alpha;
  const cache = window.metroLargeTreeConfigCache || (window.metroLargeTreeConfigCache = {});
  if (cache[key]) return cache[key];

  // Search without any fixer overrides, then restore them
  const hadOverrides = Object.prototype.hasOwnProperty.call(window.metroOverridesByRoot, rootName);
  const savedOverrides = window.metroOverridesByRoot[rootName];
  window.metroOverridesByRoot[rootName] = createEmptyOverrides();

  const baseLen = metroBaseSegmentLength();
  let best = null;
  let tried = 0;
  const clean = () => best && best.overlapCount === 0 && best.lineIntersections === 0;
  try {
    const small = metroSearchUsesSmallStages();
    const stages = small ? METRO_SMALL_TREE_STAGES : METRO_LARGE_TREE_STAGES;
    const n = Object.keys(graph).length;
    // Every weighting with every candidate for graphs up to 100 vertices; for larger graphs (each layout is
    // expensive) the other weightings only with the default settings.
    for (const weights of METRO_WEIGHT_VARIANTS) {
      for (const stage of stages) {
        for (const c of stage.candidates) {
          if (n > METRO_SMALL_TREE_MAX_VERTICES && weights && !(c.f === 1 && c.B === 4 && stage.alphaFactor === 1)) continue;
          const cfg = { base: baseLen * c.f, beamWidth: c.B, alphaFactor: stage.alphaFactor, weights };
          const q = metroLayoutQuality(generateFamilyMetroCoordinates(rootName, alpha, cfg.base, cfg), METRO_SEARCH_VERTEX_THRESHOLD_PX);
          tried++;
          if (!best ||
              q.overlapCount < best.overlapCount ||
              (q.overlapCount === best.overlapCount && q.lineIntersections < best.lineIntersections)) {
            best = { base: cfg.base, beamWidth: cfg.beamWidth, alphaFactor: cfg.alphaFactor, weights,
                     overlapCount: q.overlapCount, lineIntersections: q.lineIntersections };
          }
          if (clean()) break;
        }
        if (clean()) break;
      }
      if (clean()) break;
    }
    // Overlaps left: automatic repair (re-routes single links, never changes a length)
    best.searchOverlapCount = best.overlapCount;
    best.searchLineIntersections = best.lineIntersections;
    best.autoOverrides = null;
    best.autoMoves = 0;
    if (!clean()) {
      const rep = metroAutoRepair(rootName, alpha, best);
      if (rep.moves > 0) {
        best.autoOverrides = rep.overrides;
        best.autoMoves = rep.moves;
        best.overlapCount = rep.overlapCount;
        best.lineIntersections = rep.lineIntersections;
      }
      tried += rep.evaluations;
    }
  } finally {
    if (hadOverrides) window.metroOverridesByRoot[rootName] = savedOverrides;
    else delete window.metroOverridesByRoot[rootName];
  }

  best.tried = tried;
  if (Object.keys(cache).length > 20) window.metroLargeTreeConfigCache = {};
  window.metroLargeTreeConfigCache[key] = best;
  return best;
}

// --- 3c. Automatic repair (part of the layout, so Run Full Metro Layout, Step by Step and the Fix buttons all
// start from it) ---
// Local search over the choices of single tree links, like the Fix buttons, but only with moves that keep
// every edge length: the branch offset g and the bend sign s of one link parent -> target are forced, and the
// layout re-places (and re-routes the cycle edges of) everything after it. Targets are the vertices of
// overlapping pairs and colliding edges (both ends of a cycle edge) and their parents and grandparents.
// A move is kept when it lowers (overlapping vertex pairs, colliding edge pairs, -minimum distance)
// lexicographically. The number of layouts tried is fixed by the graph size, so the result is deterministic.
const METRO_REPAIR_EVAL_BUDGET = 18000;    // divided by the number of vertices plus edges
const METRO_REPAIR_MIN_EVALS = 30;
const METRO_REPAIR_MAX_EVALS = 600;

function metroRepairBetter(a, b) {
  if (a.overlapCount !== b.overlapCount) return a.overlapCount < b.overlapCount;
  if (a.lineIntersections !== b.lineIntersections) return a.lineIntersections < b.lineIntersections;
  return a.minDistance > b.minDistance + 1e-9;
}

function metroAutoRepair(rootName, alpha, cfg) {
  const n = Object.keys(graph).length || 1;
  let m = 0;
  for (const u in graph) m += (graph[u] || []).length;
  m /= 2;
  const maxEvals = Math.max(METRO_REPAIR_MIN_EVALS, Math.min(METRO_REPAIR_MAX_EVALS, Math.round(METRO_REPAIR_EVAL_BUDGET / (n + m))));
  const parentMap = buildMetroParentMap(rootName);
  let evaluations = 0;
  // Only the link parent -> target changes in a trial, so every vertex placed before `parent` keeps its links:
  // they are replayed from the current best layout instead of being searched again (same result, less work).
  let bestRecord = null;
  const evaluate = (ovr, until) => {
    evaluations++;
    window.metroOverridesByRoot[rootName] = ovr;
    const trace = { record: {} };
    if (until && bestRecord) trace.replay = { decisions: bestRecord, until };
    const layout = generateFamilyMetroCoordinates(rootName, alpha, cfg.base, cfg, trace);
    const q = metroLayoutQuality(layout, METRO_SEARCH_VERTEX_THRESHOLD_PX);
    q.record = trace.record;
    q.orientations = layout.orientations;
    return q;
  };

  let bestOv = createEmptyOverrides();
  let bestQ = evaluate(bestOv);
  bestRecord = bestQ.record;
  let moves = 0;

  while ((bestQ.overlapCount > 0 || bestQ.lineIntersections > 0) && evaluations < maxEvals) {
    // Targets: endpoints first, then their parents, then grandparents
    const levels = [[], [], []];
    const seen = new Set();
    const addChain = (x) => {
      for (let depth = 0; depth < 3 && x && parentMap[x]; depth++) {
        if (!seen.has(x)) { seen.add(x); levels[depth].push(x); }
        x = parentMap[x];
      }
    };
    bestQ.overlappingPairs.forEach(pr => { addChain(pr.u); addChain(pr.v); });
    bestQ.collidingEdgePairs.forEach(pr => [pr.s1, pr.s2].forEach(sg => {
      if (sg.cycle) { addChain(sg.u); addChain(sg.v); }
      else addChain(parentMap[sg.v] === sg.u ? sg.v : sg.u);
    }));
    const targets = levels[0].concat(levels[1], levels[2]);

    let improved = false;
    for (const target of targets) {
      if (evaluations >= maxEvals) break;
      const parent = parentMap[target];
      if (!parent) continue;
      const edgeKey = `${parent}-${target}`;
      let candOv = null, candQ = null;
      for (const tr of buildMetroFixTrials(rootName, parent, target, bestQ.orientations)) {
        if (evaluations >= maxEvals) break;
        const ov = applyMetroFixTrial(bestOv, edgeKey, tr.g, tr.t);
        const q = evaluate(ov, parent);
        if (metroRepairBetter(q, candQ || bestQ)) { candOv = ov; candQ = q; }
      }
      if (candOv) {
        bestOv = candOv; bestQ = candQ; bestRecord = candQ.record; moves++; improved = true;
        if (bestQ.overlapCount === 0 && bestQ.lineIntersections === 0) break;
      }
    }
    if (!improved) break;
  }
  return { overrides: bestOv, moves, evaluations,
           overlapCount: bestQ.overlapCount, lineIntersections: bestQ.lineIntersections };
}

// Overrides a fresh layout starts from: the automatic repair of the cached search result (or none)
function metroInitialOverrides(rootName, alpha) {
  const cfg = getMetroLargeTreeConfig(rootName, alpha);
  if (cfg && cfg.autoOverrides) return JSON.parse(JSON.stringify(cfg.autoOverrides));
  return createEmptyOverrides();
}

function describeMetroLargeTreeConfig(cfg, alpha) {
  if (!cfg) return "";
  if (cfg.tried === 1) return "";   // the default layout was already free of overlaps
  const parts = [`start edge ${Math.round(cfg.base)} px`, cfg.beamWidth === 1 ? "greedy placement" : `beam width ${cfg.beamWidth}`];
  if (cfg.alphaFactor < 1) {
    parts.push(`extra shrink ×${cfg.alphaFactor} per generation (effective α = ${+(alpha * cfg.alphaFactor).toFixed(3)})`);
  }
  let text = ` Layout search: best of ${cfg.tried} candidate layout${cfg.tried === 1 ? "" : "s"} (${parts.join(", ")}).`;
  if (cfg.autoMoves > 0) {
    text += ` Automatic repair re-routed ${cfg.autoMoves} link${cfg.autoMoves === 1 ? "" : "s"}` +
      ` (overlapping vertex pairs ${cfg.searchOverlapCount} → ${cfg.overlapCount},` +
      ` colliding edge pairs ${cfg.searchLineIntersections} → ${cfg.lineIntersections}).`;
  }
  return text;
}

// Helper to pre-calculate global offsets
function prepareMetroData(rootNode, alpha) {
  const { coords, bends, linesDrawn } = generateFamilyMetroCoordinates(rootNode, alpha, metroBaseSegmentLength());

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

  const check = verifyGraphForMetro();
  if (!check.isValid) {
    alert("Family Metro Map Error: " + check.reason);
    if (statusElem) statusElem.innerText = "Error: This graph cannot be drawn as a metro map. " + check.reason;
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
    alert("Please add vertices to build a graph.");
    checkAndListOverlappingVertices();
    checkAndListEdgeOverlaps();
    updateSummaryOfChangesSection();
    return;
  }

  if (resetOverrides) {
    // A fresh layout starts from the automatic repair (section 3c); the Fix buttons build on top of it
    window.metroOverridesByRoot[rootNode] = metroInitialOverrides(rootNode, alpha);
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
    statusElem.innerText = `Family Metro Map layout applied (Root: ${rootNode}, α = ${alpha}). Blue = Male, Pink = Female.` +
      describeMetroLargeTreeConfig(getMetroLargeTreeConfig(rootNode, alpha), alpha);
  }
}

// --- 5b. Incremental overlap lists for Step by Step BFS Draw ---
// The step-by-step layout is computed once (first click). Afterwards every click reveals one vertex, and the
// overlap lists are updated incrementally instead of being recomputed from scratch:
//   * the new vertex is compared with the drawn vertices only (O(n) per click);
//   * the edges that became visible are compared with the drawn edges only (O(m) per click);
//   * overlap groups are kept in union-find structures, so they never have to be rebuilt.
// A full click-through therefore costs O(n^2) instead of O(n^3). The lists are identical to those of the full
// check (checkAndListOverlappingVertices / checkAndListEdgeOverlaps) restricted to the drawn part; a group is
// marked NEW when it was created or grew in the last click.
function metroDsu() {
  return { parent: {}, size: {}, members: {}, sumX: {}, sumY: {}, overlap: {} };
}

function metroDsuAdd(d, x) {
  d.parent[x] = x;
  d.size[x] = 1;
  d.members[x] = [x];
  d.sumX[x] = 0;
  d.sumY[x] = 0;
  d.overlap[x] = false;
}

function metroDsuFind(d, x) {
  while (d.parent[x] !== x) {
    d.parent[x] = d.parent[d.parent[x]];
    x = d.parent[x];
  }
  return x;
}

// Union by size; members stay sorted by rank (merge of two sorted lists)
function metroDsuUnion(d, a, b, rank) {
  let ra = metroDsuFind(d, a), rb = metroDsuFind(d, b);
  if (ra === rb) return ra;
  if (d.size[ra] < d.size[rb]) { const t = ra; ra = rb; rb = t; }
  const A = d.members[ra], B = d.members[rb], merged = [];
  let i = 0, j = 0;
  while (i < A.length || j < B.length) {
    if (j >= B.length || (i < A.length && rank[A[i]] < rank[B[j]])) merged.push(A[i++]);
    else merged.push(B[j++]);
  }
  d.parent[rb] = ra;
  d.size[ra] += d.size[rb];
  d.members[ra] = merged;
  d.sumX[ra] += d.sumX[rb];
  d.sumY[ra] += d.sumY[rb];
  d.overlap[ra] = d.overlap[ra] || d.overlap[rb];
  delete d.members[rb];
  return ra;
}

function metroStepTrackerCreate(coords, offsets, linesDrawn) {
  const vertexOrder = Object.keys(nodes);                 // order of the full vertex check
  const vRank = {};
  vertexOrder.forEach((v, i) => { vRank[v] = i; });
  const screen = {};                                      // whole-pixel positions, as drawn on screen
  Object.keys(coords).forEach(v => {
    screen[v] = { x: Math.round(coords[v].x + offsets.x), y: Math.round(coords[v].y + offsets.y) };
  });
  // Segments of every edge with their index in the segment list (fixes the order of the full edge check)
  const segsOf = {}, edgeEnds = {}, edgesAt = {};
  linesDrawn.forEach((sg, idx) => {
    if (!segsOf[sg.edgeKey]) {
      segsOf[sg.edgeKey] = [];
      edgeEnds[sg.edgeKey] = [sg.u, sg.v];
      (edgesAt[sg.u] = edgesAt[sg.u] || []).push(sg.edgeKey);
      (edgesAt[sg.v] = edgesAt[sg.v] || []).push(sg.edgeKey);
    }
    segsOf[sg.edgeKey].push({ sg, idx });
  });
  const edgeOrder = Object.keys(segsOf).sort();          // groups are listed with edges in this order
  const eRank = {};
  edgeOrder.forEach((e, i) => { eRank[e] = i; });
  return {
    vertexOrder, vRank, screen, segsOf, edgeEnds, edgesAt, edgeOrder, eRank,
    drawnV: new Set(), drawnVList: [], drawnE: new Set(), drawnEList: [],
    vSets: metroDsu(), eSets: metroDsu(), touchedV: new Set(), touchedE: new Set()
  };
}

// Collision type of two edges ("overlap", "touch" or null): their segment pairs are tested in the same order as
// in the full check (by position in the segment list), and the first colliding pair decides the type.
function metroEdgePairCollision(segsE, segsF) {
  const pairs = [];
  segsE.forEach(a => segsF.forEach(b => {
    pairs.push(a.idx < b.idx ? { i: a.idx, j: b.idx, s1: a.sg, s2: b.sg } : { i: b.idx, j: a.idx, s1: b.sg, s2: a.sg });
  }));
  pairs.sort((p, q) => (p.i - q.i) || (p.j - q.j));
  for (const p of pairs) {
    const res = analyzeEdgeCollision(p.s1.p1, p.s1.p2, p.s2.p1, p.s2.p2, 6.0);
    if (res.result) return res.type;
  }
  return null;
}

// Reveal one vertex: update the overlap groups with everything that became visible
function metroStepTrackerReveal(T, v, threshold = 16) {
  const touchedV = [], touchedE = [];
  const vs = T.vSets, es = T.eSets;
  const pv = T.screen[v];

  metroDsuAdd(vs, v);
  vs.sumX[v] = pv.x;
  vs.sumY[v] = pv.y;
  T.drawnVList.forEach(w => {
    const pw = T.screen[w];
    if (Math.hypot(pv.x - pw.x, pv.y - pw.y) < threshold) {
      metroDsuUnion(vs, v, w, T.vRank);
      touchedV.push(v);
    }
  });
  T.drawnV.add(v);
  T.drawnVList.push(v);

  (T.edgesAt[v] || []).forEach(E => {
    const [a, b] = T.edgeEnds[E];
    if (T.drawnE.has(E) || !T.drawnV.has(a) || !T.drawnV.has(b)) return;
    metroDsuAdd(es, E);
    T.drawnEList.forEach(F => {
      const type = metroEdgePairCollision(T.segsOf[E], T.segsOf[F]);
      if (type) {
        const r = metroDsuUnion(es, E, F, T.eRank);
        if (type !== "touch") es.overlap[r] = true;
        touchedE.push(E);
      }
    });
    T.drawnE.add(E);
    T.drawnEList.push(E);
  });

  T.touchedV = new Set(touchedV.map(x => metroDsuFind(vs, x)));
  T.touchedE = new Set(touchedE.map(x => metroDsuFind(es, x)));
}

// Write both overlap lists (same format as the full check). markNew: highlight groups touched in the last click.
function metroStepTrackerRender(T, markNew) {
  const newBadge = ` <span style="background:#f1c40f; color:#2c3e50; font-size:10px; font-weight:bold; padding:1px 5px; border-radius:3px; margin-left:4px;">NEW</span>`;
  const none = el => {
    const li = document.createElement("li");
    li.style.color = "#27ae60";
    li.style.fontWeight = "bold";
    li.textContent = "None";
    el.appendChild(li);
  };

  const overlapList = getDomEl("overlapList");
  if (overlapList) {
    overlapList.innerHTML = "";
    const vs = T.vSets;
    let count = 0;
    T.vertexOrder.forEach(v => {
      if (!T.drawnV.has(v)) return;
      const r = metroDsuFind(vs, v);
      if (vs.size[r] < 2 || vs.members[r][0] !== v) return;      // list each group once, at its first vertex
      const group = vs.members[r];
      const avgX = Math.round(vs.sumX[r] / group.length);
      const avgY = Math.round(vs.sumY[r] / group.length);
      const isNew = markNew && T.touchedV.has(r);
      const li = document.createElement("li");
      li.style.padding = "3px 0";
      const nodesFormatted = group.map(n => `<strong style="color: #c0392b;">${n}</strong>`).join(", ");
      li.innerHTML = `Vertices ${nodesFormatted} overlap at approx (${avgX}, ${avgY})${isNew ? newBadge : ""}`;
      if (isNew) li.style.background = "#fff3cd";
      overlapList.appendChild(li);
      count++;
    });
    if (count === 0) none(overlapList);
  }

  const edgeListEl = getDomEl("edgeOverlapList");
  if (edgeListEl) {
    edgeListEl.innerHTML = "";
    const es = T.eSets;
    let count = 0;
    T.edgeOrder.forEach(E => {
      if (!T.drawnE.has(E)) return;
      const r = metroDsuFind(es, E);
      if (es.size[r] < 2 || es.members[r][0] !== E) return;
      const group = es.members[r];
      const isNew = markNew && T.touchedE.has(r);
      const li = document.createElement("li");
      li.style.padding = "3px 0";
      if (!es.overlap[r]) {
        const edgesFormatted = group.map(e => `<strong style="color: #e67e22;">${e}</strong>`).join(", ");
        li.innerHTML = `Edges ${edgesFormatted} touch / graze each other${isNew ? newBadge : ""}`;
      } else {
        const edgesFormatted = group.map(e => `<strong style="color: #c0392b;">${e}</strong>`).join(", ");
        li.innerHTML = `Edges ${edgesFormatted} collide / overlap${isNew ? newBadge : ""}`;
      }
      if (isNew) li.style.background = "#fff3cd";
      edgeListEl.appendChild(li);
      count++;
    });
    if (count === 0) none(edgeListEl);
  }
}

// --- 5. Step-by-Step BFS Metro Drawer ---
function stepBFSMove(alpha = 0.75) {
  const statusElem = getDomEl("status");
  const startNodeInp = getDomEl("startNode");
  const bfsDisplayElem = getDomEl("bfsLayersDisplay");

  const check = verifyGraphForMetro();
  if (!check.isValid) {
    alert("Family Metro Map Error: " + check.reason);
    if (statusElem) statusElem.innerText = "Error: This graph cannot be drawn as a metro map. " + check.reason;
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
    alert("Please add vertices to build a graph.");
    checkAndListOverlappingVertices();
    checkAndListEdgeOverlaps();
    updateSummaryOfChangesSection();
    return;
  }

  // Restart if the graph changed since the step-by-step run started (vertex/edge added or removed),
  // so the [k / n] counter and the BFS order always match the current graph.
  const stepGraphChanged = window.stepBfsState.active && (
    !window.stepBfsState.order ||
    window.stepBfsState.order.length !== Object.keys(graph).length ||
    window.stepBfsState.order.some(n => !graph[n] || !nodes[n])
  );

  if (!window.stepBfsState.active || stepGraphChanged || window.stepBfsState.root !== rootNode || window.stepBfsState.alpha !== alpha) {
    // A fresh step-by-step run starts from exactly the same state as "Run Full Metro Layout"
    // (overrides from earlier fixes are cleared), so both buttons produce the identical drawing.
    window.metroOverridesByRoot[rootNode] = metroInitialOverrides(rootNode, alpha);
    window.metroChangeSummaryByRoot[rootNode] = [];

    const fullLayers = computeBFSLayers(rootNode);
    const flattenedOrder = [];
    fullLayers.forEach(layer => {
      layer.forEach(n => flattenedOrder.push(n));
    });

    const { coords, bends, linesDrawn, offsetX, offsetY } = prepareMetroData(rootNode, alpha);

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
      tracker: metroStepTrackerCreate(coords, { x: offsetX, y: offsetY }, linesDrawn)
    };

    if (bfsDisplayElem) bfsDisplayElem.innerHTML = "[]";
    metroStepTrackerRender(window.stepBfsState.tracker, false);
    updateSummaryOfChangesSection(rootNode);
  }

  const state = window.stepBfsState;

  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL GRAPH DRAWN";
    metroStepTrackerRender(state.tracker, false);
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

  // Overlap lists, updated incrementally: only the new vertex and the edges that became visible are checked
  // against what is already drawn, and groups that appeared or grew in this step are highlighted as NEW.
  metroStepTrackerReveal(state.tracker, currNode);
  metroStepTrackerRender(state.tracker, true);

  updateSummaryOfChangesSection(rootNode);

  if (state.stepIndex >= state.order.length) {
    if (statusElem) statusElem.innerText = "FULL GRAPH DRAWN";
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
  const layout = generateFamilyMetroCoordinates(rootNode, alpha, metroBaseSegmentLength());
  const q = metroLayoutQuality(layout);
  q.coords = layout.coords;
  q.bends = layout.bends;
  q.linesDrawn = layout.linesDrawn;
  q.orientations = layout.orientations;
  return q;
}

// Quality of a computed layout: overlapping vertex pairs (closer than 16 px), colliding edge pairs,
// minimum vertex distance, and the combined cost used by the fixers.
// vertexThreshold: vertices closer than this count as overlapping (16 px = the disk size).
function metroLayoutQuality(layout, vertexThreshold = 16) {
  const { coords, linesDrawn } = layout;
  const nodeKeys = Object.keys(coords);
  let overlapCount = 0;
  let minDistance = Infinity;
  const overlappingPairs = [];

  for (let i = 0; i < nodeKeys.length; i++) {
    for (let j = i + 1; j < nodeKeys.length; j++) {
      const u = nodeKeys[i], v = nodeKeys[j];
      const d = Math.hypot(coords[u].x - coords[v].x, coords[u].y - coords[v].y);
      if (d < vertexThreshold) {
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
  return { cost, overlapCount, lineIntersections, minDistance, overlappingPairs, collidingEdgePairs };
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

// Parent of every vertex in the BFS spanning forest (component roots have no parent)
function buildMetroParentMap(rootNode) {
  const parentMap = {};
  const visited = new Set();
  metroComponentRoots(rootNode).forEach(r => {
    visited.add(r);
    const queue = [r];
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
  });
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

    // Child endpoints of colliding edges (both endpoints for a cycle edge), plus their parents and grandparents
    const targetSet = new Set();
    evalRes.collidingEdgePairs.forEach(pair => {
      [pair.s1, pair.s2].forEach(sg => {
        const ends = sg.cycle ? [sg.u, sg.v] : [parentMap[sg.v] === sg.u ? sg.v : sg.u];
        ends.forEach(child => {
          let x = child;
          for (let depth = 0; depth < 3 && x && x !== rootNode; depth++) {
            targetSet.add(x);
            x = parentMap[x];
          }
        });
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