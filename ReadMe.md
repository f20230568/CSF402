# Graph DFS/BFS Visualizer & Metro Map Drawer

This tool provides a comprehensive environment for building, manipulating, and visualizing graph structures, traversal algorithms, and schematic tree layouts directly in the web browser.

---

## Overview

The project consists of three primary interfaces:
* **BFS/DFS Visualizer (`index.html`)**: Focuses on step-by-step educational visualization of graph traversals.
* **Graph Drawer (`manager.html`)**: Focuses on general graph construction, vertex/edge management, and automated layout using spring-embedder physics simulations.
* **Family Metro Map Visualizer (`family_metro_map.html`)**: Focuses on schematic, octilinear tree layouts inspired by the London Underground map based on Korst, Pronk, and van Wijk (2020).

---

## Key Features

* **Multi-mode Creation**: Build graphs visually via a click-to-connect interface, or programmatically using Adjacency Lists and Adjacency Matrices.
* **Physics-Based Layout**: Automatically organize messy or overlapping graphs using Eades' Force-Directed (Spring-Embedder) algorithm.
* **Schematic Metro Map Layout**: Generate crossing-free, generation-scaled octilinear tree visualizations with straight segments and 45° bends.
* **Tree Validation**: Automatic checking to verify that an input graph is connected and acyclic ($|E| = |V| - 1$) before generating metro map representations.
* **Step-by-Step Traversal**: Execute BFS and DFS with "Next" and "Undo" controls to observe state changes in real time.
* **Data Portability**: Export and import graph configurations as `.txt` files in List or Matrix formats.
* **Dynamic UI**: Drag-and-drop nodes, real-time coordinate tracking, and automated canvas resizing.

---

## Algorithms Detailed

### 1. Breadth-First Search (BFS)
* **Mechanism**: Implemented using a **Queue** (FIFO).
* **Visualization State**:
  * **Orange**: The node currently being explored.
  * **Green**: Nodes that have been visited.
  * **Timestamp**: Displays `(Parent, Distance)` where distance represents the unweighted shortest path by edge count.
* **Logic**: Discovers neighbors level-by-level, assigns distance values ($\text{dist} = \text{parent}_{\text{dist}} + 1$), and queues them for traversal.

### 2. Depth-First Search (DFS)
* **Mechanism**: Implemented using a **Stack** (LIFO) logic.
* **Visualization State**:
  * **Timestamp**: Displays `(Discovery Time / Finish Time)`.
  * **Discovery Time**: Step count when the node first enters the stack.
  * **Finish Time**: Step count when all adjacent branches are exhausted and the node pops from the stack.
* **Logic**: Traverses deeper along each branch until dead ends are reached, backtracking recursively.

### 3. Spring-Embedder (Eades' Force-Directed Layout)
Located in the **Graph Drawer** (`manager.html`), this physics model treats nodes as charged particles and edges as springs:
* **Coulomb’s Law (Repulsion)**: Applied to all node pairs to prevent overlap:
  $$\text{Force}_{\text{repulsion}} = \frac{\text{repulsion}}{\text{distance}^2}$$
* **Hooke’s Law (Attraction)**: Applied only to connected neighbor nodes:
  $$\text{Force}_{\text{attraction}} = \text{attraction} \times \text{distance}$$
* **Velocity & Damping**:
  $$\text{NewPos} = \text{OldPos} + (\text{Force} \times \text{damping})$$

### 4. Family Metro Map Layout (Korst et al., 2020)
Located in the **Family Metro Map Visualizer** (`family_metro_map.html`), this algorithm generates schematic layouts inspired by transit maps:
* **Tree Constraint Check**: Enforces that $|E| = |V| - 1$ and all $|V|$ nodes are reachable.
* **Octilinear Angles & Orientation**:
  * Node orientations alternate based on gender parity: Even multiples of $\pi/4$ (horizontal/vertical) vs. Odd multiples of $\pi/4$ (diagonal).
  * Same-gender transitions use straight links; different-gender transitions introduce 45° bends split into equal-length segments of size $\frac{d}{\sqrt{2 + \sqrt{2}}}$.
* **Generation Scaling**:
  $$\text{Distance} = d \times \alpha^g$$
  Successive generations $g$ scale by shrinking factor $\alpha \le 1.0$ to prevent subtree collision.
* **Visual Rendering**: Uses compact node stations with straight octilinear lines and intermediate bend vertices.

---

## File Structure

* `index.html`: Main visualizer for BFS/DFS traversals.
* `manager.html`: Graph editor and Force-Directed layout manager.
* `family_metro_map.html`: Schematic metro-style tree generator implementing Korst et al. (2020).
* `styles.css`: Centralized stylesheet for nodes, links, and layout containers.
* `app1.js`: Core graph engine handling data structures, DOM bindings, traversals, physics layouts, and SVG edge drawing.
* `familymetromap.js`: Tree validation, angular orientation logic, collision checks, and coordinate generators for the metro map algorithm.

---

## How to Use

### Build a Graph
* In **Visual Mode**, click "Add Vertex" and click two nodes to create an edge.
* In **List/Matrix Mode**, paste adjacency data or click "Import List"/"Import Matrix" to upload `.txt` files directly, then click "Show Graph".

### Run Traversal (`index.html`)
* Enter a **Start Node** (e.g., `A`).
* Click **Start BFS** or **Start DFS**.
* Use **Next** to step forward, **Undo** to step back, or **Run to End**.

### Untangle Graphs (`manager.html`)
* Open "Open Options" under Force Directed Layout.
* Adjust Repulsion, Attraction, and Damping, then click **Run All at Once**.

### Generate a Family Metro Map (`family_metro_map.html`)
* Construct or import an acyclic connected tree.
* Set a **Root Node** and adjust the **Shrinking Factor ($\alpha$)**.
* Click **Run Metro Map Layout** to render the schematic map with 45° bends.

---

## Constraints

* **Visual Limit**: Canvas SVG rendering is optimized for up to **300 nodes**.
* **Matrix Limit**: Adjacency matrix processing is capped at **300x300** to ensure responsive browser performance.
* **Metro Map Layout**: Exclusively requires connected, cycle-free trees ($|E| = |V| - 1$).