import random, os, json, sys
def label(i): return chr(65 + (i % 26)) + (str(i // 26) if i >= 26 else "")
def rand_tree(n, seed, maxk):
    """Same generator as the experiment: vertex i attaches to a uniformly random earlier vertex
    that still has fewer than maxk children."""
    rnd = random.Random(seed); names = [label(i) for i in range(n)]
    g = {x: [] for x in names}; kids = {}
    for i in range(1, n):
        while True:
            p = rnd.randrange(i)
            if kids.get(p, 0) < maxk: break
        kids[p] = kids.get(p, 0) + 1
        g[names[i]].append(names[p]); g[names[p]].append(names[i])
    return g
SETS = {
  "S": [(n, s*31+n, 4) for n in (10,15,20,30,45) for s in range(20)],
  "L": [(n, s*13+n, 3) for n in (60,80,100) for s in range(8)],
  "H": [(n, s*17+n, mk) for n in (30,45,60) for s in range(10) for mk in (6,8)],
}
if __name__ == "__main__":
    out = sys.argv[1]
    index = []
    for name, params in SETS.items():
        os.makedirs(f"{out}/set_{name}", exist_ok=True)
        for k, (n, seed, mk) in enumerate(params, 1):
            g = rand_tree(n, seed, mk)
            fn = f"set_{name}/{name}{k:03d}_n{n}_k{mk}_seed{seed}.txt"
            open(f"{out}/{fn}", "w").write("\n".join(f"{u}:{','.join(g[u])}" for u in g) + "\n")
            index.append((name, k, n, mk, seed, fn))
    with open(f"{out}/index.csv", "w") as f:
        f.write("set,number,vertices,max_children,seed,file\n")
        for r in index: f.write(",".join(map(str, r)) + "\n")
    print({s: len(p) for s, p in SETS.items()})
