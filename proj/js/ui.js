function switchMode() {

visualMode.style.display="none";
listMode.style.display="none";
matrixMode.style.display="none";

const m=modeSel.value;

if(m==="visual") visualMode.style.display="block";
else if(m==="list") listMode.style.display="block";
else if(m==="matrix") matrixMode.style.display="block";

}

function clearSelectionHighlight(){
Object.values(nodes).forEach(n=>n.classList.remove("selected-node"));
}

function drawEdges(){

edgesSvg.innerHTML="";

for(let u in graph){

(graph[u]||[]).forEach(e=>{

let v=e.to;

if(!nodes[u]||!nodes[v]) return;

let r1=nodes[u].getBoundingClientRect();
let r2=nodes[v].getBoundingClientRect();
let c=canvasDiv.getBoundingClientRect();

let x1=r1.left-c.left+22;
let y1=r1.top-c.top+22;

let x2=r2.left-c.left+22;
let y2=r2.top-c.top+22;

let line=document.createElementNS("http://www.w3.org/2000/svg","line");

line.setAttribute("x1",x1);
line.setAttribute("y1",y1);
line.setAttribute("x2",x2);
line.setAttribute("y2",y2);

line.setAttribute("stroke","black");
line.setAttribute("stroke-width","2");

if(directedChk.checked)
line.setAttribute("marker-end","url(#arrowhead)");

edgesSvg.appendChild(line);

let text=document.createElementNS("http://www.w3.org/2000/svg","text");

text.setAttribute("x",(x1+x2)/2);
text.setAttribute("y",(y1+y2)/2);

text.textContent=e.w;
text.setAttribute("class","edge-label");

edgesSvg.appendChild(text);

});

}

}

directedChk.addEventListener("change",drawEdges);

function update(){

Object.values(nodes).forEach(n=>n.classList.remove("visited","current"));

visited.forEach(v=>nodes[v]?.classList.add("visited"));

if(nodes[current])
nodes[current].classList.add("current");

statusP.innerText=
`${algorithm} | Structure: [${structure.join(", ")}]`;

}