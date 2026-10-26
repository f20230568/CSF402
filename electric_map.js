// electric_map.js - Electric Board Map: a compact, circuit-board-like drawing of a gendered FOREST,
// built on the Family Metro Map rules (Korst, Pronk & van Wijk 2020).
//
// ALGORITHM (overview)
//  1. Grid. Every vertex is a pad on an integer grid point; every edge is a trace made of unit grid steps in one of
//     the 8 octilinear directions k = 0..7 (k * 45 deg), exactly like copper traces on a printed circuit board.
//  2. Gender rule (from the metro map): the LAST segment of the trace that arrives at a child v is
//       orthogonal (k even) if v is female, diagonal (k odd) if v is male.
//     A trace may bend with UNEQUAL segment lengths. Shapes:
//       straight (a), one 45-deg bend (a, b),
//       dogleg / jog (a, c, b: two 45-deg bends back to the first direction - the PCB "offset"),
//       chamfered corner (a, c, b: two 45-deg bends in the SAME sense, i.e. a 90-deg turn with a 45-deg chamfer,
//       the way real boards turn a corner - no sharp 90-deg corners).
//  3. Generation-by-generation routing (like the metro map's breadth-first order) from a root in each tree
//     (the tree's centre, or the Root Node given by the user). Children are routed largest sub-tree first.
//     For every child all candidate traces up to a maximum segment length are enumerated and the cheapest legal one
//     is taken. A candidate is legal when it
//       - never passes through a pad or another trace (traces may run on ADJACENT grid lines) and never crosses a
//         diagonal of another trace,
//       - ends on a free grid point at least the pad clearance (Chebyshev distance) away from every other pad,
//       - arrives with the direction its gender demands.
//     Cost = trace length + bend penalty + compactness x growth of the bounding box (half perimeter)
//            - BUS BONUS for every step that runs parallel to an existing trace on the neighbouring grid line
//              (so traces bundle into dense parallel buses that turn together, as on a real board)
//            - bonus for continuing the parent's line (metro line continuation)
//            + look-ahead penalties when the new pad has fewer free directions than children, or too little free
//              room around it for its sub-tree.
//     If nothing is legal the search length is increased, then a maze router (45-deg turns preferred), then
//     rip-up and reroute; as a last resort a trace with conflicts is drawn and reported.
//  4. Forest packing by FOOTPRINT. Each tree is laid out separately; then the trees are placed one by one (largest
//     first) at the position that keeps the board smallest for the chosen aspect ratio, using their real occupied
//     grid points (not bounding boxes), so small trees nest into the gaps of bigger ones. The same rules as inside a
//     tree hold between trees (no shared points, no crossing diagonals, pad clearance).
//  5. Verification. The final drawing is checked independently of the construction: pads on the same point or too
//     close, traces through pads, overlapping or crossing traces, and the gender rule for every arrival.
//  Coordinates on the grid are exact, so all checks are exact.

const EB_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const EB_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const EB_OFF = 20000;
const EB_SPAN = 40000;
const ebKey = (x, y) => (x + EB_OFF) * EB_SPAN + (y + EB_OFF);
const EB_JOG_MAX = 3;                         // longest middle segment of a dogleg / chamfered corner
// neighbouring parallel grid lines of a step with orientation o = k & 3 (0: -, 1: \, 2: |, 3: /)
const EB_SIDE = [[[0, 1], [0, -1]], [[1, 0], [-1, 0]], [[1, 0], [-1, 0]], [[1, 0], [-1, 0]]];
function ebDirOf(dx, dy) {
  for (let k = 0; k < 8; k++) if (EB_DX[k] === dx && EB_DY[k] === dy) return k;
  return -1;
}

const EB_THEMES = {
  blue:  { board: "#1b4f97", grid: "#3567ad", outline: "#123d78", trace: "#3e8ee0", shine: "#86c3ff", text: "#d6e7ff" },
  green: { board: "#159447", grid: "#2bb862", outline: "#0b6a31", trace: "#36c96a", shine: "#7fe3a2", text: "#d8f5df" }
};

window.ebView = { scale: 1, rotated: false, layout: null, check: null, heightBeforeRotation: null };

function ebNum(id, def, min, max) {
  const el = document.getElementById(id);
  let v = el ? parseFloat(el.value) : NaN;
  if (!isFinite(v)) v = def;
  return Math.min(max, Math.max(min, v));
}

function ebSettings() {
  const dog = document.getElementById("allowDoglegs");
  const ord = document.getElementById("placementOrder");
  const grid = document.getElementById("showGrid");
  const theme = document.getElementById("boardTheme");
  const sq = document.getElementById("squeezeBoard");
  return {
    pitch: ebNum("gridPitch", 18, 12, 40),
    maxSeg: Math.round(ebNum("maxSegment", 6, 2, 12)),
    clearance: Math.round(ebNum("padClearance", 2, 2, 3)),
    compact: ebNum("compactness", 1.5, 0, 6),
    aspect: ebNum("boardAspect", 1.6, 0.3, 4),
    doglegs: dog ? dog.checked : true,
    order: ord ? ord.value : "bfs",
    bus: ebNum("busBundling", 0.5, 0, 1.5),   // bonus per step that runs parallel to a neighbouring trace
    squeeze: sq ? sq.checked : true,          // rip-up compaction of every tree
    squeezeMs: ebNum("squeezeMs", 800, 0, 10000),  // time budget of the squeeze pass (shared by all trees)
    chooseMs: 300,                            // time to look for a smaller conflict-free attempt (shared)
    outward: 0,             // reward per grid step away from the root (0 = off)
    roomPerVertex: 1.5,     // free grid points wanted around a new pad per vertex of its sub-tree
    roomWeight: 1.0,
    roomMaxRadius: 2,       // radius (grid steps) of the free-room look-ahead
    showGrid: grid ? grid.checked : false,
    theme: theme && EB_THEMES[theme.value] ? theme.value : "blue"
  };
}

// --- Tree helpers ---
function ebTreeCentre(comp) {
  if (comp.length <= 2) return comp[0];
  const inComp = new Set(comp);
  const bfs = start => {
    const dist = { [start]: 0 }, par = { [start]: null };
    const q = [start];
    let last = start;
    for (let i = 0; i < q.length; i++) {
      const u = q[i];
      last = u;
      ebGraph[u].forEach(v => {
        if (inComp.has(v) && !(v in dist)) { dist[v] = dist[u] + 1; par[v] = u; q.push(v); }
      });
    }
    return { last, par };
  };
  const a = bfs(comp[0]).last;
  const r = bfs(a);
  const path = [];
  for (let x = r.last; x !== null; x = r.par[x]) path.push(x);
  return path[Math.floor(path.length / 2)];
}

// --- 1-3. Layout of one tree on the grid ---
function ebLayoutTree(comp, root, S) {
  const pads = new Map();     // key -> vertex
  const trace = new Map();    // key -> edge key (intermediate trace points)
  const diag = new Map();     // square key * 2 + type -> edge key (type 0 = "\", 1 = "/")
  const ori = new Map();      // key -> [n0, n1, n2, n3]: number of trace steps of each orientation touching the point
  const pos = {}, inDir = {}, paths = {}, forced = [];
  const bb = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  // Rooted tree
  const parent = { [root]: null }, children = {}, bfsOrder = [root];
  for (let i = 0; i < bfsOrder.length; i++) {
    const u = bfsOrder[i];
    children[u] = [];
    ebGraph[u].forEach(v => {
      if (!(v in parent)) { parent[v] = u; children[u].push(v); bfsOrder.push(v); }
    });
  }
  const size = {};
  for (let i = bfsOrder.length - 1; i >= 0; i--) {
    const u = bfsOrder[i];
    size[u] = 1 + children[u].reduce((s, c) => s + size[c], 0);
  }
  Object.keys(children).forEach(u => {
    children[u].sort((a, b) => (size[b] - size[a]) || ebCompareLabels(a, b));
  });
  let order = bfsOrder;
  if (S.order === "dfs") {
    order = [];
    const stack = [root];
    while (stack.length) {
      const u = stack.pop();
      order.push(u);
      for (let i = children[u].length - 1; i >= 0; i--) stack.push(children[u][i]);
    }
  }

  pos[root] = { x: 0, y: 0 };
  pads.set(ebKey(0, 0), root);
  const pending = { [root]: children[root].length };   // children of a placed pad that still need a trace

  const C = S.clearance;
  let limit = null;   // optional box the routing must stay inside (used by the squeeze pass)
  const inLimit = (x, y) => !limit || (x >= limit.minX && x <= limit.maxX && y >= limit.minY && y <= limit.maxY);
  const diagSlot = (x1, y1, x2, y2) => {
    const sx = Math.min(x1, x2), sy = Math.min(y1, y2);
    const type = ((x2 - x1) * (y2 - y1) > 0) ? 0 : 1;
    return { mine: ebKey(sx, sy) * 2 + type, other: ebKey(sx, sy) * 2 + (1 - type) };
  };

  // Orientation bookkeeping of committed traces (used by the bus bonus)
  function addOri(xs, ys, delta) {
    for (let i = 1; i < xs.length; i++) {
      const o = ebDirOf(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) & 3;
      for (const j of [i - 1, i]) {
        const key = ebKey(xs[j], ys[j]);
        let a = ori.get(key);
        if (!a) { a = [0, 0, 0, 0]; ori.set(key, a); }
        a[o] += delta;
        if (a[0] + a[1] + a[2] + a[3] <= 0) ori.delete(key);
      }
    }
  }

  // Bus bonus of the step (ax, ay) -> (bx, by) in direction k: an existing trace runs parallel to it on a
  // neighbouring grid line (both neighbouring points carry a step of the same orientation)
  function busGain(ax, ay, bx, by, k) {
    if (S.bus <= 0) return 0;
    const o = k & 3;
    for (const [ox, oy] of EB_SIDE[o]) {
      const pa = ori.get(ebKey(ax + ox, ay + oy));
      if (!pa || pa[o] <= 0) continue;
      const pb = ori.get(ebKey(bx + ox, by + oy));
      if (pb && pb[o] > 0) return S.bus;
    }
    return 0;
  }

  // Free directions around a placed pad (neighbour point free and no crossing diagonal)
  function freeDirsAt(x, y) {
    let f = 0;
    for (let k = 0; k < 8; k++) {
      const qx = x + EB_DX[k], qy = y + EB_DY[k];
      const qk = ebKey(qx, qy);
      if (pads.has(qk) || trace.has(qk)) continue;
      if ((k & 1) && diag.has(diagSlot(x, y, qx, qy).other)) continue;
      f++;
    }
    return f;
  }

  // Free landing points two steps away from a pad (where the pads of its children can go)
  function landingPointsAt(x, y) {
    let f = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== 2) continue;
        const qx = x + dx, qy = y + dy;
        const qk = ebKey(qx, qy);
        if (pads.has(qk) || trace.has(qk) || padTooClose(qx, qy, ebKey(x, y))) continue;
        f++;
      }
    }
    return f;
  }

  function padTooClose(x, y, ignoreKey) {
    for (let dx = -(C - 1); dx <= C - 1; dx++) {
      for (let dy = -(C - 1); dy <= C - 1; dy++) {
        const k = ebKey(x + dx, y + dy);
        if (k !== ignoreKey && pads.has(k)) return true;
      }
    }
    return false;
  }

  // Finds a trace for child v of u (null if none fits and conflicts are not allowed)
  function findRoute(u, v, allowConflicts) {
    const P = pos[u];
    const wantEven = ebGender[v] !== "M";
    const kids = children[v].length;
    const want = size[v] - 1;
    const roomRadius = Math.min(S.roomMaxRadius, Math.max(2, Math.ceil(Math.sqrt(size[v]) * 0.9)));
    const roomWant = Math.min(want * S.roomPerVertex, ((2 * roomRadius + 1) ** 2 - 1) * 0.85);
    let best = null;

    // Reservation: a trace may not take the last free directions of a pad whose children are still waiting
    const freeCache = new Map();
    const landCache = new Map();
    const hits = new Map();
    const landHits = new Map();
    const needOf = w => (w === u ? pending[u] - 1 : (pending[w] || 0));
    const freeOf = w => {
      if (!freeCache.has(w)) freeCache.set(w, freeDirsAt(pos[w].x, pos[w].y));
      return freeCache.get(w);
    };
    const landOf = w => {
      if (!landCache.has(w)) landCache.set(w, landingPointsAt(pos[w].x, pos[w].y));
      return landCache.get(w);
    };

    const xs = [], ys = [];          // current candidate path (grid points, starting at P)
    const corners = [];              // indices of bend points
    const gains = [];                // bus bonus of every step of the candidate
    let len = 0, collisions = 0, gain = 0;

    function free(x, y, k, forcedMode) {
      // returns -1 = blocked, 0 = free, 1 = free only by colliding (forced mode)
      if (!inLimit(x, y)) return -1;
      const key = ebKey(x, y);
      if (pads.has(key)) return -1;
      let hit = 0;
      if (trace.has(key)) hit++;
      if (k & 1) {
        const px = x - EB_DX[k], py = y - EB_DY[k];
        const d = diagSlot(px, py, x, y);
        if (diag.has(d.other) || diag.has(d.mine)) hit++;
      }
      for (let i = 0; i < xs.length; i++) if (xs[i] === x && ys[i] === y) return -1;
      if (hit === 0) return 0;
      return forcedMode ? hit : -1;
    }

    function evaluate(finalDir, d1, bends) {
      const n = xs.length - 1;
      const ex = xs[n], ey = ys[n];
      const ekey = ebKey(ex, ey);
      if (trace.has(ekey) || padTooClose(ex, ey)) return;

      // bounding-box growth (corner points of the trace are enough: segments are straight between them)
      let minX = bb.minX, maxX = bb.maxX, minY = bb.minY, maxY = bb.maxY;
      const consider = i => {
        if (xs[i] < minX) minX = xs[i];
        if (xs[i] > maxX) maxX = xs[i];
        if (ys[i] < minY) minY = ys[i];
        if (ys[i] > maxY) maxY = ys[i];
      };
      corners.forEach(consider);
      consider(n);
      const growth = (maxX - minX + maxY - minY) - (bb.maxX - bb.minX + bb.maxY - bb.minY);

      // exact lower bound of the score (look-ahead penalties are >= 0, continuation bonus <= 1): skip the
      // expensive look-ahead when this candidate cannot beat the best one found so far
      if (best) {
        const outwardMax = S.outward * (Math.max(Math.abs(ex), Math.abs(ey)) - Math.max(Math.abs(P.x), Math.abs(P.y)));
        const lb = len - gain + 0.7 * bends + S.compact * growth - 1.0 - outwardMax + collisions * 400;
        if (lb >= best.score - 1e-9) return;
      }

      // look-ahead: free directions at the new pad for its own children, and free room for its sub-tree
      let freeDirs = 0;
      for (let k = 0; k < 8; k++) {
        const qx = ex + EB_DX[k], qy = ey + EB_DY[k];
        const qk = ebKey(qx, qy);
        if (pads.has(qk) || trace.has(qk)) continue;
        let onPath = false;
        for (let i = 0; i < n; i++) if (xs[i] === qx && ys[i] === qy) { onPath = true; break; }
        if (onPath) continue;
        if (k & 1) {
          const d = diagSlot(ex, ey, qx, qy);
          if (diag.has(d.other)) continue;
        }
        freeDirs++;
      }
      let roomPen = 0;
      if (want > 0) {
        // free room around the new pad, over a radius that grows with the size of its sub-tree
        const R = roomRadius;
        let room = 0;
        for (let dx = -R; dx <= R; dx++) {
          for (let dy = -R; dy <= R; dy++) {
            if (dx === 0 && dy === 0) continue;
            const qk = ebKey(ex + dx, ey + dy);
            if (!pads.has(qk) && !trace.has(qk)) room++;
          }
        }
        roomPen = S.roomWeight * Math.max(0, roomWant - room);
      }
      // radial growth (metro map): reward moving away from the root of the tree
      const outward = S.outward * (Math.max(Math.abs(ex), Math.abs(ey)) - Math.max(Math.abs(P.x), Math.abs(P.y)));
      const lookPen = Math.max(0, kids - freeDirs) * 60;
      const cont = (inDir[u] !== undefined && d1 === inDir[u]) ? 1.0 : 0;
      const score = len - gain + 0.7 * bends + S.compact * growth + lookPen + roomPen - cont - outward + collisions * 400;

      if (!best || score < best.score - 1e-9) {
        best = { score, xs: xs.slice(), ys: ys.slice(), finalDir, bends, collisions };
      }
    }

    // pads with waiting children next to point (x, y); returns false if taking the point would starve one of them
    function reserveHit(x, y, apply) {
      const near = [], ring = [];
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          if (dx === 0 && dy === 0) continue;
          const w = pads.get(ebKey(x + dx, y + dy));
          if (w === undefined || needOf(w) <= 0) continue;
          if (Math.max(Math.abs(dx), Math.abs(dy)) === 1) near.push(w); else ring.push(w);
        }
      }
      if (apply === 0) {
        for (const w of near) {
          if (freeOf(w) - ((hits.get(w) || 0) + 1) < needOf(w)) return false;
        }
        for (const w of ring) {
          if (w === u) continue;   // the current trace usually lands next to u itself
          if (landOf(w) - ((landHits.get(w) || 0) + 1) < needOf(w)) return false;
        }
        return true;
      }
      for (const w of near) hits.set(w, (hits.get(w) || 0) + apply);
      for (const w of ring) landHits.set(w, (landHits.get(w) || 0) + apply);
      return true;
    }

    function stepTo(k, forcedMode) {
      const n = xs.length - 1;
      const x = xs[n] + EB_DX[k], y = ys[n] + EB_DY[k];
      const f = free(x, y, k, forcedMode);
      if (f < 0) return false;
      if (!forcedMode) {
        if (!reserveHit(x, y, 0)) return false;
        reserveHit(x, y, 1);
      }
      const g = forcedMode ? 0 : busGain(xs[n], ys[n], x, y, k);
      xs.push(x); ys.push(y);
      gains.push(g);
      gain += g;
      len += (k & 1) ? Math.SQRT2 : 1;
      collisions += f;
      return true;
    }
    function unstep(k, f, forcedMode) {
      if (!forcedMode) reserveHit(xs[xs.length - 1], ys[ys.length - 1], -1);
      xs.pop(); ys.pop();
      gain -= gains.pop();
      len -= (k & 1) ? Math.SQRT2 : 1;
      collisions -= f;
    }
    // walk with bookkeeping of collision counts so steps can be undone
    function walk(k, forcedMode, maxLen, onEach) {
      const hist = [];
      for (let i = 1; i <= maxLen; i++) {
        const before = collisions;
        if (!stepTo(k, forcedMode)) break;
        hist.push(collisions - before);
        onEach(i);
      }
      for (let i = hist.length - 1; i >= 0; i--) unstep(k, hist[i], forcedMode);
    }

    function search(L, jog, forcedMode) {
      xs.length = 0; ys.length = 0; corners.length = 0; gains.length = 0; hits.clear(); landHits.clear();
      xs.push(P.x); ys.push(P.y);
      len = 0; collisions = 0; gain = 0;
      for (let d1 = 0; d1 < 8; d1++) {
        walk(d1, forcedMode, L, () => {
          if (((d1 & 1) === 0) === wantEven) evaluate(d1, d1, 0);
          for (const s of [1, -1]) {
            const d2 = (d1 + s + 8) % 8;
            corners.push(xs.length - 1);
            walk(d2, forcedMode, L, c => {
              if (((d2 & 1) === 0) === wantEven) evaluate(d2, d1, 1);
              // two-bend shapes: the last segment has the parity of d1
              if (jog && c <= EB_JOG_MAX && ((d1 & 1) === 0) === wantEven) {
                corners.push(xs.length - 1);
                walk(d1, forcedMode, L, () => evaluate(d1, d1, 2));            // dogleg: back to d1
                const d3 = (d2 + s + 8) % 8;
                walk(d3, forcedMode, L, () => evaluate(d3, d1, 2));            // chamfered 90-deg corner
                corners.pop();
              }
            });
            corners.pop();
          }
        });
      }
    }

    // Maze router (Lee / Dijkstra on the grid, as used for PCB routing): any number of 45-degree turns; 90-degree
    // turns are allowed but expensive (a real board chamfers its corners).
    // Used when no straight / one-bend / dogleg trace fits. The state is (grid point, direction of arrival).
    function mazeRoute(strictLookahead) {
      const MAX_EXPANSIONS = 60000;
      const heap = [];
      const push = (c, s) => {
        heap.push({ c, s });
        let i = heap.length - 1;
        while (i > 0) {
          const pi = (i - 1) >> 1;
          if (heap[pi].c <= heap[i].c) break;
          [heap[pi], heap[i]] = [heap[i], heap[pi]];
          i = pi;
        }
      };
      const pop = () => {
        const top = heap[0];
        const last = heap.pop();
        if (heap.length) {
          heap[0] = last;
          let i = 0;
          for (;;) {
            const l = 2 * i + 1, r = l + 1;
            let m = i;
            if (l < heap.length && heap[l].c < heap[m].c) m = l;
            if (r < heap.length && heap[r].c < heap[m].c) m = r;
            if (m === i) break;
            [heap[m], heap[i]] = [heap[i], heap[m]];
            i = m;
          }
        }
        return top;
      };
      const dist = new Map(), prev = new Map(), info = new Map();
      const stateKey = (x, y, d) => ebKey(x, y) * 8 + d;

      const stepOk = (fx, fy, d) => {
        const x = fx + EB_DX[d], y = fy + EB_DY[d];
        if (!inLimit(x, y)) return null;
        const k = ebKey(x, y);
        if (pads.has(k) || trace.has(k)) return null;
        if (d & 1) {
          const s = diagSlot(fx, fy, x, y);
          if (diag.has(s.other) || diag.has(s.mine)) return null;
        }
        let extra = 0;
        for (let ddx = -2; ddx <= 2; ddx++) {
          for (let ddy = -2; ddy <= 2; ddy++) {
            if (ddx === 0 && ddy === 0) continue;
            const w = pads.get(ebKey(x + ddx, y + ddy));
            if (w === undefined) continue;
            const need = needOf(w);
            if (need <= 0) continue;
            if (Math.max(Math.abs(ddx), Math.abs(ddy)) === 1) {
              if (freeOf(w) - 1 < need) return null;   // would starve a pad that still has children to route
              extra += 2;
            } else if (w !== u) {
              if (landOf(w) - 1 < need) return null;
              extra += 1;
            }
          }
        }
        const stepLen = (d & 1) ? Math.SQRT2 : 1;
        const g = Math.min(busGain(fx, fy, x, y, d), stepLen - 0.2);   // keeps every step cost positive
        return { x, y, extra: extra - g };
      };

      for (let d = 0; d < 8; d++) {
        const s = stepOk(P.x, P.y, d);
        if (!s) continue;
        const sk = stateKey(s.x, s.y, d);
        const c = ((d & 1) ? Math.SQRT2 : 1) + s.extra;
        dist.set(sk, c);
        prev.set(sk, -1);
        info.set(sk, { x: s.x, y: s.y, d });
        push(c, sk);
      }

      let expansions = 0;
      while (heap.length && expansions < MAX_EXPANSIONS) {
        const { c, s } = pop();
        if (c > dist.get(s)) continue;
        expansions++;
        const st = info.get(s);
        // goal test: valid pad position, arrival direction obeys the gender rule
        if (((st.d & 1) === 0) === wantEven && !padTooClose(st.x, st.y) &&
            (!strictLookahead || freeDirsAt(st.x, st.y) >= kids)) {
          const pxs = [], pys = [];
          let bends = 0, lastD = st.d;
          for (let cur = s; cur !== -1; cur = prev.get(cur)) {
            const ci = info.get(cur);
            pxs.push(ci.x); pys.push(ci.y);
            if (ci.d !== lastD) { bends++; lastD = ci.d; }
          }
          pxs.push(P.x); pys.push(P.y);
          pxs.reverse(); pys.reverse();
          return { score: c, xs: pxs, ys: pys, finalDir: st.d, bends, collisions: 0 };
        }
        for (const turn of [0, 1, -1, 2, -2]) {
          const nd = (st.d + turn + 8) % 8;
          const nx = stepOk(st.x, st.y, nd);
          if (!nx) continue;
          const nc = c + ((nd & 1) ? Math.SQRT2 : 1) + (turn === 0 ? 0 : (Math.abs(turn) === 1 ? 0.7 : 3.0)) + nx.extra;
          const nk = stateKey(nx.x, nx.y, nd);
          if (!dist.has(nk) || nc < dist.get(nk) - 1e-9) {
            dist.set(nk, nc);
            prev.set(nk, s);
            info.set(nk, { x: nx.x, y: nx.y, d: nd });
            push(nc, nk);
          }
        }
      }
      return null;
    }

    const lengths = [S.maxSeg, S.maxSeg * 2];
    for (const L of lengths) {
      search(L, S.doglegs && L === S.maxSeg, false);
      if (best) break;
    }
    if (!best) best = mazeRoute(true) || mazeRoute(false);
    if (best || !allowConflicts) return best;

    search(Math.max(S.maxSeg * 2, (bb.maxX - bb.minX) + (bb.maxY - bb.minY) + 4), false, true);
    if (!best) {
      // last resort: a new pad just outside the tree, joined by a straight trace (reported as a conflict)
      const x = bb.maxX + C + 1;
      const xs2 = [P.x], ys2 = [P.y];
      for (let cx = P.x + 1; cx <= x; cx++) { xs2.push(cx); ys2.push(P.y); }
      best = { score: 0, xs: xs2, ys: ys2, finalDir: 0, bends: 0, collisions: 1 };
    }
    return best;
  }

  function commit(u, v, best) {
    const ek = [u, v].sort().join("-");
    const n = best.xs.length - 1;
    pos[v] = { x: best.xs[n], y: best.ys[n] };
    pads.set(ebKey(pos[v].x, pos[v].y), v);
    for (let i = 1; i <= n; i++) {
      const x = best.xs[i], y = best.ys[i];
      if (i < n) trace.set(ebKey(x, y), ek);
      const px = best.xs[i - 1], py = best.ys[i - 1];
      if (x !== px && y !== py) diag.set(diagSlot(px, py, x, y).mine, ek);
      if (x < bb.minX) bb.minX = x;
      if (x > bb.maxX) bb.maxX = x;
      if (y < bb.minY) bb.minY = y;
      if (y > bb.maxY) bb.maxY = y;
    }
    addOri(best.xs, best.ys, 1);
    inDir[v] = best.finalDir;
    pending[u] = Math.max(0, (pending[u] || 0) - 1);
    pending[v] = children[v].length;
    paths[ek] = { u, v, xs: best.xs, ys: best.ys, bends: best.bends };
    if (best.collisions > 0) forced.push(`${u} → ${v}`);
  }

  // --- Rip-up and reroute (as in PCB routers) ---
  // A trace to a vertex whose own children are not placed yet can be removed and drawn again elsewhere.
  function ripUp(ek) {
    const p = paths[ek];
    const n = p.xs.length - 1;
    for (let i = 1; i <= n; i++) {
      if (i < n) trace.delete(ebKey(p.xs[i], p.ys[i]));
      const px = p.xs[i - 1], py = p.ys[i - 1];
      if (p.xs[i] !== px && p.ys[i] !== py) diag.delete(diagSlot(px, py, p.xs[i], p.ys[i]).mine);
    }
    addOri(p.xs, p.ys, -1);
    pads.delete(ebKey(pos[p.v].x, pos[p.v].y));
    delete pos[p.v];
    delete inDir[p.v];
    delete pending[p.v];
    delete paths[ek];
    pending[p.u] = (pending[p.u] || 0) + 1;
  }

  function snapshot() {
    return {
      pads: new Map(pads), trace: new Map(trace), diag: new Map(diag),
      ori: new Map(Array.from(ori, ([k, a]) => [k, a.slice()])),
      pos: Object.assign({}, pos), inDir: Object.assign({}, inDir), paths: Object.assign({}, paths),
      pending: Object.assign({}, pending), bb: Object.assign({}, bb), forced: forced.length
    };
  }

  function restore(s) {
    const refill = (m, src) => { m.clear(); src.forEach((val, key) => m.set(key, val)); };
    refill(pads, s.pads); refill(trace, s.trace); refill(diag, s.diag);
    ori.clear(); s.ori.forEach((a, k) => ori.set(k, a.slice()));
    const reobj = (o, src) => { Object.keys(o).forEach(k => delete o[k]); Object.assign(o, src); };
    reobj(pos, s.pos); reobj(inDir, s.inDir); reobj(paths, s.paths); reobj(pending, s.pending);
    Object.assign(bb, s.bb);
    forced.length = s.forced;
  }

  // Routes v from u; when it does not fit, nearby movable traces are ripped up and rerouted after v
  function route(u, v) {
    const direct = findRoute(u, v, false);
    if (direct) { commit(u, v, direct); return true; }

    const P = pos[u];
    const movable = Object.keys(paths)
      .map(ek => paths[ek])
      .filter(p => p.v !== u && children[p.v].every(c => !(c in pos)))
      .map(p => {
        let d = Infinity;
        for (let i = 1; i < p.xs.length; i++) d = Math.min(d, Math.max(Math.abs(p.xs[i] - P.x), Math.abs(p.ys[i] - P.y)));
        return { ek: [p.u, p.v].sort().join("-"), u: p.u, v: p.v, d };
      })
      .filter(m => m.d <= 4)
      .sort((a, b) => a.d - b.d);

    for (let m = 1; m <= Math.min(6, movable.length); m++) {
      const saved = snapshot();
      const ripped = movable.slice(0, m);
      ripped.forEach(r => ripUp(r.ek));
      const r0 = findRoute(u, v, false);
      if (r0) {
        commit(u, v, r0);
        let ok = true;
        for (const r of ripped) {
          const rr = findRoute(r.u, r.v, false);
          if (!rr) { ok = false; break; }
          commit(r.u, r.v, rr);
        }
        if (ok) return true;
      }
      restore(saved);
    }

    commit(u, v, findRoute(u, v, true));
    return true;
  }

  for (const u of order) {
    for (const v of children[u]) {
      route(u, v);
    }
  }

  // --- Squeeze (rip-up compaction, as in VLSI / PCB layout compaction) ---
  // Repeatedly takes one side of the bounding box, rips up every sub-tree that touches that side and routes it
  // again inside the box shrunk by one grid step. A shrink is kept only if everything routes without conflicts.
  function recomputeBB() {
    bb.minX = bb.maxX = pos[root].x;
    bb.minY = bb.maxY = pos[root].y;
    Object.keys(paths).forEach(ek => {
      const p = paths[ek];
      for (let i = 0; i < p.xs.length; i++) {
        if (p.xs[i] < bb.minX) bb.minX = p.xs[i];
        if (p.xs[i] > bb.maxX) bb.maxX = p.xs[i];
        if (p.ys[i] < bb.minY) bb.minY = p.ys[i];
        if (p.ys[i] > bb.maxY) bb.maxY = p.ys[i];
      }
    });
  }
  function squeeze(budget) {
    const t0 = performance.now();
    let lastDur = 0;
    const maxRip = Math.max(12, Math.ceil(bfsOrder.length * 0.3));
    const subtree = v => { const out = [v]; for (let i = 0; i < out.length; i++) out.push(...children[out[i]]); return out; };
    let fails = 0, side = 0, shrinks = 0;
    while (fails < 4) {
      const stepStart = performance.now();
      if (stepStart - t0 + lastDur > budget) break;   // start a step only if it should finish within the budget
      const sd = side;
      side = (side + 1) % 4;
      recomputeBB();
      const horizontal = sd < 2;
      if ((horizontal ? bb.maxX - bb.minX : bb.maxY - bb.minY) < 2) { fails++; continue; }
      const line = [bb.maxX, bb.minX, bb.maxY, bb.minY][sd];
      const onLine = (x, y) => (horizontal ? x : y) === line;
      const lim = Object.assign({}, bb);
      if (sd === 0) lim.maxX--; else if (sd === 1) lim.minX++; else if (sd === 2) lim.maxY--; else lim.minY++;

      const touch = new Set();
      Object.keys(pos).forEach(v => { if (onLine(pos[v].x, pos[v].y)) touch.add(v); });
      Object.keys(paths).forEach(ek => {
        const p = paths[ek];
        for (let i = 0; i < p.xs.length; i++) if (onLine(p.xs[i], p.ys[i])) { touch.add(p.v); break; }
      });
      if (touch.has(root)) { fails++; continue; }
      const R = new Set();
      touch.forEach(v => subtree(v).forEach(w => R.add(w)));
      if (R.size > maxRip) { fails++; continue; }

      const saved = snapshot();
      const forcedBefore = forced.length;
      order.filter(v => R.has(v)).reverse().forEach(v => ripUp([parent[v], v].sort().join("-")));
      recomputeBB();
      limit = lim;
      for (const v of order) if (R.has(v)) route(parent[v], v);
      limit = null;
      if (forced.length > forcedBefore) { restore(saved); fails++; }
      else { fails = 0; shrinks++; }
      lastDur = performance.now() - stepStart;
    }
    recomputeBB();
    return shrinks;
  }
  const result = { pos, paths, bb, forced, root, shrinks: 0 };
  // the squeeze works on the internal state, so it can also be run later on a chosen attempt (no re-layout)
  result.squeeze = budget => {
    if (bfsOrder.length < 4) return 0;
    const k = squeeze(budget);
    result.shrinks += k;
    return k;
  };
  if (S.squeeze) result.squeeze(S.squeezeMs);
  return result;
}

// A tree whose routing needed conflicting traces is laid out again: with the user's settings plus a radial
// (outward-growing, less compact) variant, from alternative roots (if the user did not fix the root: the
// highest-degree vertex, the first vertex, neighbours of the centre), then with further setting variants.
// The result with the fewest conflicts (then the smallest board at the chosen aspect ratio) is kept; retries stop
// after a time budget.
function ebLayoutTreeBest(comp, root, S, rootFixed) {
  const other = S.order === "bfs" ? "dfs" : "bfs";
  const radial = Object.assign({}, S, { compact: S.compact * 0.5, outward: 0.6 });
  const roomy = Object.assign({}, S, { compact: S.compact * 0.5, roomPerVertex: 3, roomMaxRadius: 4 });
  const later = [
    Object.assign({}, S, { bus: 0 }),
    Object.assign({}, S, { compact: S.compact * 0.5 }),
    Object.assign({}, S, { compact: 0.25 }),
    Object.assign({}, S, { maxSeg: Math.min(12, S.maxSeg + 3), compact: S.compact * 0.5 }),
    Object.assign({}, S, { order: other })
  ];
  const roots = [root];
  if (!rootFixed && comp.length > 2) {
    const byDegree = comp.slice().sort((a, b) => (ebGraph[b].length - ebGraph[a].length) || ebCompareLabels(a, b));
    [byDegree[0], comp[0]].concat(ebGraph[root]).forEach(r => { if (!roots.includes(r)) roots.push(r); });
  }
  const attempts = [];
  roots.forEach(r => { attempts.push([r, S], [r, radial]); });
  roots.forEach(r => { attempts.push([r, roomy]); });
  later.forEach(v => roots.forEach(r => attempts.push([r, v])));

  // Attempts run without the squeeze pass. Until one is conflict-free, the time budget is BUDGET_MS; after that
  // further attempts are tried only while they should fit in CHOOSE_MS, to find a smaller conflict-free board.
  // An extra attempt for a smaller board is started only if it should finish within CHOOSE_MS (judged by the
  // previous attempt).
  // The squeeze pass then runs on the chosen attempt itself.
  let best = null, okSince = null, lastDur = 0;
  const t0 = performance.now();
  const BUDGET_MS = 4000, CHOOSE_MS = S.chooseMs;
  const plain = v => Object.assign({}, v, { squeeze: false });
  for (const [r, v] of attempts) {
    const now = performance.now();
    if (best && now - t0 > BUDGET_MS) break;                      // as before: retries while routes conflict
    if (okSince !== null && now - okSince + lastDur > CHOOSE_MS) break;
    const t = ebLayoutTree(comp, r, plain(v));
    lastDur = performance.now() - now;
    // board size at the wanted aspect ratio: area of the smallest w/h = aspect box around the tree
    const bw = t.bb.maxX - t.bb.minX + 1, bh = t.bb.maxY - t.bb.minY + 1;
    const side = Math.max(bw, bh * S.aspect);
    const area = side * side / S.aspect;
    if (!best || t.forced.length < best.t.forced.length ||
        (t.forced.length === best.t.forced.length && area < best.area)) {
      best = { t, area, r, v };
    }
    if (best.t.forced.length === 0 && okSince === null) okSince = performance.now();
  }
  if (S.squeeze) best.t.squeeze(S.squeezeMs);
  return best.t;
}

// --- 4. Forest packing by footprint ---
// Occupied grid points, pads and diagonal slots of a laid-out tree (in its own coordinates)
function ebFootprint(t) {
  const pads = [], pts = [], diags = [];
  const seen = new Set();
  const addPt = (x, y) => { const k = ebKey(x, y); if (!seen.has(k)) { seen.add(k); pts.push([x, y]); } };
  Object.keys(t.pos).forEach(n => { pads.push([t.pos[n].x, t.pos[n].y]); addPt(t.pos[n].x, t.pos[n].y); });
  Object.keys(t.paths).forEach(k => {
    const p = t.paths[k];
    for (let i = 0; i < p.xs.length; i++) {
      addPt(p.xs[i], p.ys[i]);
      if (i > 0 && p.xs[i] !== p.xs[i - 1] && p.ys[i] !== p.ys[i - 1]) {
        const dx = p.xs[i] - p.xs[i - 1], dy = p.ys[i] - p.ys[i - 1];
        diags.push([Math.min(p.xs[i], p.xs[i - 1]), Math.min(p.ys[i], p.ys[i - 1]), dx * dy > 0 ? 0 : 1]);
      }
    }
  });
  return { pads, pts, diags };
}

function ebLayoutForest(S) {
  const t0 = performance.now();
  const comps = ebComponents();
  const rootInp = document.getElementById("rootNode");
  const wantedRoot = rootInp && rootInp.value ? rootInp.value.trim().toUpperCase() : "";

  const total = comps.reduce((s, c) => s + c.length, 0);
  const trees = comps.map(comp => {
    const root = (wantedRoot && comp.includes(wantedRoot)) ? wantedRoot : ebTreeCentre(comp);
    // the time budgets are shared by the trees in proportion to their size
    const share = comp.length / total;
    // (no per-tree minimum: with many small trees the minimums would add up)
    const St = Object.assign({}, S, { squeezeMs: S.squeezeMs * share, chooseMs: S.chooseMs * share });
    const t = ebLayoutTreeBest(comp, root, St, !!(wantedRoot && comp.includes(wantedRoot)));
    t.w = t.bb.maxX - t.bb.minX;
    t.h = t.bb.maxY - t.bb.minY;
    t.size = comp.length;
    t.fp = ebFootprint(t);
    return t;
  });

  // Trees are placed one by one, largest footprint first. For every candidate offset the board's new size
  // max(W, H * aspect) is computed; among the offsets giving the smallest size (then the smallest area, then the
  // top-left-most) the first legal one is taken. Legal = the same rules as inside a tree: no shared grid point,
  // no crossing diagonals, pads at least the clearance apart. Small trees therefore fill the gaps of big ones.
  const C = S.clearance;
  const occ = new Set();       // occupied grid points (pads and traces) of placed trees
  const padZone = new Set();   // points closer than the clearance to a placed pad
  const diagUsed = new Set();  // square key * 2 + type
  const B = { minX: 0, maxX: 0, minY: 0, maxY: 0, empty: true };

  const legal = (fp, ox, oy) => {
    for (const [x, y] of fp.pads) if (padZone.has(ebKey(x + ox, y + oy))) return false;
    for (const [x, y] of fp.pts) if (occ.has(ebKey(x + ox, y + oy))) return false;
    for (const [x, y, ty] of fp.diags) if (diagUsed.has(ebKey(x + ox, y + oy) * 2 + (1 - ty))) return false;
    return true;
  };
  const place = (t, ox, oy) => {
    t.fp.pts.forEach(([x, y]) => occ.add(ebKey(x + ox, y + oy)));
    t.fp.pads.forEach(([x, y]) => {
      for (let dx = -(C - 1); dx <= C - 1; dx++) {
        for (let dy = -(C - 1); dy <= C - 1; dy++) padZone.add(ebKey(x + ox + dx, y + oy + dy));
      }
    });
    t.fp.diags.forEach(([x, y, ty]) => diagUsed.add(ebKey(x + ox, y + oy) * 2 + ty));
    if (B.empty) {
      B.minX = t.bb.minX + ox; B.maxX = t.bb.maxX + ox; B.minY = t.bb.minY + oy; B.maxY = t.bb.maxY + oy;
      B.empty = false;
    } else {
      B.minX = Math.min(B.minX, t.bb.minX + ox); B.maxX = Math.max(B.maxX, t.bb.maxX + ox);
      B.minY = Math.min(B.minY, t.bb.minY + oy); B.maxY = Math.max(B.maxY, t.bb.maxY + oy);
    }
  };

  const idx = trees.map((t, i) => i).sort((a, b) =>
    (trees[b].fp.pts.length - trees[a].fp.pts.length) || ((trees[b].w + 1) * (trees[b].h + 1) - (trees[a].w + 1) * (trees[a].h + 1)) ||
    (trees[b].size - trees[a].size) || (a - b));
  const offsets = {};
  idx.forEach(i => {
    const t = trees[i];
    if (B.empty) { offsets[i] = { x: 0, y: 0 }; place(t, 0, 0); return; }
    // all candidate offsets in scan order (top-left first), sorted by (board size, area); a stable sort keeps
    // the scan order for ties, so the first legal candidate is the one a full scan would choose
    const oxMin = B.minX - t.bb.maxX - C, oxMax = B.maxX - t.bb.minX + C;
    const oyMin = B.minY - t.bb.maxY - C, oyMax = B.maxY - t.bb.minY + C;
    const cand = [];
    for (let oy = oyMin; oy <= oyMax; oy++) {
      for (let ox = oxMin; ox <= oxMax; ox++) {
        const W = Math.max(B.maxX, t.bb.maxX + ox) - Math.min(B.minX, t.bb.minX + ox);
        const H = Math.max(B.maxY, t.bb.maxY + oy) - Math.min(B.minY, t.bb.minY + oy);
        cand.push({ f: Math.max(W, H * S.aspect), area: (W + 1) * (H + 1), ox, oy });
      }
    }
    cand.sort((a, b) => (Math.abs(a.f - b.f) > 1e-9 ? a.f - b.f : a.area - b.area));
    let best = null;
    for (const c of cand) if (legal(t.fp, c.ox, c.oy)) { best = c; break; }
    if (!best) best = { ox: B.maxX - t.bb.minX + C + 1, oy: B.minY - t.bb.minY };   // cannot happen: outside is free
    offsets[i] = { x: best.ox, y: best.oy };
    place(t, best.ox, best.oy);
  });

  const margin = 1;
  const pos = {}, paths = {}, forced = [], roots = [];
  trees.forEach((t, i) => {
    const o = { x: offsets[i].x - B.minX + margin, y: offsets[i].y - B.minY + margin };
    Object.keys(t.pos).forEach(n => { pos[n] = { x: t.pos[n].x + o.x, y: t.pos[n].y + o.y }; });
    Object.keys(t.paths).forEach(k => {
      const p = t.paths[k];
      paths[k] = { u: p.u, v: p.v, bends: p.bends, xs: p.xs.map(v => v + o.x), ys: p.ys.map(v => v + o.y) };
    });
    forced.push(...t.forced);
    roots.push(t.root);
  });

  return {
    pos, paths, forced, roots,
    trees: trees.length,
    gridW: (B.maxX - B.minX) + 2 * margin,
    gridH: (B.maxY - B.minY) + 2 * margin,
    pitch: S.pitch,
    clearance: S.clearance,
    showGrid: S.showGrid,
    theme: S.theme,
    ms: performance.now() - t0
  };
}

// --- 5. Independent verification of the drawing ---
function ebVerify(L) {
  const vertexIssues = [], traceIssues = [], genderIssues = [], marks = [];
  const padAt = new Map();
  Object.keys(L.pos).forEach(n => {
    const k = ebKey(L.pos[n].x, L.pos[n].y);
    if (padAt.has(k)) {
      vertexIssues.push(`Pads ${padAt.get(k)} and ${n} are on the same point (${L.pos[n].x}, ${L.pos[n].y}).`);
      marks.push(L.pos[n]);
    } else padAt.set(k, n);
  });
  const names = Object.keys(L.pos);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = L.pos[names[i]], b = L.pos[names[j]];
      const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      if (d > 0 && d < L.clearance) {
        vertexIssues.push(`Pads ${names[i]} and ${names[j]} are closer than the pad clearance (${d} < ${L.clearance} grid steps).`);
        marks.push(a, b);
      }
    }
  }

  const tracePt = new Map(), diagUse = new Map();
  const reported = new Set();
  Object.keys(L.paths).forEach(ek => {
    const p = L.paths[ek];
    const n = p.xs.length - 1;
    const sx = p.xs[0], sy = p.ys[0], tx = p.xs[n], ty = p.ys[n];
    if (sx !== L.pos[p.u].x || sy !== L.pos[p.u].y || tx !== L.pos[p.v].x || ty !== L.pos[p.v].y) {
      traceIssues.push(`Trace ${ek} does not connect the pads of ${p.u} and ${p.v}.`);
    }
    for (let i = 1; i <= n; i++) {
      const dx = p.xs[i] - p.xs[i - 1], dy = p.ys[i] - p.ys[i - 1];
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1 || (dx === 0 && dy === 0)) {
        traceIssues.push(`Trace ${ek} has a step that is not a unit octilinear step.`);
        continue;
      }
      if (i < n) {
        const k = ebKey(p.xs[i], p.ys[i]);
        if (padAt.has(k)) {
          traceIssues.push(`Trace ${ek} passes through pad ${padAt.get(k)}.`);
          marks.push({ x: p.xs[i], y: p.ys[i] });
        }
        if (tracePt.has(k) && tracePt.get(k) !== ek) {
          const pair = [tracePt.get(k), ek].sort().join(" & ");
          if (!reported.has(pair)) {
            reported.add(pair);
            traceIssues.push(`Traces ${pair} overlap at (${p.xs[i]}, ${p.ys[i]}).`);
            marks.push({ x: p.xs[i], y: p.ys[i] });
          }
        } else tracePt.set(k, ek);
      }
      if (dx !== 0 && dy !== 0) {
        const qx = Math.min(p.xs[i], p.xs[i - 1]), qy = Math.min(p.ys[i], p.ys[i - 1]);
        const type = dx * dy > 0 ? 0 : 1;
        const base = ebKey(qx, qy) * 2;
        const other = diagUse.get(base + 1 - type);
        if (other && other !== ek) {
          const pair = [other, ek].sort().join(" & ");
          if (!reported.has("x" + pair)) {
            reported.add("x" + pair);
            traceIssues.push(`Traces ${pair} cross at (${qx + 0.5}, ${qy + 0.5}).`);
            marks.push({ x: qx + 0.5, y: qy + 0.5 });
          }
        }
        diagUse.set(base + type, ek);
      }
    }
    // gender rule on arrival at the child
    const ax = p.xs[n] - p.xs[n - 1], ay = p.ys[n] - p.ys[n - 1];
    const diagonal = ax !== 0 && ay !== 0;
    if (diagonal !== (ebGender[p.v] === "M")) {
      genderIssues.push(`${p.v} (${ebGender[p.v] === "M" ? "male" : "female"}) is reached by a ${diagonal ? "diagonal" : "horizontal/vertical"} segment.`);
    }
  });
  return { vertexIssues, traceIssues, genderIssues, marks };
}

// --- Drawing (SVG) ---
function ebPathD(p, pitch) {
  // keep only the corner points of the trace
  const pts = [];
  const n = p.xs.length - 1;
  for (let i = 0; i <= n; i++) {
    if (i > 0 && i < n) {
      const d1x = p.xs[i] - p.xs[i - 1], d1y = p.ys[i] - p.ys[i - 1];
      const d2x = p.xs[i + 1] - p.xs[i], d2y = p.ys[i + 1] - p.ys[i];
      if (d1x === d2x && d1y === d2y) continue;
    }
    pts.push(`${p.xs[i] * pitch} ${p.ys[i] * pitch}`);
  }
  return "M " + pts.join(" L ");
}

function ebBoardSize(L) {
  return { w: L.gridW * L.pitch, h: L.gridH * L.pitch };
}

function ebRender() {
  const svg = document.getElementById("board");
  if (!svg) return;
  const L = window.ebView.layout;
  const rot = window.ebView.rotated;
  const s = window.ebView.scale;

  if (!L || Object.keys(L.pos).length === 0) {
    svg.setAttribute("width", 600);
    svg.setAttribute("height", 160);
    svg.setAttribute("viewBox", "0 0 600 160");
    const th0 = EB_THEMES[ebSettings().theme];
    svg.innerHTML = `<rect x="0" y="0" width="600" height="160" rx="10" fill="${th0.board}"/>` +
      `<text x="300" y="85" text-anchor="middle" font-family="sans-serif" font-size="14" fill="${th0.text}">` +
      `Load a forest (adjacency list / matrix) or add vertices in the Visual Builder.</text>`;
    return;
  }

  const p = L.pitch;
  const th = EB_THEMES[L.theme] || EB_THEMES.blue;
  const { w, h } = ebBoardSize(L);
  const vw = rot ? h : w, vh = rot ? w : h;
  svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
  svg.setAttribute("width", Math.ceil(vw * s));
  svg.setAttribute("height", Math.ceil(vh * s));

  const out = [];
  out.push(`<defs>
    <radialGradient id="ebSilver" cx="38%" cy="35%" r="70%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#d9dde0"/>
      <stop offset="100%" stop-color="#8d969c"/>
    </radialGradient>
  </defs>`);
  out.push(`<g transform="${rot ? `translate(${h},0) rotate(90)` : ""}">`);
  out.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${p * 0.5}" fill="${th.board}"/>`);

  if (L.showGrid) {
    const dots = [];
    for (let gx = 1; gx < L.gridW; gx++) {
      for (let gy = 1; gy < L.gridH; gy++) dots.push(`M${gx * p} ${gy * p}h0.01`);
    }
    out.push(`<path d="${dots.join("")}" stroke="${th.grid}" stroke-width="2" stroke-linecap="round"/>`);
  }

  // traces: thin copper under solder mask - dark edge, lighter top and a faint highlight, so parallel buses
  // on neighbouring grid lines stay clearly separated
  const ds = Object.keys(L.paths).map(k => ebPathD(L.paths[k], p));
  out.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  ds.forEach(d => out.push(`<path d="${d}" stroke="${th.outline}" stroke-width="${(p * 0.30).toFixed(2)}"/>`));
  ds.forEach(d => out.push(`<path d="${d}" stroke="${th.trace}" stroke-width="${(p * 0.17).toFixed(2)}"/>`));
  ds.forEach(d => out.push(`<path d="${d}" stroke="${th.shine}" stroke-opacity="0.45" stroke-width="${(p * 0.05).toFixed(2)}"/>`));
  out.push(`</g>`);

  // conflict markers
  if (window.ebView.check) {
    window.ebView.check.marks.forEach(m => {
      out.push(`<circle cx="${m.x * p}" cy="${m.y * p}" r="${p * 0.6}" fill="none" stroke="#ff2d2d" stroke-width="2.5"/>`);
    });
  }

  // pads
  const r = p * 0.36;
  Object.keys(L.pos).sort(ebCompareLabels).forEach(n => {
    const cx = L.pos[n].x * p, cy = L.pos[n].y * p;
    const male = ebGender[n] === "M";
    const ring = male ? "#1f7fd1" : "#e0186a";
    const sel = (typeof ebSelected !== "undefined" && ebSelected === n);
    const isRoot = L.roots.includes(n);
    const fs = Math.min(p * 0.5, (r * 2 * 0.95) / (0.62 * n.length));
    out.push(`<g class="pad" data-name="${n}" style="cursor:pointer">`);
    if (sel) out.push(`<circle cx="${cx}" cy="${cy}" r="${r + p * 0.22}" fill="none" stroke="#ffe11a" stroke-width="${Math.max(2, p * 0.12)}"/>`);
    if (isRoot) out.push(`<rect x="${cx - r - p * 0.12}" y="${cy - r - p * 0.12}" width="${2 * r + p * 0.24}" height="${2 * r + p * 0.24}" rx="${p * 0.12}" fill="none" stroke="#c9d1d6" stroke-width="1.2"/>`);
    const rw = Math.max(1.6, p * 0.1);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#0b1424" stroke-opacity="0.75" stroke-width="${(rw + 2).toFixed(2)}"/>`);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#ebSilver)" stroke="${ring}" stroke-width="${rw.toFixed(2)}"/>`);
    out.push(`<text x="${cx}" y="${cy}" ${rot ? `transform="rotate(-90 ${cx} ${cy})"` : ""} text-anchor="middle" dominant-baseline="central" ` +
      `font-family="Arial, sans-serif" font-weight="bold" font-size="${fs.toFixed(2)}" fill="#1c2226">${n}</text>`);
    out.push(`</g>`);
  });
  out.push(`</g>`);
  svg.innerHTML = out.join("");
}

// --- Reports ---
function ebFillList(id, items, emptyText) {
  const ul = document.getElementById(id);
  if (!ul) return;
  ul.innerHTML = "";
  if (!items.length) {
    const li = document.createElement("li");
    li.style.color = "#27ae60";
    li.style.fontWeight = "bold";
    li.textContent = emptyText;
    ul.appendChild(li);
    return;
  }
  items.slice(0, 200).forEach(t => {
    const li = document.createElement("li");
    li.textContent = t;
    ul.appendChild(li);
  });
  if (items.length > 200) {
    const li = document.createElement("li");
    li.textContent = `... and ${items.length - 200} more.`;
    ul.appendChild(li);
  }
}

function ebComputeStats(L) {
  let length = 0, bends = 0, straight = 0, doglegs = 0, steps = 0, busSteps = 0;
  const keys = Object.keys(L.paths);
  // orientations of the steps touching every grid point, per trace (for the bus statistic)
  const at = new Map();
  keys.forEach(k => {
    const p = L.paths[k];
    for (let i = 1; i < p.xs.length; i++) {
      const o = ebDirOf(p.xs[i] - p.xs[i - 1], p.ys[i] - p.ys[i - 1]) & 3;
      for (const j of [i - 1, i]) {
        const key = ebKey(p.xs[j], p.ys[j]);
        if (!at.has(key)) at.set(key, []);
        at.get(key).push(k + "#" + o);
      }
    }
  });
  const hasOther = (x, y, k, o) => {
    const a = at.get(ebKey(x, y));
    return !!a && a.some(e => e.endsWith("#" + o) && e !== k + "#" + o);
  };
  keys.forEach(k => {
    const p = L.paths[k];
    for (let i = 1; i < p.xs.length; i++) {
      const diagStep = p.xs[i] !== p.xs[i - 1] && p.ys[i] !== p.ys[i - 1];
      length += diagStep ? Math.SQRT2 : 1;
      steps++;
      const o = ebDirOf(p.xs[i] - p.xs[i - 1], p.ys[i] - p.ys[i - 1]) & 3;
      if (EB_SIDE[o].some(([ox, oy]) => hasOther(p.xs[i - 1] + ox, p.ys[i - 1] + oy, k, o) && hasOther(p.xs[i] + ox, p.ys[i] + oy, k, o))) busSteps++;
    }
    bends += p.bends;
    if (p.bends === 0) straight++;
    if (p.bends === 2) doglegs++;
  });
  const V = Object.keys(L.pos).length;
  const pts = (L.gridW - 1) * (L.gridH - 1);
  return {
    V, E: keys.length, trees: L.trees,
    grid: `${L.gridW - 2} × ${L.gridH - 2}`,
    px: `${Math.round(L.gridW * L.pitch)} × ${Math.round(L.gridH * L.pitch)} px`,
    density: V ? (V / pts) : 0,
    pointsPerVertex: V ? (pts / V) : 0,
    avgLen: keys.length ? length / keys.length : 0,
    busShare: steps ? busSteps / steps : 0,
    bends, straight, doglegs
  };
}

function ebShowStats(L) {
  const el = document.getElementById("statsBox");
  if (!el) return;
  if (!L || !Object.keys(L.pos).length) { el.innerHTML = "<em>No drawing yet.</em>"; return; }
  const st = ebComputeStats(L);
  const pct = n => st.E ? Math.round(100 * n / st.E) + "%" : "-";
  el.innerHTML =
    `<table class="stats">` +
    `<tr><td>Trees</td><td>${st.trees}</td><td>Vertices / edges</td><td>${st.V} / ${st.E}</td></tr>` +
    `<tr><td>Board (grid steps)</td><td>${st.grid}</td><td>Board (pixels)</td><td>${st.px}</td></tr>` +
    `<tr><td>Grid points per vertex</td><td>${st.pointsPerVertex.toFixed(1)}</td><td>Avg. trace length</td><td>${st.avgLen.toFixed(2)} steps</td></tr>` +
    `<tr><td>Straight traces</td><td>${st.straight} (${pct(st.straight)})</td><td>Bends (total)</td><td>${st.bends}</td></tr>` +
    `<tr><td>Two-bend traces</td><td>${st.doglegs} (${pct(st.doglegs)})</td><td>Trace steps in buses</td><td>${Math.round(100 * st.busShare)}%</td></tr>` +
    `<tr><td>Layout time</td><td>${Math.round(L.ms)} ms</td><td></td><td></td></tr>` +
    `</table>`;
}

// --- Main entry: recompute layout, verify, draw ---
function ebRelayout(message) {
  const S = ebSettings();
  const empty = !ebOrder || ebOrder.length === 0;
  window.ebView.layout = empty ? null : ebLayoutForest(S);
  window.ebView.check = empty ? null : ebVerify(window.ebView.layout);
  ebRender();
  ebFitWindowHeight();

  const chk = window.ebView.check;
  ebFillList("vertexIssueList", chk ? chk.vertexIssues : [], "None");
  ebFillList("traceIssueList", chk ? chk.traceIssues : [], "None");
  ebFillList("genderIssueList", chk ? chk.genderIssues : [], "All arrivals follow the gender rule");
  ebShowStats(window.ebView.layout);

  let text = message || "";
  if (!empty) {
    const L = window.ebView.layout;
    const problems = chk.vertexIssues.length + chk.traceIssues.length + chk.genderIssues.length;
    text += (text ? " " : "") + `Board drawn: ${L.trees} tree${L.trees === 1 ? "" : "s"} on a ${L.gridW - 2} × ${L.gridH - 2} grid in ${Math.round(L.ms)} ms` +
      (problems ? `, ${problems} problem${problems === 1 ? "" : "s"} found (see the lists below).` : ", no collisions.");
    if (L.forced.length) text += ` Crowded routes drawn with conflicts: ${L.forced.join(", ")}.`;
  }
  ebSetStatus(text);
}
window.ebRelayout = ebRelayout;

function ebRandomizeGenders() {
  if (!ebOrder.length) { alert("Nothing to randomize: load or add vertices first."); return; }
  let m = 0;
  ebOrder.forEach(n => { ebGender[n] = Math.random() < 0.5 ? "M" : "F"; if (ebGender[n] === "M") m++; });
  ebUpdateLists();
  ebRelayout(`Randomized genders: ${m} male, ${ebOrder.length - m} female.`);
}

// --- Zoom, rotation and window size ---
const EB_ZOOM_MIN = 0.2, EB_ZOOM_MAX = 5;

function ebApplyZoomSize() {
  const svg = document.getElementById("board");
  const L = window.ebView.layout;
  if (!svg || !L) return;
  const { w, h } = ebBoardSize(L);
  const rot = window.ebView.rotated, s = window.ebView.scale;
  svg.setAttribute("width", Math.ceil((rot ? h : w) * s));
  svg.setAttribute("height", Math.ceil((rot ? w : h) * s));
}

function ebSetZoom(newScale, ax, ay) {
  const canvas = document.getElementById("boardWindow");
  if (!canvas) return;
  const old = window.ebView.scale;
  const s = Math.min(EB_ZOOM_MAX, Math.max(EB_ZOOM_MIN, newScale));
  if (ax === undefined) { ax = canvas.clientWidth / 2; ay = canvas.clientHeight / 2; }
  const cx = (canvas.scrollLeft + ax) / old, cy = (canvas.scrollTop + ay) / old;
  window.ebView.scale = s;
  ebApplyZoomSize();
  canvas.scrollLeft = cx * s - ax;
  canvas.scrollTop = cy * s - ay;
  const lbl = document.getElementById("zoomLevel");
  if (lbl) lbl.textContent = Math.round(s * 100) + "%";
}

function ebZoomBy(f, ax, ay) { ebSetZoom(window.ebView.scale * f, ax, ay); }

// Grows or shrinks the window to show the whole board (within the browser window); called after a new layout
function ebFitWindowHeight() {
  const canvas = document.getElementById("boardWindow");
  const svg = document.getElementById("board");
  if (!canvas || !svg) return;
  const needed = (parseFloat(svg.getAttribute("height")) || 160) + 28;
  const cap = Math.max(320, window.innerHeight - 60);
  canvas.style.height = Math.round(Math.min(Math.max(needed, 200), cap)) + "px";
}

function ebToggleRotation() {
  const canvas = document.getElementById("boardWindow");
  window.ebView.rotated = !window.ebView.rotated;
  if (canvas) {
    if (window.ebView.rotated) {
      window.ebView.heightBeforeRotation = canvas.offsetHeight;
    }
  }
  ebRender();
  if (canvas) {
    if (window.ebView.rotated) {
      const svg = document.getElementById("board");
      const needed = (parseFloat(svg.getAttribute("height")) || 160) + 28;
      const cap = Math.max(320, window.innerHeight - 60);
      const h = Math.max(canvas.offsetHeight, Math.min(needed, cap));
      canvas.style.height = Math.round(h) + "px";
    } else if (window.ebView.heightBeforeRotation !== null) {
      canvas.style.height = window.ebView.heightBeforeRotation + "px";
      window.ebView.heightBeforeRotation = null;
    }
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
  }
  const btn = document.getElementById("rotateViewBtn");
  if (btn) btn.textContent = window.ebView.rotated ? "⟲ Rotate Back" : "⟳ Rotate 90°";
}

// --- Save as JPG (as displayed: current orientation, at 2x resolution) ---
function ebSaveJPG() {
  const svg = document.getElementById("board");
  const L = window.ebView.layout;
  if (!svg || !L) { alert("Nothing to save yet."); return; }
  const vb = svg.getAttribute("viewBox").split(" ").map(Number);
  const scale = 2;
  const clone = svg.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", vb[2] * scale);
  clone.setAttribute("height", vb[3] * scale);
  const data = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([data], { type: "image/svg+xml;charset=utf-8" }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = vb[2] * scale;
    c.height = vb[3] * scale;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.download = `electric_map_${Date.now()}.jpg`;
    a.href = c.toDataURL("image/jpeg", 0.95);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  img.src = url;
}

function ebInitBoard() {
  const svg = document.getElementById("board");
  const canvas = document.getElementById("boardWindow");
  const handle = document.getElementById("boardResizeHandle");

  if (svg) {
    svg.addEventListener("click", e => {
      const g = e.target.closest ? e.target.closest(".pad") : null;
      if (g && g.dataset.name) ebPadClicked(g.dataset.name);
    });
  }

  if (canvas) {
    const anchor = e => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left - canvas.clientLeft, y: e.clientY - r.top - canvas.clientTop };
    };
    canvas.addEventListener("wheel", e => {
      if (!e.ctrlKey) return;      // two-finger pinch on a touchpad arrives as ctrl + wheel
      e.preventDefault();
      let dy = e.deltaY;
      if (e.deltaMode === 1) dy *= 16; else if (e.deltaMode === 2) dy *= 400;
      dy = Math.max(-50, Math.min(50, dy));
      const a = anchor(e);
      ebZoomBy(Math.exp(-dy * 0.01), a.x, a.y);
    }, { passive: false });
    let g0 = 1;
    canvas.addEventListener("gesturestart", e => { e.preventDefault(); g0 = window.ebView.scale; });
    canvas.addEventListener("gesturechange", e => { e.preventDefault(); const a = anchor(e); ebSetZoom(g0 * e.scale, a.x, a.y); });
    canvas.addEventListener("gestureend", e => e.preventDefault());
  }

  if (handle && canvas) {
    let startY = 0, startH = 0, drag = false;
    handle.addEventListener("pointerdown", e => {
      drag = true; startY = e.clientY; startH = canvas.offsetHeight;
      handle.setPointerCapture(e.pointerId); e.preventDefault();
    });
    handle.addEventListener("pointermove", e => {
      if (drag) canvas.style.height = Math.max(160, startH + e.clientY - startY) + "px";
    });
    const stop = e => { drag = false; if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId); };
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
    handle.addEventListener("dblclick", () => ebFitWindowHeight());
  }

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on("runLayoutBtn", () => ebRelayout("Layout recomputed with the current settings."));
  on("randomizeGendersBtn", ebRandomizeGenders);
  on("saveDrawingBtn", ebSaveJPG);
  on("zoomInBtn", () => ebZoomBy(1.2));
  on("zoomOutBtn", () => ebZoomBy(1 / 1.2));
  on("zoomResetBtn", () => ebSetZoom(1));
  on("rotateViewBtn", ebToggleRotation);
  const sg = document.getElementById("showGrid");
  if (sg) sg.onchange = () => { if (window.ebView.layout) { window.ebView.layout.showGrid = sg.checked; ebRender(); } };
  const bt = document.getElementById("boardTheme");
  if (bt) bt.onchange = () => { if (window.ebView.layout) window.ebView.layout.theme = bt.value; ebRender(); };

  ebRelayout("");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ebInitBoard);
else ebInitBoard();
