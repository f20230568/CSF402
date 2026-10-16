# Test sets S, M, L for trees and graphs (gender-marked input)

Every input is given twice, as an adjacency list (`list/`) and as an adjacency matrix (`matrix/`).
Both files describe the same graph with the same genders.

- **List:** a male vertex ends with an underscore (`A_`), a female vertex has none (`B`).
- **Matrix:** a row that starts with an underscore is a male vertex (`_0,1,1`).
- **Labels:** A..Z, A1..Z1, ... Genders are random (about half male), chosen from the file's seed.

Trees go on the tree page (family_metro_map.html), graphs on the graph page (family_metro_map_graph.html).

## Trees (`trees/`)

Vertex i is attached to a random earlier vertex that still has fewer than k children.

| Set | Trees | Vertices | Max children k |
|---|---|---|---|
| S (small)  | 50 | 10 each of 10, 20, 30, 40, 50 | 3, 4, 5 or 6 |
| M (medium) | 30 | 6 each of 60, 70, 80, 90, 100 | 3, 4 or 5 |
| L (large)  | 20 | 4 each of 125, 150, 200, 250, 300 | 3 or 4 |

## Graphs (`graphs/`): every vertex has at most 8 neighbours

| Kind | What it is |
|---|---|
| tree_plus_cycles | random tree (max 3 children) plus about n/5 short cycle edges (between vertices 2 to 4 steps apart), degree at most 5 |
| random_sparse | random tree plus about 0.3 n random extra edges, degree at most 4 |
| disconnected | 2 or 3 separate tree_plus_cycles components |
| grid | r x c grid |
| grid_diagonals | r x c grid with one diagonal in about 40% of the cells (planar, degree at most 8) |

| Set | Graphs | Vertices |
|---|---|---|
| S (small)  | 23 | 12 to 50 (grids 3x4, 4x5, 5x6, 6x8) |
| M (medium) | 23 | 60 to 100 (grids 7x9, 8x10, 9x10, 10x10) |
| L (large)  | 20 | 125 to 200 (grids 10x13, 12x13, 12x15, 14x14) |

## index.csv

One row per input: family, set, number, kind, vertices, edges, maximum degree, components,
number of male vertices, seed and file name. The last two columns are the result of one
**Run Full Metro Layout** with alpha = 0.75 on the current pages: the number of overlapping-vertex groups
and of edge collisions shown in the panels. These are before the Fix buttons are used.

`python3 generate_sets.py <folder>` recreates every file exactly.
