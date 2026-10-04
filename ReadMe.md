# Family Metro Map Visualizer

An interactive tree-drawing tool based on **Korst, Pronk & van Wijk (2020), "A Visualization of Family Relations Inspired by the London Metro Map"** (VINCI 2020). The input tree is drawn as a metro map: every link is horizontal, vertical or diagonal, and vertices are coloured by gender.

## Files

| File | Purpose |
|---|---|
| `family_metro_map.html` | Page layout, buttons, overlap / summary panels |
| `app1.js` | Graph editing: visual builder, adjacency list / matrix import and export, edge drawing |
| `familymetromap.js` | Metro map layout, step-by-step BFS drawing, overlap detection and the two fixers |

## Usage

1. Build a tree with the visual builder, or paste an adjacency list / matrix and press **Show Graph**. The graph must be a tree (|E| = |V| − 1 and connected).
2. Set the **Root Node** (default: the first vertex) and the **shrinking factor α** (default 0.75).
3. Press **Run Full Metro Layout** to draw everything at once, or **Step by Step BFS Draw** to reveal one vertex per click.
4. Check the **Overlapping Vertices** and **Overlapping / Touching Edges** panels. During step-by-step drawing they fill in as the drawing grows, and newly found items are marked **NEW**.
5. If anything is listed, press **Fix Vertex Overlaps** and/or **Fix Edge Overlaps**. Every change made appears in **Summary of Changes**.
6. Press **Save Drawing** to export the result as an image.

Both draw buttons use the same layout function (`generateFamilyMetroCoordinates`) and start from the same state, so they always produce the same drawing.

## Layout algorithm

The paper's model is adapted to general trees, where a vertex may have any number of children.

1. **Root the tree.** The tree is traversed breadth-first from the root, which gives generations, parent/child relations and subtree sizes. The root is placed at a fixed position with orientation k = 2 (female) or k = 3 (male).

2. **Orientation rule (gender).** Every vertex has an orientation k · 45°. Female vertices have an even k (horizontal or vertical) and male vertices an odd k (diagonal).

3. **Link types.** A child v leaves its parent u with a first segment in direction k(u) + g:
   - **g = 0:** continue on the parent's metro line.
   - **g = ±2:** a perpendicular T-junction (a side line).
   - **g = ±1, ±3:** extra diagonal branches, used only for vertices with more than three children.

   If that direction already matches v's gender, the link is **straight**. Otherwise it is a **bended link**: two equal segments of length d / √(2 + √2), the second turned by s = ±45°, so the total distance is still d.

4. **Distinct directions.** No two links leave a vertex in the same direction, and none goes back along the incoming line. This removes most edge overlaps at their source.

5. **Edge length.** The length is d = 90 px · α^(line generation). The line generation increases only at a side line (g ≠ 0), not at every BFS level, as in Sec. 4.1 of the paper. A minimum length of 34 px keeps vertex disks apart.

6. **Choosing among the options.** Vertices are processed generation by generation, like the paper's *Clockwise* heuristic. For each vertex, a small beam search (width 4) tries the joint choices for all its children, largest subtree first. Each option is scored in this order, similar to the paper's cost C(M) = (c1, c2):
   1. vertex conflicts (a vertex too close to another vertex or lying on a line) and edge crossings or touches;
   2. minimum distance to existing geometry (c1);
   3. free room in front of the child for its own subtree (one-step look-ahead);
   4. metro-style preference: continue straight, then T-junction, then diagonal;
   5. average distance to the rest of the drawing (c2).

   The best combination is fixed and the algorithm moves on; it does not backtrack. The result is deterministic.

## Overlap detection

- **Vertices:** two visible vertices closer than 16 px overlap. Overlapping pairs are grouped into connected clusters, e.g. "Vertices B, H, N overlap".
- **Edges:** every pair of drawn segments is checked. A pair counts as an overlap if the segments cross, or if two edges leave a shared vertex in the same direction. It counts as a touch if they come within 6 px of each other. Colliding edges are grouped into clusters in the same way, e.g. "Edges B-F, F-H, F-N collide / overlap".

## Fix buttons

Both fixers follow the paper's suggestion of disentangling a map by flipping subtrees. Neither one changes a vertex's gender. They store their choices as *overrides*, and the layout algorithm is rerun with those choices locked in. This means everything below a changed link is re-placed automatically.

Each fixer runs up to 16 rounds of the following steps:

1. **Pick candidate links.** Take the vertices involved in the remaining overlaps (for the edge fixer, the child end of each colliding edge), plus their parents and grandparents. Moving an ancestor moves its whole subtree.
2. **Re-route.** For each candidate link, try every branch direction g ∈ {0, ±1, ±2, ±3} (and 180° at the root), each with both bend signs s = ±1. Turn variants are skipped when the link is straight. Rerun the layout for each option and keep the best one if it lowers the cost.
3. **Rescale a link (fallback 1).** If no re-route helps, change the length of a single link (×0.76 to ×1.3).
4. **Shrink a subtree (fallback 2).** If that also fails, shrink a whole subtree by a local factor of 0.8, 0.65 or 0.5. This is based on Lemma 4.3 of the paper: a small enough shrinking factor always separates neighbouring subtrees.
5. **Stop** when no overlaps remain, no step improves the cost, or the evaluation budget runs out. The budget is 150–500 layout evaluations, depending on tree size.

The cost being minimised is 100000 · (vertex overlaps) + 5000 · (edge collisions) − (minimum vertex distance). The difference between the two fixers is that **Fix Edge Overlaps** accepts a change only if it does not create new vertex overlaps.

Anything that cannot be resolved is reported in red in the summary. This happens, for example, when a vertex has more children than free directions: a non-root vertex has 7 free directions and the root has 8.

## Limits

- Only trees are supported. Cycles and multiple partners are outside the scope of the paper and of this tool.
- Gender comes from each vertex's `data-gender` attribute. If that is missing, it is derived from the label (even character code = female).
- *Run Full Metro Layout* and a fresh *Step by Step BFS Draw* clear any fixes made earlier. Run the fixers again afterwards if needed.