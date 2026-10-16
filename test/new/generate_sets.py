"""Test inputs for the Family Metro Map pages, in the gender-marked input format.

  Adjacency list:   a male vertex ends with an underscore (A_), a female vertex has none (B).
  Adjacency matrix: a row that starts with an underscore is a male vertex.

Every file is reproducible: python3 generate_sets.py <output folder>
Genders are random (50 / 50) from the same seed as the structure.
"""
import random, os, sys
from collections import deque

def label(i): return chr(65 + (i % 26)) + (str(i // 26) if i >= 26 else "")
MAX_DEGREE = 8

# ---------------------------------------------------------------- structures
def rand_tree(n, rnd, maxk):
    """Vertex i attaches to a uniformly random earlier vertex with fewer than maxk children."""
    adj = {i: set() for i in range(n)}; kids = [0] * n
    for i in range(1, n):
        while True:
            p = rnd.randrange(i)
            if kids[p] < maxk: break
        kids[p] += 1; adj[i].add(p); adj[p].add(i)
    return adj

def bfs_dist(adj, s):
    d = {s: 0}; q = deque([s])
    while q:
        u = q.popleft()
        for v in adj[u]:
            if v not in d: d[v] = d[u] + 1; q.append(v)
    return d

def tree_plus_cycles(n, rnd, extra_frac=0.2, max_deg=5):
    """Random tree (max 3 children) plus short cycle-closing edges (BFS distance 2..4)."""
    adj = rand_tree(n, rnd, 3)
    want = max(1, round(n * extra_frac)); tries = 0
    while want and tries < 50 * n:
        tries += 1
        u = rnd.randrange(n)
        d = bfs_dist(adj, u)
        cands = [v for v, k in d.items() if 2 <= k <= 4 and v not in adj[u]
                 and len(adj[v]) < max_deg and len(adj[u]) < max_deg]
        if not cands: continue
        v = rnd.choice(cands); adj[u].add(v); adj[v].add(u); want -= 1
    return adj

def grid(r, c, rnd, diag_frac=0.0):
    """r x c grid; diag_frac of the cells get one diagonal (still planar, degree <= 8)."""
    adj = {i: set() for i in range(r * c)}
    def add(a, b): adj[a].add(b); adj[b].add(a)
    for i in range(r):
        for j in range(c):
            k = i * c + j
            if j + 1 < c: add(k, k + 1)
            if i + 1 < r: add(k, k + c)
            if i + 1 < r and j + 1 < c and rnd.random() < diag_frac:
                if rnd.random() < 0.5: add(k, k + c + 1)
                else: add(k + 1, k + c)
    return adj

def random_sparse(n, rnd, avg_extra=0.3, max_deg=4):
    """Random spanning tree (max 3 children) plus random extra edges, degree <= max_deg."""
    adj = rand_tree(n, rnd, 3)
    want = round(n * avg_extra); tries = 0
    while want and tries < 100 * n:
        tries += 1
        u, v = rnd.randrange(n), rnd.randrange(n)
        if u == v or v in adj[u] or len(adj[u]) >= max_deg or len(adj[v]) >= max_deg: continue
        adj[u].add(v); adj[v].add(u); want -= 1
    return adj

def disconnected(n, rnd, parts):
    """`parts` components (tree plus cycles), sizes as equal as possible."""
    sizes = [n // parts + (1 if i < n % parts else 0) for i in range(parts)]
    adj = {}; off = 0
    for s in sizes:
        comp = tree_plus_cycles(s, rnd, 0.2, 5) if s >= 3 else rand_tree(s, rnd, 3)
        for u, vs in comp.items(): adj[u + off] = {v + off for v in vs}
        off += s
    return adj

# ---------------------------------------------------------------- output
def genders(n, rnd): return ["M" if rnd.random() < 0.5 else "F" for _ in range(n)]

def to_list(adj, g):
    m = lambda i: label(i) + ("_" if g[i] == "M" else "")
    return "\n".join(f"{m(u)}:{','.join(m(v) for v in sorted(adj[u]))}" for u in range(len(adj))) + "\n"

def to_matrix(adj, g):
    n = len(adj)
    return "\n".join(("_" if g[u] == "M" else "") + ",".join("1" if v in adj[u] else "0" for v in range(n))
                     for u in range(n)) + "\n"

def stats(adj):
    n = len(adj); m = sum(len(v) for v in adj.values()) // 2
    seen = set(); comps = 0
    for s in range(n):
        if s in seen: continue
        comps += 1; seen |= set(bfs_dist(adj, s))
    return n, m, max((len(v) for v in adj.values()), default=0), comps

# ---------------------------------------------------------------- sets
# Trees: (vertices, max children, seed)
TREE_SETS = {
  "S": [(n, mk, 1000 + 10 * n + s) for n in (10, 20, 30, 40, 50) for s, mk in enumerate((3, 3, 4, 4, 4, 4, 5, 5, 6, 6))],
  "M": [(n, mk, 2000 + 10 * n + s) for n in (60, 70, 80, 90, 100) for s, mk in enumerate((3, 3, 4, 4, 5, 5))],
  "L": [(n, mk, 3000 + n + s) for n in (125, 150, 200, 250, 300) for s, mk in enumerate((3, 3, 4, 4))],
}
# Graphs: (kind, size parameter, seed)
def graph_specs(sizes, grids, seed0):
    specs = []
    for k, n in enumerate(sizes):
        specs.append(("tree_plus_cycles", n, seed0 + k))
        specs.append(("random_sparse", n, seed0 + 100 + k))
        specs.append(("disconnected", n, seed0 + 200 + k))
    for k, (r, c) in enumerate(grids):
        specs.append(("grid", (r, c, 0.0), seed0 + 300 + k))
        specs.append(("grid_diagonals", (r, c, 0.4), seed0 + 400 + k))
    return specs
GRAPH_SETS = {
  "S": graph_specs((12, 20, 30, 40, 50), ((3, 4), (4, 5), (5, 6), (6, 8)), 5000),
  "M": graph_specs((60, 70, 80, 90, 100), ((7, 9), (8, 10), (9, 10), (10, 10)), 6000),
  "L": graph_specs((125, 150, 175, 200), ((10, 13), (12, 13), (12, 15), (14, 14)), 7000),
}

def build_graph(kind, p, rnd):
    if kind == "tree_plus_cycles": return tree_plus_cycles(p, rnd)
    if kind == "random_sparse":    return random_sparse(p, rnd)
    if kind == "disconnected":     return disconnected(p, rnd, 2 if p < 40 else 3)
    r, c, d = p
    return grid(r, c, rnd, d)

if __name__ == "__main__":
    out = sys.argv[1]
    rows = []
    for set_name, specs in TREE_SETS.items():
        for k, (n, mk, seed) in enumerate(specs, 1):
            rnd = random.Random(seed)
            adj = rand_tree(n, rnd, mk); g = genders(n, rnd)
            base = f"trees/set_{set_name}/{set_name}{k:03d}_n{n}_k{mk}_seed{seed}"
            for sub, text in (("list", to_list(adj, g)), ("matrix", to_matrix(adj, g))):
                path = f"{out}/{base.replace(f'set_{set_name}/', f'set_{set_name}/{sub}/')}.txt"
                os.makedirs(os.path.dirname(path), exist_ok=True); open(path, "w").write(text)
            nn, m, md, cc = stats(adj)
            rows.append(("tree", set_name, k, "tree", nn, m, md, cc, g.count("M"), seed, os.path.basename(base) + ".txt"))
    for set_name, specs in GRAPH_SETS.items():
        for k, (kind, p, seed) in enumerate(specs, 1):
            rnd = random.Random(seed)
            adj = build_graph(kind, p, rnd); n = len(adj); g = genders(n, rnd)
            nn, m, md, cc = stats(adj)
            assert md <= MAX_DEGREE
            base = f"graphs/set_{set_name}/{set_name}{k:03d}_{kind}_n{n}_m{m}_seed{seed}"
            for sub, text in (("list", to_list(adj, g)), ("matrix", to_matrix(adj, g))):
                path = f"{out}/{base.replace(f'set_{set_name}/', f'set_{set_name}/{sub}/')}.txt"
                os.makedirs(os.path.dirname(path), exist_ok=True); open(path, "w").write(text)
            rows.append(("graph", set_name, k, kind, nn, m, md, cc, g.count("M"), seed, os.path.basename(base) + ".txt"))
    with open(f"{out}/index.csv", "w") as f:
        f.write("family,set,number,kind,vertices,edges,max_degree,components,males,seed,file\n")
        for r in rows: f.write(",".join(map(str, r)) + "\n")
    from collections import Counter
    print(Counter((r[0], r[1]) for r in rows))
