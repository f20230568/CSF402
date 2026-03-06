// Graph data
window.graph = {};
window.nodes = {};
window.edges = [];

window.history = [];
window.visited = new Set();
window.structure = [];

window.algorithm = "";
window.current = null;
window.selected = null;

window.nodeIndex = 0;

window.gridX = 20;
window.gridY = 20;

window.STEP = 70;

// DOM
window.modeSel      = document.getElementById("mode");
window.directedChk  = document.getElementById("directed");

window.visualMode   = document.getElementById("visualMode");
window.listMode     = document.getElementById("listMode");
window.matrixMode   = document.getElementById("matrixMode");

window.listInput    = document.getElementById("listInput");
window.matrixInput  = document.getElementById("matrixInput");

window.startNodeInp = document.getElementById("startNode");
window.statusP      = document.getElementById("status");

window.canvasDiv    = document.getElementById("canvas");
window.edgesSvg     = document.getElementById("edges");

// buttons
window.addNodeBtn       = document.getElementById("addNodeBtn");
window.clearBtn         = document.getElementById("clearBtn");
window.bfsBtn           = document.getElementById("bfsBtn");
window.dfsBtn           = document.getElementById("dfsBtn");
window.nextBtn          = document.getElementById("nextBtn");
window.runAllBtn        = document.getElementById("runAllBtn");
window.undoBtn          = document.getElementById("undoBtn");
window.exportListBtn    = document.getElementById("exportListBtn");
window.exportMatrixBtn  = document.getElementById("exportMatrixBtn");
window.resetBtn         = document.getElementById("resetBtn");