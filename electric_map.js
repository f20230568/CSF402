// electric_map.js - Electric Board Map: a compact, circuit-board-like drawing of a gendered FOREST,
// built on the Family Metro Map rules (Korst, Pronk & van Wijk 2020).
//
// ALGORITHM (overview)
//  1. Grid. Every vertex is a pad on an integer grid point; every edge is a trace made of unit grid steps in one of
//     the 8 octilinear directions k = 0..7 (k * 45 deg), exactly like copper traces on a printed circuit board.
//  2. Gender rule (from the metro map): the LAST segment of the trace that arrives at a child v is
//       orthogonal (k even) if v is female, diagonal (k odd) if v is male.
//     Unlike the metro map, a trace may bend with UNEQUAL segment lengths: shapes are
//       straight (length a), one 45-deg bend (a then b), or a dogleg / jog (a, c, b with two 45-deg bends that
//       return to the first direction - the typical PCB "offset"); every length is chosen independently.
//  3. Generation-by-generation routing (like the metro map's breadth-first order) from a root in each tree
//     (the tree's centre, or the Root Node given by the user). Children are routed largest sub-tree first.
//     For every child all candidate traces up to a maximum segment length are enumerated and the cheapest legal one
//     is taken. A candidate is legal when it
//       - never passes through a pad or another trace (traces may run on ADJACENT grid lines, giving the dense
//         parallel "bus" look of a board) and never crosses a diagonal of another trace,
//       - ends on a free grid point at least the pad clearance (Chebyshev distance) away from every other pad,
//       - arrives with the direction its gender demands.
//     Cost = trace length + bend penalty + compactness x growth of the bounding box (half perimeter)
//            - bonus for continuing the parent's line (metro line continuation)
//            + look-ahead penalties when the new pad has fewer free directions than children, or too little free
//              room around it for its sub-tree.
//     If nothing is legal the search length is increased; as a last resort a trace with conflicts is drawn and
//     reported (this only happens for very crowded pads, e.g. more than 8 incident edges).
//  4. Forest packing. Each tree is laid out separately, then the trees are packed (skyline / bottom-left packing,
//     tallest first) towards the chosen board aspect ratio, with the pad clearance as the gap.
//  5. Verification. The final drawing is checked independently of the construction: pads on the same point or too
//     close, traces through pads, overlapping or crossing traces, and the gender rule for every arrival.
//  Coordinates on the grid are exact, so all checks are exact.

const EB_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const EB_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const EB_OFF = 20000;
const EB_SPAN = 40000;
const ebKey = (x, y) => (x + EB_OFF) * EB_SPAN + (y + EB_OFF);

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
  return {
    pitch: ebNum("gridPitch", 18, 12, 40),
    maxSeg: Math.round(ebNum("maxSegment", 6, 2, 12)),
    clearance: Math.round(ebNum("padClearance", 2, 2, 3)),
    compact: ebNum("compactness", 1.5, 0, 6),
    aspect: ebNum("boardAspect", 1.6, 0.3, 4),
    doglegs: dog ? dog.checked : true,
    order: ord ? ord.value : "bfs",
    outward: 0,             // reward per grid step away from the root (0 = off)
    roomPerVertex: 1.5,     // free grid points wanted around a new pad per vertex of its sub-tree
    roomWeight: 1.0,
    roomMaxRadius: 2,       // radius (grid steps) of the free-room look-ahead
    showGrid: grid ? grid.checked : false
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
  const diagSlot = (x1, y1, x2, y2) => {
    const sx = Math.min(x1, x2), sy = Math.min(y1, y2);
    const type = ((x2 - x1) * (y2 - y1) > 0) ? 0 : 1;
    return { mine: ebKey(sx, sy) * 2 + type, other: ebKey(sx, sy) * 2 + (1 - type) };
  };

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
    let len = 0, collisions = 0;

    function free(x, y, k, forcedMode) {
      // returns -1 = blocked, 0 = free, 1 = free only by colliding (forced mode)
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
      const score = len + 0.7 * bends + S.compact * growth + lookPen + roomPen - cont - outward + collisions * 400;

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
      xs.push(x); ys.push(y);
      len += (k & 1) ? Math.SQRT2 : 1;
      collisions += f;
      return true;
    }
    function unstep(k, f, forcedMode) {
      if (!forcedMode) reserveHit(xs[xs.length - 1], ys[ys.length - 1], -1);
      xs.pop(); ys.pop();
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
      xs.length = 0; ys.length = 0; corners.length = 0; hits.clear(); landHits.clear();
      xs.push(P.x); ys.push(P.y);
      len = 0; collisions = 0;
      for (let d1 = 0; d1 < 8; d1++) {
        walk(d1, forcedMode, L, () => {
          if (((d1 & 1) === 0) === wantEven) evaluate(d1, d1, 0);
          for (const s of [1, -1]) {
            const d2 = (d1 + s + 8) % 8;
            corners.push(xs.length - 1);
            walk(d2, forcedMode, L, c => {
              if (((d2 & 1) === 0) === wantEven) evaluate(d2, d1, 1);
              if (jog && c <= 3 && ((d1 & 1) === 0) === wantEven) {
                corners.push(xs.length - 1);
                walk(d1, forcedMode, L, () => evaluate(d1, d1, 2));
                corners.pop();
              }
            });
            corners.pop();
          }
        });
      }
    }

    // Maze router (Lee / Dijkstra on the grid, as used for PCB routing): any number of 45 or 90 degree turns.
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
        return { x, y, extra };
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
          const nc = c + ((nd & 1) ? Math.SQRT2 : 1) + (turn === 0 ? 0 : (Math.abs(turn) === 1 ? 0.7 : 1.6)) + nx.extra;
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
      pos: Object.assign({}, pos), inDir: Object.assign({}, inDir), paths: Object.assign({}, paths),
      pending: Object.assign({}, pending), bb: Object.assign({}, bb), forced: forced.length
    };
  }

  function restore(s) {
    const refill = (m, src) => { m.clear(); src.forEach((val, key) => m.set(key, val)); };
    refill(pads, s.pads); refill(trace, s.trace); refill(diag, s.diag);
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
  return { pos, paths, bb, forced, root };
}

// A tree whose routing needed conflicting traces is laid out again: with the user's settings plus a radial
// (outward-growing, less compact) variant, from alternative roots (if the user did not fix the root: the
// highest-degree vertex, the first vertex, neighbours of the centre), then with further setting variants.
// The result with the fewest conflicts (then the smallest board area) is kept; retries stop after a time budget.
function ebLayoutTreeBest(comp, root, S, rootFixed) {
  const other = S.order === "bfs" ? "dfs" : "bfs";
  const radial = Object.assign({}, S, { compact: S.compact * 0.5, outward: 0.6 });
  const roomy = Object.assign({}, S, { compact: S.compact * 0.5, roomPerVertex: 3, roomMaxRadius: 4 });
  const later = [
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

  let best = null;
  const t0 = performance.now();
  const BUDGET_MS = 4000;
  for (const [r, v] of attempts) {
    if (best && performance.now() - t0 > BUDGET_MS) break;
    const t = ebLayoutTree(comp, r, v);
    const area = (t.bb.maxX - t.bb.minX + 1) * (t.bb.maxY - t.bb.minY + 1);
    if (!best || t.forced.length < best.t.forced.length ||
        (t.forced.length === best.t.forced.length && area < best.area)) {
      best = { t, area };
    }
    if (best.t.forced.length === 0) break;
  }
  return best.t;
}

// --- 4. Forest packing ---
function ebLayoutForest(S) {
  const t0 = performance.now();
  const comps = ebComponents();
  const rootInp = document.getElementById("rootNode");
  const wantedRoot = rootInp && rootInp.value ? rootInp.value.trim().toUpperCase() : "";

  const trees = comps.map(comp => {
    const root = (wantedRoot && comp.includes(wantedRoot)) ? wantedRoot : ebTreeCentre(comp);
    const t = ebLayoutTreeBest(comp, root, S, !!(wantedRoot && comp.includes(wantedRoot)));
    t.w = t.bb.maxX - t.bb.minX + 1;
    t.h = t.bb.maxY - t.bb.minY + 1;
    t.size = comp.length;
    return t;
  });

  const gap = S.clearance;
  const margin = 1;
  const idx = trees.map((t, i) => i).sort((a, b) =>
    (trees[b].h - trees[a].h) || (trees[b].w - trees[a].w) || (trees[b].size - trees[a].size) || (a - b));
  const totalArea = trees.reduce((s, t) => s + (t.w + gap) * (t.h + gap), 0);
  const maxW = trees.reduce((m, t) => Math.max(m, t.w), 0);
  const targetW = Math.max(maxW, Math.ceil(Math.sqrt(totalArea * S.aspect)));

  // Skyline (bottom-left) packing: each tree, tallest first, goes to the lowest position where it fits,
  // so small trees fill the gaps under and between bigger ones.
  const sky = new Array(targetW + gap).fill(0);
  const offsets = {};
  let usedW = 0, usedH = 0;
  idx.forEach(i => {
    const t = trees[i];
    let bestX = 0, bestY = Infinity;
    for (let x = 0; x + t.w <= Math.max(targetW, t.w); x++) {
      let y = 0;
      for (let c = x; c < x + t.w + gap; c++) y = Math.max(y, sky[c] || 0);   // tree plus its gap on the right
      if (y < bestY) { bestY = y; bestX = x; }
    }
    offsets[i] = { x: bestX - t.bb.minX + margin, y: bestY - t.bb.minY + margin };
    for (let c = bestX; c < bestX + t.w + gap; c++) sky[c] = bestY + t.h + gap;
    usedW = Math.max(usedW, bestX + t.w);
    usedH = Math.max(usedH, bestY + t.h);
  });

  const pos = {}, paths = {}, forced = [], roots = [];
  trees.forEach((t, i) => {
    const o = offsets[i];
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
    gridW: usedW + 2 * margin,
    gridH: usedH + 2 * margin,
    pitch: S.pitch,
    clearance: S.clearance,
    showGrid: S.showGrid,
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
    svg.innerHTML = `<rect x="0" y="0" width="600" height="160" rx="10" fill="#159447"/>` +
      `<text x="300" y="85" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#d8f5df">` +
      `Load a forest (adjacency list / matrix) or add vertices in the Visual Builder.</text>`;
    return;
  }

  const p = L.pitch;
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
  out.push(`<rect x="0" y="0" width="${w}" height="${h}" rx="${p * 0.5}" fill="#159447"/>`);

  if (L.showGrid) {
    const dots = [];
    for (let gx = 1; gx < L.gridW; gx++) {
      for (let gy = 1; gy < L.gridH; gy++) dots.push(`M${gx * p} ${gy * p}h0.01`);
    }
    out.push(`<path d="${dots.join("")}" stroke="#2bb862" stroke-width="2" stroke-linecap="round"/>`);
  }

  // traces: dark outline + lighter copper-green top, like a board under solder mask
  const ds = Object.keys(L.paths).map(k => ebPathD(L.paths[k], p));
  out.push(`<g fill="none" stroke-linecap="round" stroke-linejoin="round">`);
  ds.forEach(d => out.push(`<path d="${d}" stroke="#0b6a31" stroke-width="${(p * 0.36).toFixed(2)}"/>`));
  ds.forEach(d => out.push(`<path d="${d}" stroke="#36c96a" stroke-width="${(p * 0.22).toFixed(2)}"/>`));
  out.push(`</g>`);

  // conflict markers
  if (window.ebView.check) {
    window.ebView.check.marks.forEach(m => {
      out.push(`<circle cx="${m.x * p}" cy="${m.y * p}" r="${p * 0.6}" fill="none" stroke="#ff2d2d" stroke-width="2.5"/>`);
    });
  }

  // pads
  const r = p * 0.38;
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
    out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#ebSilver)" stroke="${ring}" stroke-width="${Math.max(1.6, p * 0.1).toFixed(2)}"/>`);
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
  let length = 0, bends = 0, straight = 0, doglegs = 0;
  const keys = Object.keys(L.paths);
  keys.forEach(k => {
    const p = L.paths[k];
    for (let i = 1; i < p.xs.length; i++) {
      length += (p.xs[i] !== p.xs[i - 1] && p.ys[i] !== p.ys[i - 1]) ? Math.SQRT2 : 1;
    }
    bends += p.bends;
    if (p.bends === 0) straight++;
    if (p.bends === 2) doglegs++;
  });
  const V = Object.keys(L.pos).length;
  const cells = (L.gridW - 1) * (L.gridH - 1);
  return {
    V, E: keys.length, trees: L.trees,
    grid: `${L.gridW - 1} × ${L.gridH - 1}`,
    px: `${Math.round(L.gridW * L.pitch)} × ${Math.round(L.gridH * L.pitch)} px`,
    density: V ? (V / cells) : 0,
    cellsPerVertex: V ? (cells / V) : 0,
    avgLen: keys.length ? length / keys.length : 0,
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
    `<tr><td>Grid cells per vertex</td><td>${st.cellsPerVertex.toFixed(1)}</td><td>Avg. trace length</td><td>${st.avgLen.toFixed(2)} steps</td></tr>` +
    `<tr><td>Straight traces</td><td>${st.straight} (${pct(st.straight)})</td><td>Bends (total)</td><td>${st.bends}</td></tr>` +
    `<tr><td>Doglegs (2 bends)</td><td>${st.doglegs} (${pct(st.doglegs)})</td><td>Layout time</td><td>${Math.round(L.ms)} ms</td></tr>` +
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
    text += (text ? " " : "") + `Board drawn: ${L.trees} tree${L.trees === 1 ? "" : "s"} on a ${L.gridW - 1} × ${L.gridH - 1} grid in ${Math.round(L.ms)} ms` +
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

  ebRelayout("");
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ebInitBoard);
else ebInitBoard();
