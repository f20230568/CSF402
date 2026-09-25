# Family Metro Map Visualizer (Korst et al., 2020)

A schematic tree visualizer inspired by metro transit maps that arranges connected, acyclic undirected graphs along strict octilinear tracks using gender parity and generation scaling.

---

## Core Layout Algorithm

The placement runs in Breadth-First Search (BFS) order from a chosen root vertex:

1. **Tree Verification**: Confirms the input graph is connected and satisfies $\vert{}E\vert{} = \vert{}V\vert{} - 1$.
2. **Gender Parity & Base Angles**:
   * **Female (F)**: Restricted to orthogonal angles ($k \times \frac{\pi}{4}$ for even $k \in \{0, 2, 4, 6\}$).
   * **Male (M)**: Restricted to diagonal angles ($k \times \frac{\pi}{4}$ for odd $k \in \{1, 3, 5, 7\}$).
3. **Link Routing**:
   * **Same-Gender ($u = v$)**: Traverses straight along the track ($0^\circ$) or opposite track ($180^\circ$) without intermediate bends.
   * **Different-Gender ($u \neq v$)**: Splits the segment into two equal subsegments with a $45^\circ$ bend to transition between orthogonal and diagonal directions, scaled by $\frac{1}{\sqrt{2 + \sqrt{2}}}$.
4. **Generation Contraction**: Edge lengths contract across generations $g$ by shrinking factor $\alpha \le 1.0$:
   $$d_g = d_0 \cdot \alpha^g$$
5. **Greedy Traversal Choice**: Evaluates candidate turn directions for each child node, selecting the path that minimizes edge intersections and maximizes clearance to existing vertices.

---

## Overlap Resolution Methods

Changing root nodes or high-degree branching can cause geometric dead-ends. Two specialized solvers resolve these conflicts deterministically per root:

### 1. Vertex Overlap Fix (`fixMetroOverlaps`)
* **Detection**: Identifies node pairs whose center Euclidean distance is less than the node collision diameter ($16\text{px}$).
* **Optimization Loop**:
  * Evaluates alternative radial octilinear sectors ($\pm 180^\circ, \pm 90^\circ, \pm 45^\circ, \pm 135^\circ$) relative to the parent branch.
  * Toggles vertex gender parity to switch the incoming/outgoing tracks between orthogonal and diagonal channels.
  * Reverses $45^\circ$ intermediate bend directions.
  * Applies micro-scale edge contraction ($0.76\times - 0.86\times$) as a clearance fallback.
* Commits the configuration that minimizes total overlap count and edge crossings while maximizing inter-node spacing.

### 2. Edge Overlap Fix (`fixMetroEdgeOverlaps`)
* **Detection**: Identifies edges that intersect, share collinear track segments, or graze/touch within a $6\text{px}$ threshold.
* **Resolution**:
  * Re-routes colliding edges into uncrowded angular sectors.
  * Inverts bend transitions to route around parallel tracks.
  * Shortens edge lengths incrementally to prevent touching adjacent parallel lines without introducing vertex overlaps.