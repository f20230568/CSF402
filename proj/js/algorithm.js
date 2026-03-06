function startAlgo(type){

if(!startNodeInp.value){
alert("Enter a start node.");
return;
}

const s=startNodeInp.value.trim();

if(!graph[s]){
alert("Start node not found.");
return;
}

history=[];
visited.clear();
structure=[];
current=null;

algorithm=type;

structure.push(s);

snapshot();
update();

}

function stepForward(){

if(!structure.length) return;

snapshot();

current=(algorithm==="BFS")
?structure.shift()
:structure.pop();

if(!visited.has(current)){

visited.add(current);

(graph[current]||[]).forEach(e=>{

if(!visited.has(e.to)&&!structure.includes(e.to))
structure.push(e.to);

});

}

update();
checkFinished();

}

function runToEnd(){

while(structure.length){

current=(algorithm==="BFS")
?structure.shift()
:structure.pop();

if(!visited.has(current)){

visited.add(current);

(graph[current]||[]).forEach(e=>{

if(!visited.has(e.to)&&!structure.includes(e.to))
structure.push(e.to);

});

}

}

update();
checkFinished();

}