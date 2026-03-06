function addNode(nameOpt){

const name=nameOpt||String.fromCharCode(65+nodeIndex++);

let div=document.createElement("div");

div.className="node";
div.textContent=name;

div.style.left=gridX+"px";
div.style.top=gridY+"px";

gridX+=STEP;

if(gridX>720){
gridX=20;
gridY+=STEP;
}

makeDraggable(div);

div.onclick=()=>selectNode(name);

canvasDiv.appendChild(div);

nodes[name]=div;

if(!graph[name])
graph[name]=[];

if(!startNodeInp.value)
startNodeInp.value=name;

}

function selectNode(name){

clearSelectionHighlight();

if(!selected){

selected=name;
nodes[name].classList.add("selected-node");

}
else{

if(selected===name){

selected=null;
clearSelectionHighlight();
return;

}

let weight=prompt("Edge weight?","1");

if(weight===null){

selected=null;
clearSelectionHighlight();
return;

}

graph[selected].push({to:name,w:weight});

if(!directedChk.checked)
graph[name].push({to:selected,w:weight});

selected=null;

clearSelectionHighlight();

drawEdges();

}

}

function makeDraggable(el){

let offsetX,offsetY;

el.onmousedown=e=>{

offsetX=e.offsetX;
offsetY=e.offsetY;

document.onmousemove=m=>{

const rect=canvasDiv.getBoundingClientRect();

el.style.left=(m.pageX-rect.left-offsetX)+"px";
el.style.top=(m.pageY-rect.top-offsetY)+"px";

drawEdges();

};

document.onmouseup=()=>document.onmousemove=null;

};

}