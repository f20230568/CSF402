# Test graphs of the general-graph experiments

Graphs used for Table 2 ("Experiments") of *The Family Metro Map Layout for General Graphs*.
All files use the adjacency-list format of the page (`A:B,C`, one line per vertex); use root **A**.

| Folder | Graphs | Description |
|---|---|---|
| `S1_trees_plus_cycle_edges` | 12 | random trees (n = 20, 40, 80, 150; at most 3 children) plus about 15% extra edges between vertices at BFS distance 2-3 |
| `S2_grids` | 6 | grid graphs 3x3, 4x4, 5x6, 6x6, 8x8, 10x12 |
| `S3_cycles` | 5 | cycles C5, C6, C12, C30, C60 |
| `S4_random_degree_max4` | 6 | random connected graphs, n = 20, 40, 80 (two each), m = 1.3n, degree <= 4 |
| `S5_random_degree_max8` | 4 | random connected graphs, n = 30, 60 (two each), m = 1.8n, degree <= 8 |
| `figures_and_timing` | 13 | graphs of the figures (grids, K4, K5, 80-vertex example, disconnected graph) and of the timing table |

`index.csv` lists every experiment graph with its size, maximum degree and the result of the final algorithm
(overlapping vertex pairs / colliding edge pairs) at alpha = 1, 0.75 and 0.5, in two versions:

* `..._page`: what the page shows after importing the file (Adjacency List -> Show Graph -> Run Full Metro Layout).
* `..._experiment`: the numbers of Table 2. The experiment used the graphs straight from the generator, where each
  vertex's neighbours are in generation order. The page's list importer builds the neighbour lists in a different
  order, which changes the BFS spanning tree slightly, so the per-graph numbers can differ a little. The vertex and
  edge sets are identical.

`graph_generators.js` and `export_experiment_graphs.js` regenerate all files (Node.js):
`node export_experiment_graphs.js <output folder> <path to family_metro_map_graph.js>`.
