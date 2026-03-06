addNodeBtn.onclick=()=>addNode();

clearBtn.onclick=()=>clearGraph();

bfsBtn.onclick=()=>startAlgo("BFS");

dfsBtn.onclick=()=>startAlgo("DFS");

nextBtn.onclick=()=>stepForward();

runAllBtn.onclick=()=>runToEnd();

undoBtn.onclick=()=>stepBack();

exportListBtn.onclick=()=>exportList();

exportMatrixBtn.onclick=()=>exportMatrix();

resetBtn.onclick=()=>fullReset();

listInput.addEventListener("change",parseList);
matrixInput.addEventListener("change",parseMatrix);

listInput.addEventListener("blur",parseList);
matrixInput.addEventListener("blur",parseMatrix);