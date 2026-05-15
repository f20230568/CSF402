# Graph DFS/BFS Visualizer & Drawer

This tool provides a comprehensive environment for building, manipulating, and visualizing graph structures and common traversal algorithms directly in the web browser.

---

## Overview

The project consists of two primary interfaces:
1.  **BFS/DFS Visualizer (`index.html`)**: Focuses on the step-by-step execution and educational visualization of graph traversals.
2.  **Graph Drawer (`manager.html`)**: Focuses on advanced graph construction, vertex/edge management, and automated layout using physics simulations.

---

## Key Features

* **Multi-mode Creation**: Build graphs visually via a click-to-connect interface, or programmatically using Adjacency Lists and Adjacency Matrices.
* **Physics-Based Layout**: Automatically organize messy or overlapping graphs using a Force-Directed (Spring-Embedder) algorithm.
* **Step-by-Step Traversal**: Execute BFS and DFS with "Next" and "Undo" capabilities to observe state changes in real-time.
* **Data Portability**: Export and import your graph configurations as `.txt` files in List or Matrix formats.
* **Dynamic UI**: Drag-and-drop nodes, real-time coordinate tracking, and automated canvas resizing.

---

## Algorithms Detailed

### 1. Breadth-First Search (BFS)
BFS explores the graph level-by-level, starting from a source node.
* **Mechanism**: Implemented using a **Queue** (First-In-First-Out).
* **Visualization State**:
    * **Orange**: The node currently being explored.
    * **Green**: Nodes that have been visited.
    * **Timestamp**: Displays `(Parent, Distance)`. The distance represents the shortest path from the start node by edge count.
* **Logic**: Discovers all neighbors of the current node, calculates their distance ($D = parent\_dist + 1$), and queues them for the next iteration.

### 2. Depth-First Search (DFS)
DFS explores as far as possible along each branch before backtracking.
* **Mechanism**: Implemented using a **Stack** (Last-In-First-Out) logic.
* **Visualization State**:
    * **Timestamp**: Displays `(Discovery Time / Finish Time)`.
    * **Discovery Time**: The step count when the node first enters the stack.
    * **Finish Time**: The step count when all neighbors are exhausted and the node is popped from the stack.
* **Logic**: Prioritizes moving deeper into the graph, only retreating when a node has no unvisited neighbors.

### 3. Spring-Embedder (Eades' Force-Directed Layout)
Located in the "Graph Drawer" (`manager.html`), this physics-based algorithm treats the graph as a system of springs and charged particles.

* **Coulomb’s Law (Repulsion)**: Applied to **all** node pairs.
    * $Force_{repulsion} = \frac{repulsion\_constant}{distance^2}$
    * Ensures space between vertices and prevents overlap.
* **Hooke’s Law (Attraction)**: Applied only to **connected** nodes.
    * $Force_{attraction} = attraction\_constant \times distance$
    * Acts like a spring pulling neighbors together to reveal clusters.
* **Velocity & Damping**:
    * $New\_Pos = Old\_Pos + (Force \times damping)$
    * Prevents infinite oscillation and stabilizes the layout.

---

## File Structure

* `index.html`: Main visualizer for BFS/DFS traversals.
* `manager.html`: Advanced graph editor and layout manager.
* `styles.css`: Centralized styling for nodes, edges, and interactive UI components.
* `app1.js`: The core engine containing graph data structures, traversal logic, and physics calculations.

---

## How to Use

1.  **Build a Graph**:
    * In **Visual Mode**, click "Add Vertex," then click two vertices to create a weighted edge.
    * Alternatively, paste an Adjacency Matrix or List and click "Show Graph."
2.  **Run Traversal**:
    * Enter a **Start Node** (e.g., "A").
    * Click **Start BFS** or **Start DFS**.
    * Use **Next** to step through or **Run to End** for the final traversal order.
3.  **Layout Management**:
    * Go to the **Graph Drawer** (`manager.html`).
    * Open "Options" under Force Directed Layout to adjust repulsion and attraction.
    * Click **Run All at Once** to automatically untangle the graph.

---

## Constraints
* **Visual Limit**: Rendering is optimized for up to **300 nodes**.
* **Data Processing**: Adjacency matrix inputs are capped at **300x300** to maintain browser stability.
