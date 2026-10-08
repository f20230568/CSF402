# Test tree sets S, L and H (Section 8.2 of the algorithm document)

All trees are in adjacency-list format (`A:B,C`), labelled A..Z, A1..Z1, ...; use root A.

| Set | Trees | Vertices | Max children per vertex | Seeds |
|---|---|---|---|---|
| S | 100 | 20 each of 10, 15, 20, 30, 45 | 4 | `s*31 + n`, s = 0..19 |
| L | 24  | 8 each of 60, 80, 100 | 3 | `s*13 + n`, s = 0..7 |
| H | 60  | 20 each of 30, 45, 60 (10 with max 6, 10 with max 8) | 6 or 8 | `s*17 + n`, s = 0..9 |

Generator: vertex i (i = 1..n-1) is attached to a uniformly random earlier vertex that still
has fewer than the maximum number of children (Python `random.Random(seed)`).
`generate_sets.py` recreates every file exactly: `python3 generate_sets.py <output folder>`.
`index.csv` lists set, number, size, max children, seed and file name for every tree.
