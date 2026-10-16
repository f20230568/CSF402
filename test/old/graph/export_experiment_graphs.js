// Export the exact graphs of the experiments (Table 2 of the graph document) and check reproducibility
const fs=require('fs');const L=require('./graph_generators');
const SRC=fs.readFileSync(process.argv[3]||'family_metro_map_graph.js','utf8');
const SETS={  // identical definitions to the experiment script (cyc.js)
  'S1_trees_plus_cycle_edges':()=>[20,40,80,150].flatMap(n=>[0,1,2].map(s=>({name:`tree_plus_cycles_n${n}_seed${n*31+s}`,g:L.treePlus(n,n*31+s,3,Math.round(n*0.15))}))),
  'S2_grids':()=>[[3,3],[4,4],[5,6],[6,6],[8,8],[10,12]].map(([w,h])=>({name:`grid_${w}x${h}`,g:L.grid(w,h)})),
  'S3_cycles':()=>[5,6,12,30,60].map(n=>({name:`cycle_C${n}`,g:L.cycle(n)})),
  'S4_random_degree_max4':()=>[20,40,80].flatMap(n=>[0,1].map(s=>({name:`random_n${n}_m${Math.round(n*1.3)}_seed${n*7+s}`,g:L.randomGraph(n,Math.round(n*1.3),n*7+s,4)}))),
  'S5_random_degree_max8':()=>[30,60].flatMap(n=>[0,1].map(s=>({name:`random_n${n}_m${Math.round(n*1.8)}_seed${n*11+s}`,g:L.randomGraph(n,Math.round(n*1.8),n*11+s,8)}))),
};
const toList=g=>Object.keys(g).map(u=>`${u}:${g[u].map(e=>e.to).join(',')}`).join('\n')+'\n';
// exact copy of the parsing in app1.js buildFromList (adjacency order as the page builds it)
function parseLikePage(txt){const lines=txt.trim().split('\n');const names=new Set();
  lines.forEach(l=>{const [u]=l.split(':');if(u&&u.trim())names.add(u.trim().toUpperCase())});
  lines.forEach(l=>{const [u,n]=l.split(':');if(!u||!u.trim()||!n)return;n.split(',').forEach(x=>{x=x.trim().toUpperCase();if(x)names.add(x)})});
  const g={};names.forEach(x=>g[x]=[]);
  lines.forEach(l=>{let [u,n]=l.split(':');if(!u||!u.trim())return;u=u.trim().toUpperCase();if(!g[u])g[u]=[];if(!n)return;
    n.split(',').forEach(x=>{x=x.trim().toUpperCase();if(!x||x===u)return;if(!g[x])g[x]=[];if(!g[u].some(e=>e.to===x)){g[u].push({to:x});g[x].push({to:u})}})});
  return g}
const out=process.argv[2];const index=[];const res={};
for(const [set,mk] of Object.entries(SETS)){fs.mkdirSync(`${out}/${set}`,{recursive:true});
  for(const {name,g} of mk()){const txt=toList(g);const file=`${set}/${name}.txt`;fs.writeFileSync(`${out}/${file}`,txt);
    const E=Object.values(g).reduce((a,l)=>a+l.length,0)/2, maxDeg=Math.max(...Object.values(g).map(l=>l.length));
    const gp=parseLikePage(txt);
    const sameEdges=JSON.stringify(Object.keys(g).sort().map(u=>g[u].map(e=>e.to).sort()))===JSON.stringify(Object.keys(gp).sort().map(u=>gp[u].map(e=>e.to).sort()));
    if(!sameEdges) throw new Error('edge set changed for '+name);
    const row={set,file,n:Object.keys(g).length,m:E,maxDeg};
    for(const a of [1,0.75,0.5]){const q1=L.load(SRC,g).evaluateLayoutQuality('A',a),q2=L.load(SRC,gp).evaluateLayoutQuality('A',a);
      row['exp_'+a]=[q1.overlapCount,q1.lineIntersections];row['page_'+a]=[q2.overlapCount,q2.lineIntersections];}
    index.push(row);}}
fs.writeFileSync(`${out}/results.json`,JSON.stringify(index));
for(const a of [1,0.75,0.5]){const agg={};for(const r of index){const k=r.set;agg[k]=agg[k]||{e:[0,0,0],p:[0,0,0]};
  agg[k].e[0]+=r['exp_'+a][0];agg[k].e[1]+=r['exp_'+a][1];agg[k].e[2]+=(r['exp_'+a][0]+r['exp_'+a][1]===0);
  agg[k].p[0]+=r['page_'+a][0];agg[k].p[1]+=r['page_'+a][1];agg[k].p[2]+=(r['page_'+a][0]+r['page_'+a][1]===0);}
  for(const k in agg)console.log(`α=${a} ${k.padEnd(26)} experiment ${agg[k].e[0]}v/${agg[k].e[1]}e clean ${agg[k].e[2]} | imported via page ${agg[k].p[0]}v/${agg[k].p[1]}e clean ${agg[k].p[2]}`);}
