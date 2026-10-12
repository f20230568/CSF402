const fs=require('fs');
function label(i){return String.fromCharCode(65+(i%26))+(i>=26?Math.floor(i/26):"")}
function rng(seed){let s=seed>>>0;return()=>{s=(s*1103515245+12345)&0x7fffffff;return s/0x7fffffff}}
function empty(n){const g={};for(let i=0;i<n;i++)g[label(i)]=[];return g}
function add(g,a,b){if(a===b||g[a].some(e=>e.to===b))return false;g[a].push({to:b});g[b].push({to:a});return true}
function tree(n,seed,maxk){const r=rng(seed),L=Object.keys(empty(n)),g=empty(n),kids={};
 for(let i=1;i<n;i++){let p;do{p=Math.floor(r()*i)}while((kids[p]||0)>=maxk);kids[p]=(kids[p]||0)+1;add(g,L[i],L[p])}return g}
// tree plus `extra` cycle edges between vertices at BFS distance 2..maxDist, keeping degree <= 8
function treePlus(n,seed,maxk,extra,maxDist=3){const g=tree(n,seed,maxk),r=rng(seed*7+1),L=Object.keys(g);let added=0,tries=0;
 while(added<extra&&tries<extra*200){tries++;const a=L[Math.floor(r()*n)];
   const dist={[a]:0},q=[a];for(let i=0;i<q.length;i++){const u=q[i];if(dist[u]>=maxDist)continue;g[u].forEach(e=>{if(dist[e.to]===undefined){dist[e.to]=dist[u]+1;q.push(e.to)}})}
   const cand=Object.keys(dist).filter(x=>dist[x]>=2);if(!cand.length)continue;const b=cand[Math.floor(r()*cand.length)];
   if(g[a].length>=8||g[b].length>=8)continue;if(add(g,a,b))added++;}
 return g}
function grid(w,h){const g=empty(w*h),L=Object.keys(g);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(x+1<w)add(g,L[i],L[i+1]);if(y+1<h)add(g,L[i],L[i+w])}return g}
function cycle(n){const g=empty(n),L=Object.keys(g);for(let i=0;i<n;i++)add(g,L[i],L[(i+1)%n]);return g}
function randomGraph(n,m,seed,maxDeg=4){const g=tree(n,seed,3),r=rng(seed*13+5),L=Object.keys(g);let e=n-1,t=0;
 while(e<m&&t<m*100){t++;const a=L[Math.floor(r()*n)],b=L[Math.floor(r()*n)];if(g[a].length>=maxDeg||g[b].length>=maxDeg)continue;if(add(g,a,b))e++}return g}
function load(src,g,extraReturn=''){const nodes={};for(const k in g)nodes[k]={style:{},dataset:{},classList:{add(){},remove(){}},offsetLeft:0,offsetTop:0};
 const w={metroOverridesByRoot:{},metroChangeSummaryByRoot:{},stepBfsState:{}};
 const m=new Function('window','document','graph','nodes','alert',src+'\nreturn {generateFamilyMetroCoordinates,evaluateLayoutQuality,computeBFSLayers'+extraReturn+'};')(w,{getElementById:(id)=>id==='startNode'?{value:'A'}:null},g,nodes,()=>{});m.w=w;return m}
module.exports={label,rng,tree,treePlus,grid,cycle,randomGraph,load,add,empty};
