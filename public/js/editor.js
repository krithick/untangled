(function(){
"use strict";
const MODE=/^\/s\//.test(location.pathname)?"share":/^\/demo/.test(location.pathname)?"demo":"edit";
const READONLY=MODE==="share";
/* Samples live in /js/templates.js */
const MERMAID_URL="/vendor/mermaid.min.js";
const SYS='-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif';
const MONO='ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace';
const TYPE_NAMES={sequenceDiagram:"Sequence diagram",classDiagram:"Class diagram",stateDiagram:"State diagram","stateDiagram-v2":"State diagram",gantt:"Gantt chart",pie:"Pie chart",mindmap:"Mindmap",timeline:"Timeline",gitGraph:"Git graph",journey:"User journey",quadrantChart:"Quadrant chart","sankey-beta":"Sankey diagram","xychart-beta":"XY chart","block-beta":"Block diagram","architecture-beta":"Architecture diagram","packet-beta":"Packet diagram",kanban:"Kanban board",requirementDiagram:"Requirement diagram",C4Context:"C4 diagram",C4Container:"C4 diagram",C4Component:"C4 diagram",C4Dynamic:"C4 diagram",C4Deployment:"C4 diagram",zenuml:"ZenUML diagram",radar:"Radar chart",treemap:"Treemap"};

/* ================= constants & helpers ================= */
const LEFT={"|o":"zeroOne","||":"one","}o":"zeroMany","}|":"oneMany"};
const RIGHT={"o|":"zeroOne","||":"one","o{":"zeroMany","|{":"oneMany"};
const inv=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[v,k]));
const LEFT_OUT=inv(LEFT),RIGHT_OUT=inv(RIGHT);
const KIND_LABEL={one:"Exactly one",zeroOne:"Zero or one",oneMany:"One or more",zeroMany:"Zero or more"};
const SHAPES={rect:"Rectangle",round:"Rounded",stadium:"Pill (start/end)",diamond:"Diamond (decision)",circle:"Circle",sub:"Subroutine"};
const WRAP={rect:["[","]"],round:["(",")"],stadium:["([","])"],diamond:["{","}"],circle:["((","))"],sub:["[[","]]"]};
const OPS={solid:["-->","---"],thick:["==>","==="],dotted:["-.->","-.-"]};
const HEAD=32,ROW=22,PADX=12,LH=17;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const svg=$("svg"),world=$("world"),stage=$("stage"),inline=$("inline");
const cv=document.createElement("canvas").getContext("2d");
const FT={title:`600 13px ${SYS}`,type:`400 11.5px ${MONO}`,name:`400 12.5px ${SYS}`,key:`600 10.5px ${MONO}`,lbl:`400 11.5px ${SYS}`,node:`500 13px ${SYS}`};
let EXPORTING=false;
/* text element; in exports, textLength pins each label to its measured width so it can't spill out of its box on another computer */
function T(cls,x,y,s,font,anchor){const fit=EXPORTING&&s?` textLength="${tw(s,font).toFixed(1)}" lengthAdjust="spacingAndGlyphs"`:"";return `<text class="${cls}" x="${x}" y="${y}"${anchor?` text-anchor="${anchor}"`:""}${fit}>${esc(s)}</text>`}
function tw(s,f){cv.font=FT[f];return cv.measureText(s).width}
function store(k,v){try{if(v===undefined)return localStorage.getItem(k);localStorage.setItem(k,v)}catch(e){return null}}
let toastT=0;function toast(msg){const t=$("toast");t.textContent=msg;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true},2600)}

/* SVG styles live here so exported images carry them too */
const SVG_CSS=`
.ent-box{fill:var(--panel);stroke:var(--node-line);stroke-width:1.2}
.ent-head{fill:var(--head);stroke:none}
.ent-rule{stroke:var(--line);stroke-width:1}
.ent-title{font:600 13px ${SYS};fill:var(--ink);letter-spacing:.02em;pointer-events:none}
.row-hit{fill:rgba(0,0,0,0)}
.a-type{font:400 11.5px ${MONO};fill:var(--muted);pointer-events:none}
.a-name{font:400 12.5px ${SYS};fill:var(--ink);pointer-events:none}
.a-key{font:600 10.5px ${MONO};pointer-events:none}
.k-PK{fill:var(--pk)}.k-FK{fill:var(--fk)}.k-UK{fill:var(--uk)}
.fn-shape{fill:var(--panel);stroke:var(--node-line);stroke-width:1.4}
.fn-shape.diamond{fill:var(--head)}
.fn-shape.stadium,.fn-shape.circle{fill:var(--accent-soft);stroke:var(--accent)}
.fn-sub{stroke:var(--node-line);stroke-width:1.2}
.fn-text{font:500 13px ${SYS};fill:var(--ink);pointer-events:none}
.note-dot{fill:var(--accent);pointer-events:none}
.edge-hit{fill:none;stroke:rgba(0,0,0,0);stroke-width:16}
.edge-line{fill:none;stroke:var(--edge);stroke-width:1.5;pointer-events:none}
.edge.dashed .edge-line{stroke-dasharray:6 5}
.edge.dotted .edge-line{stroke-dasharray:2 5;stroke-linecap:round;stroke-width:1.8}
.edge.thick .edge-line{stroke-width:3.2}
.mk{fill:none;stroke:var(--edge);stroke-width:1.5;pointer-events:none}
.mk-c{fill:var(--canvas);stroke:var(--edge);stroke-width:1.5;pointer-events:none}
.arrow{fill:var(--edge);pointer-events:none}
.lbl rect{fill:var(--panel);stroke:var(--line);stroke-width:1}
.lbl text{font:400 11.5px ${SYS};fill:var(--muted);pointer-events:none}
.knob{fill:var(--panel);stroke:var(--edge);stroke-width:1.2;opacity:0}
.lifeline{stroke:var(--node-line);stroke-width:1.2;stroke-dasharray:4 4}
.actor-s{fill:none;stroke:var(--ink);stroke-width:1.6}
.lbl-seq{font:400 11.5px ${SYS};fill:var(--ink);pointer-events:none}
.note-box{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1}
.note-t{font:400 11.5px ${SYS};fill:var(--ink);pointer-events:none}
.seqnum circle{fill:var(--ink)}.seqnum text{font:600 10px ${SYS};fill:var(--panel)}
.end-knob{fill:var(--panel);stroke:var(--accent);stroke-width:1.5;opacity:0}
`;
const LIVE_CSS=`
.ent-head,.ent-box,.row-hit,.fn-shape{cursor:move}
.row-hit:hover{fill:var(--accent-soft)}
.node.sel .ent-box,.node.sel .fn-shape{stroke:var(--accent);stroke-width:2.4}
.node.src .ent-box,.node.src .fn-shape{stroke:var(--accent);stroke-width:2.4;stroke-dasharray:5 4}
.edge-hit{cursor:pointer}
.edge.sel .edge-line,.edge.sel .mk,.edge.sel .mk-c{stroke:var(--accent)}
.edge.sel .arrow{fill:var(--accent)}
.edge.sel .edge-line{stroke-width:2.4}
.lbl{cursor:grab}
.lbl:hover rect{stroke:var(--accent)}
.edge.sel .lbl rect{stroke:var(--accent);fill:var(--accent-soft)}
.edge.sel .lbl text{fill:var(--ink)}
.edge:hover .knob,.edge.sel .knob{opacity:1}
.edge.sel .knob{stroke:var(--accent)}
.dim{opacity:.16}
.node.visited .fn-shape{fill:var(--accent-soft)}
.node.cur .fn-shape{stroke:var(--accent);stroke-width:3.4}
.node.next .fn-shape{stroke:var(--accent);stroke-width:2;stroke-dasharray:5 4;cursor:pointer}
.edge.walked .edge-line{stroke:var(--accent);stroke-width:2.6}
.edge.walked .arrow{fill:var(--accent)}
.edge.nexte .edge-line{stroke:var(--accent);stroke-dasharray:5 4}
.edge.nexte .arrow{fill:var(--accent)}
.edge.nexte .lbl rect{stroke:var(--accent)}
.node{transition:opacity .2s}.edge{transition:opacity .2s}
.end-knob{cursor:ew-resize}.edge:hover .end-knob,.edge.sel .end-knob{opacity:1}
.edge.sel .lbl-seq{fill:var(--accent);font-weight:600}.edge.sel .note-box{stroke-width:2.4}
.edge.cur .edge-line{stroke:var(--accent);stroke-width:3}.edge.cur .lbl-seq{fill:var(--accent);font-weight:600}.edge.cur .note-box{stroke-width:2.4}
.edge.walked .mk{stroke:var(--accent)}
`;
const st=document.createElement("style");st.textContent=SVG_CSS+LIVE_CSS;document.head.appendChild(st);

/* ================= model ================= */
let M={kind:"er",dir:"TD",nodes:[],edges:[]};
let seq=0;const nid=()=>"n"+(++seq);
const V={tx:0,ty:0,k:1};
const S={sel:null,connect:false,src:null,snap:true,focus:false};
const W={on:false,trail:[],etrail:[]};
let history=[];
const byId=id=>M.nodes.find(n=>n.id===id);
const byKey=k=>M.nodes.find(n=>n.key===k);
const nodeLabel=n=>M.kind==="er"?n.key:n.text;

const stripFront=src=>src.replace(/^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/,"");
function firstWord(src){for(const raw of stripFront(src).split(/\r?\n/)){const t=raw.trim();if(!t||t.startsWith("%%"))continue;return t.split(/\s+/)[0]}return ""}
function detectKind(src){const w=firstWord(src);if(!w)return null;if(w==="erDiagram")return "er";if(w==="flowchart"||w==="graph")return "flow";if(w==="sequenceDiagram")return "seq";return /^[A-Za-z][\w-]*$/.test(w)?"view":null}
const typeName=w=>w==="seq"?"Sequence diagram":TYPE_NAMES[w]||(w==="erDiagram"?"ER diagram":w==="flowchart"||w==="graph"?"Flowchart":w);
function parseMeta(t,meta){
  let m=t.match(/^%%\s*layout:\s*(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);if(m){meta.layout[m[1]]={x:+m[2],y:+m[3]};return}
  m=t.match(/^%%\s*bend:\s*(\S+)\s+(\S+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);if(m){meta.bends.push({a:m[1],b:m[2],dx:+m[3],dy:+m[4]});return}
  m=t.match(/^%%\s*note:\s*(\S+)\s+(.*)$/);if(m)meta.notes[m[1]]=m[2].replace(/\\n/g,"\n");
}
function parseER(src){
  const nodes=new Map(),edges=[],errors=[],meta={layout:{},bends:[],notes:{}};let cur=null;
  const ensure=k=>{if(!nodes.has(k))nodes.set(k,{key:k,attrs:[]});return nodes.get(k)};
  src.split(/\r?\n/).forEach((raw,i)=>{
    const t=raw.trim();if(!t)return;
    if(t.startsWith("%%")){parseMeta(t,meta);return}
    if(cur){if(t==="}"){cur=null;return}
      const m=t.match(/^(\S+)\s+([^\s"]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/);
      if(m)cur.attrs.push({type:m[1],name:m[2],keys:m[3]?m[3].split(/\s*,\s*/):[],comment:m[4]||""});else errors.push(i+1);return}
    if(/^erDiagram\b/.test(t))return;
    let m=t.match(/^"?([\w-]+)"?\s*\{\s*(\})?$/);if(m){const e=ensure(m[1]);if(!m[2])cur=e;return}
    m=t.match(/^"?([\w-]+)"?\s+(\|o|\|\||\}o|\}\|)(--|\.\.)(o\||\|\||o\{|\|\{)\s+"?([\w-]+)"?\s*:\s*(.+)$/);
    if(m){ensure(m[1]);ensure(m[5]);let label=m[6].trim();if(/^".*"$/.test(label))label=label.slice(1,-1);
      edges.push({a:m[1],b:m[5],ka:LEFT[m[2]],kb:RIGHT[m[4]],ident:m[3]==="--",label});return}
    m=t.match(/^"?([\w-]+)"?$/);if(m){ensure(m[1]);return}
    errors.push(i+1);
  });
  return {kind:"er",dir:"TD",nodes:[...nodes.values()],edges,meta,errors};
}
const NODE_RE=/^\s*([A-Za-z0-9_]+)(?:\s*(\[\[([^\]]*)\]\]|\(\[([^\]]*)\]\)|\(\(([^)]*)\)\)|\[([^\]]*)\]|\(([^)]*)\)|\{([^}]*)\}))?/;
const LINK_RE=/^\s*(-->|---|==>|===|-\.->|-\.-)\s*(?:\|([^|]*)\|)?/;
const LINK_T_RE=/^\s*(--|==|-\.)\s+(.+?)\s+(-->|---|==>|===|\.->|\.-)/;
const cleanText=s=>{s=s.trim();if(/^".*"$/.test(s))s=s.slice(1,-1);return s.replace(/#quot;/g,'"')};
function parseFlow(src){
  const nodes=new Map(),edges=[],errors=[],meta={layout:{},bends:[],notes:{}};let dir="TD";
  const def=m=>{const k=m[1];if(!nodes.has(k))nodes.set(k,{key:k,text:k,shape:"rect"});const n=nodes.get(k);
    if(m[2]){const g=[3,4,5,6,7,8].find(i=>m[i]!==undefined);n.shape={3:"sub",4:"stadium",5:"circle",6:"rect",7:"round",8:"diamond"}[g];n.text=cleanText(m[g])||k}
    return k};
  src.split(/\r?\n/).forEach((raw,i)=>{
    let t=raw.trim().replace(/;\s*$/,"");if(!t)return;
    if(t.startsWith("%%")){parseMeta(t,meta);return}
    let m=t.match(/^(flowchart|graph)\b\s*(TD|TB|LR|RL|BT)?/);if(m){dir=m[2]==="TB"?"TD":(m[2]||"TD");return}
    if(/^(subgraph|end|classDef|class|style|linkStyle|click|direction)\b/.test(t))return;
    let rest=t;m=NODE_RE.exec(rest);if(!m){errors.push(i+1);return}
    let prev=def(m);rest=rest.slice(m[0].length);
    while(rest.trim()){
      let style,arrow,label="",lm=LINK_RE.exec(rest);
      if(lm){const op=lm[1];style=op[0]==="="?"thick":op.includes(".")?"dotted":"solid";arrow=op.endsWith(">");label=lm[2]?cleanText(lm[2]):"";rest=rest.slice(lm[0].length)}
      else{lm=LINK_T_RE.exec(rest);if(!lm){errors.push(i+1);break}
        style=lm[1]==="=="?"thick":lm[1]==="-."?"dotted":"solid";arrow=lm[3].endsWith(">");label=cleanText(lm[2]);rest=rest.slice(lm[0].length)}
      const nm=NODE_RE.exec(rest);if(!nm){errors.push(i+1);break}
      const nx=def(nm);edges.push({a:prev,b:nx,label,style,arrow});prev=nx;rest=rest.slice(nm[0].length);
    }
  });
  return {kind:"flow",dir,nodes:[...nodes.values()],edges,meta,errors};
}

function build(src,keepPositions){
  const kind=detectKind(src);if(!kind)return {model:null,errors:["This doesn't look like Mermaid. The first line should name the diagram type, for example flowchart TD or sequenceDiagram."]};
  if(kind==="view")return {model:{kind:"view",type:firstWord(src),src:src.trim(),dir:"TD",nodes:[],edges:[]},errors:[]};
  src=stripFront(src);
  if(kind==="seq"){const P=parseSeq(src);
    if(P.unsupported)return {model:{kind:"view",type:"sequenceDiagram",src:src.trim(),why:`It uses "${P.unsupported.word}" on line ${P.unsupported.line}, which can't be edited yet.`,dir:"TD",nodes:[],edges:[]},errors:[]};
    const nodes=P.parts.map(p=>({id:nid(),key:p.key,text:p.text,shape:p.shape,attrs:[],note:P.meta.notes[p.key]||"",x:0,y:0}));
    const ids=new Map(nodes.map(n=>[n.key,n.id]));
    const edges=P.items.map(it=>({t:it.t,a:ids.get(it.a),b:it.b?ids.get(it.b):null,label:it.label,arrow:it.arrow||"->>",act:it.act||"",pos:it.pos||"",bend:null}));
    return {model:{kind:"seq",dir:"TD",title:P.title,auto:P.auto,nodes,edges},errors:P.errors}}
  const P=kind==="er"?parseER(src):parseFlow(src);
  const old=keepPositions&&M.kind===kind?new Map(M.nodes.map(n=>[n.key,n])):new Map();
  const nodes=P.nodes.map(n=>({id:nid(),key:n.key,text:n.text||"",shape:n.shape||"rect",attrs:n.attrs||[],note:P.meta.notes[n.key]||(old.get(n.key)||{}).note||"",x:NaN,y:NaN}));
  const ids=new Map(nodes.map(n=>[n.key,n.id]));
  const edges=P.edges.map(e=>{const b=P.meta.bends.find(x=>x.a===e.a&&x.b===e.b);
    const base={a:ids.get(e.a),b:ids.get(e.b),label:e.label||"",bend:b?{dx:b.dx,dy:b.dy}:null};
    return kind==="er"?Object.assign(base,{ka:e.ka,kb:e.kb,ident:e.ident}):Object.assign(base,{style:e.style,arrow:e.arrow})});
  const model={kind,dir:P.dir,nodes,edges};
  let missing=0;
  nodes.forEach(n=>{const L=P.meta.layout[n.key],o=old.get(n.key);if(L){n.x=L.x;n.y=L.y}else if(o){n.x=o.x;n.y=o.y}else missing++});
  if(missing){
    if(kind==="flow"||missing<nodes.length){layoutInto(model,missing===nodes.length)}
    else{const cols=Math.max(1,Math.ceil(Math.sqrt(nodes.length)));nodes.forEach((n,i)=>{n.x=40+(i%cols)*250;n.y=40+Math.floor(i/cols)*230})}
  }
  return {model,errors:P.errors};
}
function layoutInto(model,all){
  const keep=M;M=model;M.nodes.forEach(measure);
  if(M.kind==="flow"&&all)layered();
  else{let maxY=0;M.nodes.forEach(n=>{if(!isNaN(n.y))maxY=Math.max(maxY,n.y+n.h)});let x=40;
    M.nodes.forEach(n=>{if(isNaN(n.x)){n.x=x;n.y=maxY+80;x+=n.w+40}})}
  M=keep;
}

const quote=s=>/^[\w-]+$/.test(s)?s:`"${String(s).replace(/"/g,"'")}"`;
function flowText(n){const [o,c]=WRAP[n.shape]||WRAP.rect;const t=n.text||n.key;return o+(/[\[\]{}()|"<>]/.test(t)?`"${t.replace(/"/g,"#quot;")}"`:t)+c}
function toMermaid(){
  if(M.kind==="view")return M.src;
  if(M.kind==="seq")return seqToMermaid();
  const L=[];
  if(M.kind==="er"){
    const nm=id=>byId(id).key;L.push("erDiagram");
    M.edges.forEach(r=>L.push(`    ${nm(r.a)} ${LEFT_OUT[r.ka]}${r.ident?"--":".."}${RIGHT_OUT[r.kb]} ${nm(r.b)} : ${quote(r.label||"has")}`));
    M.nodes.forEach(e=>{
      if(!e.attrs.length){if(!M.edges.some(r=>r.a===e.id||r.b===e.id))L.push(`    ${e.key} {`,"    }");return}
      L.push(`    ${e.key} {`);
      e.attrs.forEach(a=>L.push(`        ${a.type} ${a.name}${a.keys.length?" "+a.keys.join(", "):""}${a.comment?` "${a.comment}"`:""}`));
      L.push("    }")});
  }else{
    L.push(`flowchart ${M.dir}`);
    M.nodes.forEach(n=>L.push(`    ${n.key}${flowText(n)}`));
    M.edges.forEach(e=>{const op=OPS[e.style||"solid"][e.arrow?0:1];const lab=e.label?`|${e.label.replace(/\|/g,"/")}|`:"";L.push(`    ${byId(e.a).key} ${op}${lab} ${byId(e.b).key}`)});
  }
  L.push("%% Layout saved by Untangle. Mermaid ignores these lines.");
  M.nodes.forEach(n=>L.push(`%% layout: ${n.key} ${Math.round(n.x)} ${Math.round(n.y)}`));
  M.edges.forEach(r=>{if(r.bend)L.push(`%% bend: ${byId(r.a).key} ${byId(r.b).key} ${Math.round(r.bend.dx)} ${Math.round(r.bend.dy)}`)});
  M.nodes.forEach(n=>{if(n.note&&n.note.trim())L.push(`%% note: ${n.key} ${n.note.trim().replace(/\n/g,"\\n")}`)});
  return L.join("\n");
}

const snapshot=()=>JSON.stringify({kind:M.kind,dir:M.dir,type:M.type,src:M.src,why:M.why,title:M.title,auto:M.auto,nodes:M.nodes.map(({id,key,text,shape,attrs,note,x,y})=>({id,key,text,shape,attrs,note,x,y})),edges:M.edges});
function pushHistory(snap){if(snap&&snap!==snapshot()){history.push(snap);if(history.length>100)history.shift()}$("t-undo").disabled=!history.length}
function mutate(fn){const s=snapshot();fn();pushHistory(s);changed()}
function undo(){const s=history.pop();if(!s)return;const prevKind=M.kind;M=JSON.parse(s);if(S.sel&&!selExists())S.sel=null;if(W.on)walkStop();$("t-undo").disabled=!history.length;changed();if(prevKind!==M.kind){kindUI();fit()}}
function selExists(){return S.sel.type==="node"?!!byId(S.sel.id):!!M.edges[S.sel.i]}
function changed(){draw();syncCode();save();inspector()}
function save(){appSave()}
function uniqueKey(base,except){let n=base,i=2;while(M.nodes.some(e=>e.key===n&&e.id!==except))n=`${base}_${i++}`;return n}
const cleanName=s=>s.trim().replace(/\s+/g,"_").replace(/[^\w-]/g,"").toUpperCase();

/* ================= geometry ================= */
function wrapText(s,max){const words=String(s||" ").split(/\s+/);const out=[];let line="";
  words.forEach(w=>{const t=line?line+" "+w:w;if(tw(t,"node")>max&&line){out.push(line);line=w}else line=t});out.push(line);return out}
function measure(n){
  if(M.kind==="er"){
    let typeW=0,nameW=0,keyW=0;
    n.attrs.forEach(a=>{typeW=Math.max(typeW,tw(a.type,"type"));nameW=Math.max(nameW,tw(a.name,"name"));if(a.keys.length)keyW=Math.max(keyW,tw(a.keys.join(" "),"key"))});
    const rowW=PADX+typeW+12+nameW+(keyW?16+keyW:0)+PADX;
    n._tw=typeW;n.w=Math.ceil(Math.max(150,tw(n.key,"title")+PADX*2+18,rowW));n.h=HEAD+n.attrs.length*ROW+(n.attrs.length?8:4);return}
  const lines=wrapText(n.text,170);n.lines=lines;const t=Math.max(...lines.map(l=>tw(l,"node"))),th=lines.length*LH;
  if(n.shape==="diamond"){n.w=Math.max(120,t*1.45+48);n.h=Math.max(70,th*1.5+40)}
  else if(n.shape==="circle"){const d=Math.max(76,Math.max(t,th)+34);n.w=n.h=d}
  else if(n.shape==="stadium"){n.w=Math.max(110,t+48);n.h=Math.max(42,th+22)}
  else{n.w=Math.max(100,t+(n.shape==="sub"?48:32));n.h=Math.max(42,th+22)}
  n.w=Math.ceil(n.w);n.h=Math.ceil(n.h);
}
const ctr=n=>({x:n.x+n.w/2,y:n.y+n.h/2});
function border(n,toward){
  const c=ctr(n);let dx=toward.x-c.x,dy=toward.y-c.y;if(!dx&&!dy)dy=1;
  const hw=n.w/2,hh=n.h/2;let t;
  if(M.kind==="flow"&&n.shape==="diamond")t=1/(Math.abs(dx)/hw+Math.abs(dy)/hh);
  else if(M.kind==="flow"&&n.shape==="circle")t=1/Math.sqrt((dx/hw)**2+(dy/hh)**2);
  else t=Math.min(hw/Math.abs(dx||1e-9),hh/Math.abs(dy||1e-9));
  return {x:c.x+dx*t,y:c.y+dy*t};
}
const unit=(a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy)||1;return {x:dx/l,y:dy/l}};
function relMid(r){const A=byId(r.a),B=byId(r.b);if(A===B)return {x:A.x+A.w+46,y:A.y-34};const a=ctr(A),b=ctr(B);return {x:(a.x+b.x)/2,y:(a.y+b.y)/2}}
function geom(r){
  const A=byId(r.a),B=byId(r.b);const mid=relMid(r);
  let H=r.bend?{x:mid.x+r.bend.dx,y:mid.y+r.bend.dy}:mid,pA,pB,C=null;
  if(A===B){pA={x:A.x+A.w,y:A.y+Math.min(HEAD/2,A.h/2)};pB={x:A.x+A.w-Math.min(34,A.w/3),y:A.y}}
  else{pA=border(A,r.bend?H:ctr(B));pB=border(B,r.bend?H:ctr(A))}
  if(r.bend||A===B)C={x:2*H.x-(pA.x+pB.x)/2,y:2*H.y-(pA.y+pB.y)/2};else H={x:(pA.x+pB.x)/2,y:(pA.y+pB.y)/2};
  const uA=unit(pA,C||pB),uB=unit(pB,C||pA);
  let end=pB;if(M.kind==="flow"&&r.arrow)end={x:pB.x+uB.x*9,y:pB.y+uB.y*9};
  const path=C?`M${pA.x} ${pA.y}Q${C.x} ${C.y} ${end.x} ${end.y}`:`M${pA.x} ${pA.y}L${end.x} ${end.y}`;
  return {pA,pB,H,path,uA,uB};
}
function crowMarker(p,u,kind){
  const n={x:-u.y,y:u.x},at=d=>({x:p.x+u.x*d,y:p.y+u.y*d});
  const bar=d=>{const c=at(d);return `M${c.x+n.x*7} ${c.y+n.y*7}L${c.x-n.x*7} ${c.y-n.y*7}`};
  const crow=()=>{const c=at(13);return `M${c.x} ${c.y}L${p.x+n.x*8} ${p.y+n.y*8}M${c.x} ${c.y}L${p.x} ${p.y}M${c.x} ${c.y}L${p.x-n.x*8} ${p.y-n.y*8}`};
  let d="",c=null;
  if(kind==="one")d=bar(8)+bar(14);else if(kind==="zeroOne"){d=bar(8);c=at(19)}else if(kind==="oneMany")d=crow()+bar(18);else{d=crow();c=at(19)}
  return `<path class="mk" d="${d}"/>${c?`<circle class="mk-c" cx="${c.x}" cy="${c.y}" r="4.5"/>`:""}`;
}
function arrowHead(p,u){const n={x:-u.y,y:u.x},b={x:p.x+u.x*11,y:p.y+u.y*11};return `<path class="arrow" d="M${p.x} ${p.y}L${b.x+n.x*5.5} ${b.y+n.y*5.5}L${b.x-n.x*5.5} ${b.y-n.y*5.5}Z"/>`}

/* ================= state classes (focus, walkthrough) ================= */
function litSets(){
  if(M.kind==="seq"){
    if(W.on){const e=M.edges[W.si];return {mode:"seqwalk",si:W.si,nodes:new Set(e?[e.a,e.b].filter(Boolean):[])}}
    if(!S.focus||!S.sel)return null;const nodes=new Set(),edges=new Set();
    if(S.sel.type==="node"){nodes.add(S.sel.id);M.edges.forEach((e,i)=>{if(e.a===S.sel.id||e.b===S.sel.id){edges.add(i);nodes.add(e.a);if(e.b)nodes.add(e.b)}})}
    else{const e=M.edges[S.sel.i];edges.add(S.sel.i);nodes.add(e.a);if(e.b)nodes.add(e.b)}
    return {mode:"focus",nodes,edges}}
  if(W.on&&M.kind==="flow"){const cur=W.trail[W.trail.length-1];const outs=M.edges.map((e,i)=>[e,i]).filter(([e])=>e.a===cur);
    return {mode:"walk",cur,visited:new Set(W.trail),next:new Set(outs.map(([e])=>e.b)),walked:new Set(W.etrail),nexte:new Set(outs.map(([,i])=>i))}}
  if(!S.focus||!S.sel)return null;
  let seeds=S.sel.type==="node"?[S.sel.id]:[M.edges[S.sel.i].a,M.edges[S.sel.i].b];
  const nodes=new Set(seeds),edges=new Set();
  if(S.sel.type==="edge")edges.add(S.sel.i);
  else if(M.kind==="er"){M.edges.forEach((e,i)=>{if(e.a===seeds[0]||e.b===seeds[0]){nodes.add(e.a);nodes.add(e.b);edges.add(i)}})}
  else{
    const walk=(dirA,dirB)=>{const seen=new Set([seeds[0]]),q=[seeds[0]];while(q.length){const c=q.shift();M.edges.forEach((e,i)=>{if(e[dirA]===c){edges.add(i);if(!seen.has(e[dirB])){seen.add(e[dirB]);nodes.add(e[dirB]);q.push(e[dirB])}}})}};
    walk("a","b");walk("b","a");
  }
  return {mode:"focus",nodes,edges};
}

/* ================= drawing ================= */
function renderInner(plain){
  if(M.kind==="seq")return renderSeq(plain);
  M.nodes.forEach(measure);
  const L=plain?null:litSets();
  let out="",labs="";
  M.edges.forEach((r,i)=>{
    if(!byId(r.a)||!byId(r.b))return;
    const g=geom(r);let cls="edge";
    if(M.kind==="er"){if(!r.ident)cls+=" dashed"}else{if(r.style==="thick")cls+=" thick";if(r.style==="dotted")cls+=" dotted"}
    if(!plain){if(S.sel&&S.sel.type==="edge"&&S.sel.i===i)cls+=" sel";
      if(L){if(L.mode==="walk"){cls+=L.walked.has(i)?" walked":L.nexte.has(i)?" nexte":" dim"}else if(!L.edges.has(i))cls+=" dim"}}
    let marks="";
    if(M.kind==="er")marks=crowMarker(g.pA,g.uA,r.ka)+crowMarker(g.pB,g.uB,r.kb);else if(r.arrow)marks=arrowHead(g.pB,g.uB);
    let lab="";
    if(r.label){const lw=tw(r.label,"lbl")+16;lab=`<g class="lbl" data-hit="label:${i}"><rect x="${g.H.x-lw/2}" y="${g.H.y-10}" width="${lw}" height="20" rx="10"/>${T("lbl-t",g.H.x,g.H.y+4,r.label,"lbl","middle")}</g>`}
    else if(!plain)lab=`<circle class="knob" data-hit="label:${i}" cx="${g.H.x}" cy="${g.H.y}" r="6"/>`;
    out+=`<g class="${cls}">${plain?"":`<path class="edge-hit" data-hit="rel:${i}" d="${g.path}"/>`}<path class="edge-line" d="${g.path}"/>${marks}</g>`;
    if(lab)labs+=`<g class="${cls}">${lab}</g>`;
  });
  const order=M.nodes.slice();
  if(!plain&&S.sel&&S.sel.type==="node"){const k=order.findIndex(n=>n.id===S.sel.id);if(k>=0)order.push(order.splice(k,1)[0])}
  order.forEach(n=>{
    let cls="node";
    if(!plain){if(S.sel&&S.sel.type==="node"&&S.sel.id===n.id)cls+=" sel";if(S.src===n.id)cls+=" src";
      if(L){if(L.mode==="walk"){cls+=n.id===L.cur?" cur visited":L.next.has(n.id)?" next":L.visited.has(n.id)?" visited":" dim"}else if(!L.nodes.has(n.id))cls+=" dim"}}
    const noteDot=n.note&&n.note.trim()?`<circle class="note-dot" cx="${n.w-7}" cy="7" r="4"/>`:"";
    if(M.kind==="er"){
      let rows="";
      n.attrs.forEach((a,i)=>{const y=HEAD+4+i*ROW;
        rows+=`<g data-hit="attr:${n.id}:${i}"><rect class="row-hit" x="1" y="${y}" width="${n.w-2}" height="${ROW}"/>
        ${T("a-type",PADX,y+15,a.type,"type")}${T("a-name",PADX+n._tw+12,y+15,a.name,"name")}
        ${a.keys.length?`<text class="a-key" x="${n.w-PADX}" y="${y+15}" text-anchor="end">${a.keys.map(k=>`<tspan class="k-${k}">${k}</tspan>`).join(" ")}</text>`:""}</g>`});
      out+=`<g class="${cls}" transform="translate(${n.x},${n.y})"><rect class="ent-box" data-hit="node:${n.id}" width="${n.w}" height="${n.h}" rx="8"/>
        <path class="ent-head" data-hit="title:${n.id}" d="M0 8a8 8 0 0 1 8-8H${n.w-8}a8 8 0 0 1 8 8V${HEAD}H0Z"/><line class="ent-rule" x1="0" x2="${n.w}" y1="${HEAD}" y2="${HEAD}"/>
        ${T("ent-title",PADX,21,n.key,"title")}${noteDot}${rows}</g>`;
    }else{
      const w=n.w,h=n.h;let shape;
      if(n.shape==="diamond")shape=`<path class="fn-shape diamond" data-hit="node:${n.id}" d="M${w/2} 0L${w} ${h/2}L${w/2} ${h}L0 ${h/2}Z"/>`;
      else if(n.shape==="circle")shape=`<circle class="fn-shape circle" data-hit="node:${n.id}" cx="${w/2}" cy="${h/2}" r="${w/2}"/>`;
      else{const rx=n.shape==="stadium"?h/2:n.shape==="round"?14:5;shape=`<rect class="fn-shape ${n.shape}" data-hit="node:${n.id}" width="${w}" height="${h}" rx="${rx}"/>`+(n.shape==="sub"?`<path class="fn-sub" d="M9 0V${h}M${w-9} 0V${h}"/>`:"")}
      const y0=h/2-(n.lines.length*LH)/2+12.5;
      const txt=n.lines.map((l,i)=>T("fn-text",w/2,y0+i*LH,l,"node","middle")).join("");
      out+=`<g class="${cls}" transform="translate(${n.x},${n.y})">${shape}${txt}${noteDot}</g>`;
    }
  });
  return out+labs;
}
const GRID=`<rect x="-20000" y="-20000" width="40000" height="40000" fill="url(#dots)" data-hit="bg"/>`;
function viewing(){return M.kind==="view"||S.mview}
function draw(){if(viewing()){drawMermaid();return}world.innerHTML=GRID+renderInner(false);applyView()}
/* ---- Mermaid library: renders every diagram type ---- */
let mmdP=null,rid=0,MV=null,mvToken=0;
function loadMermaid(){
  if(window.mermaid&&typeof window.mermaid.render==="function")return Promise.resolve(window.mermaid);if(mmdP)return mmdP;
  mmdP=new Promise((res,rej)=>{const sc=document.createElement("script");sc.src=MERMAID_URL;
    sc.onload=()=>window.mermaid?res(window.mermaid):rej(new Error("load"));sc.onerror=()=>{mmdP=null;rej(new Error("load"))};document.head.appendChild(sc)});
  return mmdP}
function isDark(){const d=document.documentElement.dataset.theme;return d==="dark"||(d!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)}
async function mermaidSVG(src,dark){
  const m=await loadMermaid();
  m.initialize({startOnLoad:false,suppressErrorRendering:true,theme:dark?"dark":"default",securityLevel:"strict",htmlLabels:false,flowchart:{htmlLabels:false},fontFamily:SYS,themeVariables:{fontFamily:SYS}});
  const {svg:text}=await m.render("mmd-"+(++rid),src);
  const doc=new DOMParser().parseFromString(text,"image/svg+xml");const root=doc.documentElement;
  if(root.nodeName!=="svg")throw new Error("Mermaid returned no drawing");
  let vb=(root.getAttribute("viewBox")||"").split(/[\s,]+/).map(Number);
  if(vb.length!==4||vb.some(isNaN))vb=[0,0,parseFloat(root.getAttribute("width"))||800,parseFloat(root.getAttribute("height"))||600];
  root.setAttribute("width",vb[2]);root.setAttribute("height",vb[3]);root.style.removeProperty("max-width");root.removeAttribute("style");
  return {root,vb,w:vb[2],h:vb[3]};
}
function mermaidError(e){const msg=String((e&&(e.message||e.str))||e||"").split("\n").slice(0,4).join(" ").slice(0,300);return msg}
async function drawMermaid(){
  const tok=++mvToken;const src=toMermaid();
  if(!MV||MV.src!==src||MV.dark!==isDark())world.innerHTML=GRID;
  try{
    const r=await mermaidSVG(src,isDark());if(tok!==mvToken)return;
    world.innerHTML=GRID+`<g id="mview"></g>`;world.querySelector("#mview").appendChild(document.importNode(r.root,true));
    const first=!MV||MV.src!==src;MV={src,dark:isDark(),w:r.w,h:r.h,err:null};applyView();if(first&&!drag)fit();
  }catch(e){document.querySelectorAll('[id^="dmmd-"],body>svg[id^="mmd-"]').forEach(x=>x.remove());if(tok!==mvToken)return;
    MV={src,dark:isDark(),w:0,h:0,err:/load/.test(String(e&&e.message))?"The Mermaid library couldn't load. Check your connection and try again.":"Mermaid couldn't draw this: "+mermaidError(e)};
    world.innerHTML=GRID;applyView();
  }
  inspector();
}
function applyView(){world.setAttribute("transform",`translate(${V.tx},${V.ty}) scale(${V.k})`);$("zoomval").textContent=Math.round(V.k*100)+"%"}
function toWorld(ev){const r=svg.getBoundingClientRect();return {x:(ev.clientX-r.left-V.tx)/V.k,y:(ev.clientY-r.top-V.ty)/V.k}}
function zoomAt(k,px,py){k=Math.min(2.5,Math.max(.2,k));V.tx=px-(px-V.tx)*(k/V.k);V.ty=py-(py-V.ty)*(k/V.k);V.k=k;applyView()}
function bbox(){if(viewing())return MV&&MV.w?{x0:0,y0:0,x1:MV.w,y1:MV.h}:{x0:0,y0:0,x1:400,y1:300};if(M.kind==="seq")return seqBBox();M.nodes.forEach(measure);let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  M.nodes.forEach(n=>{x0=Math.min(x0,n.x);y0=Math.min(y0,n.y);x1=Math.max(x1,n.x+n.w);y1=Math.max(y1,n.y+n.h)});
  M.edges.forEach(e=>{if(!byId(e.a)||!byId(e.b))return;const H=geom(e).H;x0=Math.min(x0,H.x-60);x1=Math.max(x1,H.x+60);y0=Math.min(y0,H.y-14);y1=Math.max(y1,H.y+14)});
  return {x0,y0,x1,y1}}
function fit(all){
  if(!viewing()&&!M.nodes.length){V.tx=40;V.ty=40;V.k=1;applyView();return}
  const b=bbox(),r=svg.getBoundingClientRect(),pad=30;
  const k=Math.min(1.15,Math.max(.2,Math.min((r.width-pad*2)/(b.x1-b.x0),(r.height-pad*2-30)/(b.y1-b.y0))));
  if(all!==true&&k<0.55){/* too small to read: show the top of the diagram at a readable size instead */
    const kw=Math.min(0.9,Math.max(0.55,(r.width-pad*2)/(b.x1-b.x0)));V.k=kw;
    V.tx=(b.x1-b.x0)*kw<r.width?(r.width-(b.x1-b.x0)*kw)/2-b.x0*kw:pad-b.x0*kw;V.ty=pad-b.y0*kw;applyView();return}
  V.k=k;V.tx=(r.width-(b.x1-b.x0)*k)/2-b.x0*k;V.ty=(r.height-30-(b.y1-b.y0)*k)/2-b.y0*k;applyView();
}
let anim=0;
function centerOn(n){
  const r=svg.getBoundingClientRect(),c=ctr(n);
  const tx=r.width/2-c.x*V.k,ty=r.height*0.45-c.y*V.k;
  if(matchMedia("(prefers-reduced-motion: reduce)").matches){V.tx=tx;V.ty=ty;applyView();return}
  const sx=V.tx,sy=V.ty,t0=performance.now();cancelAnimationFrame(anim);
  const step=t=>{const p=Math.min(1,(t-t0)/280),e=1-Math.pow(1-p,3);V.tx=sx+(tx-sx)*e;V.ty=sy+(ty-sy)*e;applyView();if(p<1)anim=requestAnimationFrame(step)};
  anim=requestAnimationFrame(step);
}

/* ================= layouts ================= */
function layered(){
  const N=M.nodes,n=N.length;if(!n)return;N.forEach(measure);
  const idx=new Map(N.map((v,i)=>[v.id,i]));
  const out=N.map(()=>[]);M.edges.forEach(e=>{const a=idx.get(e.a),b=idx.get(e.b);if(a!==undefined&&b!==undefined&&a!==b)out[a].push(b)});
  const state=new Array(n).fill(0),back=new Set();
  const dfs=v=>{state[v]=1;out[v].forEach(w=>{if(state[w]===1)back.add(v+">"+w);else if(!state[w])dfs(w)});state[v]=2};
  const indeg=new Array(n).fill(0);out.forEach((l)=>l.forEach(w=>indeg[w]++));
  N.forEach((_,i)=>{if(!state[i]&&!indeg[i])dfs(i)});N.forEach((_,i)=>{if(!state[i])dfs(i)});
  const fwd=N.map(()=>[]);out.forEach((l,v)=>l.forEach(w=>{if(!back.has(v+">"+w))fwd[v].push(w)}));
  const rank=new Array(n).fill(0),ind=new Array(n).fill(0);fwd.forEach(l=>l.forEach(w=>ind[w]++));
  const q=[];ind.forEach((d,i)=>{if(!d)q.push(i)});
  while(q.length){const v=q.shift();fwd[v].forEach(w=>{rank[w]=Math.max(rank[w],rank[v]+1);if(--ind[w]===0)q.push(w)})}
  const layers=[];rank.forEach((r,i)=>{(layers[r]=layers[r]||[]).push(i)});
  const pos=new Array(n).fill(0);
  const rev=N.map(()=>[]);fwd.forEach((l,v)=>l.forEach(w=>rev[w].push(v)));
  for(let s=0;s<6;s++){
    const down=s%2===0;const seqL=down?layers.map((_,i)=>i):layers.map((_,i)=>layers.length-1-i);
    seqL.forEach(li=>{const L=layers[li];if(!L)return;L.forEach((v,j)=>{pos[v]=j});
      const nb=v=>(down?rev[v]:fwd[v]);
      L.sort((a,b)=>{const ba=nb(a).length?nb(a).reduce((s,u)=>s+pos[u],0)/nb(a).length:pos[a],bb=nb(b).length?nb(b).reduce((s,u)=>s+pos[u],0)/nb(b).length:pos[b];return ba-bb});
      L.forEach((v,j)=>{pos[v]=j})});
  }
  const horiz=M.dir==="LR"||M.dir==="RL";let along=40;
  layers.forEach(L=>{if(!L)return;
    const thick=Math.max(...L.map(v=>horiz?N[v].w:N[v].h));
    const total=L.reduce((s,v)=>s+(horiz?N[v].h:N[v].w),0)+(L.length-1)*(horiz?36:50);
    let across=-total/2;
    L.forEach(v=>{const nd=N[v];
      if(horiz){nd.x=along+(thick-nd.w)/2;nd.y=across;across+=nd.h+36}else{nd.y=along+(thick-nd.h)/2;nd.x=across;across+=nd.w+50}});
    along+=thick+(horiz?90:70)});
  let mx=1e9,my=1e9;N.forEach(v=>{mx=Math.min(mx,v.x);my=Math.min(my,v.y)});
  N.forEach(v=>{v.x=Math.round((v.x-mx+60)/10)*10;v.y=Math.round((v.y-my+60)/10)*10});
  M.edges.forEach(e=>{e.bend=null});
  M.edges.forEach(e=>{const a=byId(e.a),b=byId(e.b);if(!a||!b||a===b)return;
    if(back.has(idx.get(e.a)+">"+idx.get(e.b))){const ca=ctr(a),cb=ctr(b);const off=horiz?{dx:0,dy:Math.max(a.h,b.h)/2+60}:{dx:Math.max(a.w,b.w)/2+70,dy:0};
      e.bend=Math.abs(horiz?ca.x-cb.x:ca.y-cb.y)>0?off:null}});
}
function force(){
  const N=M.nodes,n=N.length,idx=new Map(N.map((e,i)=>[e.id,i]));N.forEach(measure);
  const P=N.map((e,i)=>({x:Math.cos(i*2.4)*150*Math.sqrt(i+1),y:Math.sin(i*2.4)*150*Math.sqrt(i+1)}));const K=200;
  for(let it=0;it<500;it++){
    const D=P.map(()=>({x:0,y:0}));
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){let dx=P[i].x-P[j].x,dy=P[i].y-P[j].y,d=Math.max(1,Math.hypot(dx,dy));const f=K*K/d;D[i].x+=dx/d*f;D[i].y+=dy/d*f;D[j].x-=dx/d*f;D[j].y-=dy/d*f}
    M.edges.forEach(r=>{const i=idx.get(r.a),j=idx.get(r.b);if(i===j||i===undefined||j===undefined)return;let dx=P[i].x-P[j].x,dy=P[i].y-P[j].y,d=Math.max(1,Math.hypot(dx,dy));const f=d*d/K;D[i].x-=dx/d*f;D[i].y-=dy/d*f;D[j].x+=dx/d*f;D[j].y+=dy/d*f});
    const T=80*(1-it/500)+1;P.forEach((p,i)=>{const d=Math.hypot(D[i].x,D[i].y)||1;p.x+=D[i].x/d*Math.min(d,T);p.y+=D[i].y/d*Math.min(d,T)});
  }
  for(let pass=0;pass<80;pass++){let moved=false;
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const a=N[i],b=N[j],gap=50;
      const ox=(a.w+b.w)/2+gap-Math.abs(P[i].x-P[j].x),oy=(a.h+b.h)/2+gap-Math.abs(P[i].y-P[j].y);
      if(ox>0&&oy>0){moved=true;if(ox<oy){const s=P[i].x<P[j].x?-1:1;P[i].x+=s*ox/2;P[j].x-=s*ox/2}else{const s=P[i].y<P[j].y?-1:1;P[i].y+=s*oy/2;P[j].y-=s*oy/2}}}
    if(!moved)break}
  let mx=1e9,my=1e9;N.forEach((e,i)=>{mx=Math.min(mx,P[i].x-e.w/2);my=Math.min(my,P[i].y-e.h/2)});
  N.forEach((e,i)=>{e.x=Math.round((P[i].x-e.w/2-mx+60)/10)*10;e.y=Math.round((P[i].y-e.h/2-my+60)/10)*10});
  M.edges.forEach(r=>r.bend=null);
}
function tidy(){mutate(()=>{if(M.kind==="flow")layered();else force()});fit()}

/* ================= pointer interaction ================= */
let drag=null,last=null;
svg.addEventListener("pointerdown",ev=>{
  if(ev.button>0)return;closeMenu();
  if(!inline.hidden)commitInline();
  const hitEl=ev.target.closest("[data-hit]");const key=hitEl?hitEl.dataset.hit:"bg";
  const now=performance.now();
  const dbl=last&&last.key===key&&now-last.t<420&&Math.hypot(ev.clientX-last.x,ev.clientY-last.y)<8;
  last=dbl?null:{key,t:now,x:ev.clientX,y:ev.clientY};
  const [kind,a,b]=key.split(":");const w=toWorld(ev);
  if(viewing()){svg.setPointerCapture(ev.pointerId);drag={mode:"pan",sx:ev.clientX,sy:ev.clientY,tx:V.tx,ty:V.ty};svg.classList.add("panning");return}
  if(READONLY){svg.setPointerCapture(ev.pointerId);
    if(W.on){if(M.kind==="seq"&&(kind==="rel"||kind==="end")){walkTo(+a);return}
      if(M.kind==="flow"&&kind==="node"){const cur=W.trail[W.trail.length-1];const ei=M.edges.findIndex(e=>e.a===cur&&e.b===a);if(ei>=0){walkStep(ei);return}}}
    else{S.sel=(kind==="node"||kind==="title"||kind==="attr")?{type:"node",id:a}:(kind==="rel"||kind==="label"||kind==="end")?{type:"edge",i:+a}:null;draw();inspector()}
    drag={mode:"pan",sx:ev.clientX,sy:ev.clientY,tx:V.tx,ty:V.ty};svg.classList.add("panning");return}
  if(M.kind==="seq"){if(dbl&&!W.on){ev.preventDefault();seqDouble(kind,a,b,w);return}seqDown(ev,kind,a,b,w);return}
  if(dbl&&!W.on){ev.preventDefault();onDouble(kind,a,b,w);return}
  svg.setPointerCapture(ev.pointerId);
  if(kind==="node"||kind==="title"||kind==="attr"){
    const n=byId(a);
    if(W.on){const cur=W.trail[W.trail.length-1];const ei=M.edges.findIndex(e=>e.a===cur&&e.b===a);if(ei>=0){walkStep(ei);return}}
    if(S.connect){connectClick(n);return}
    if(!(S.sel&&S.sel.type==="node"&&S.sel.id===a)){S.sel={type:"node",id:a};draw();if(!W.on)inspector()}
    drag={mode:"node",n,ox:w.x-n.x,oy:w.y-n.y,snap:snapshot(),moved:false};
  }else if(kind==="label"||kind==="rel"){
    const i=+a;if(W.on&&M.edges[i].a===W.trail[W.trail.length-1]){walkStep(i);return}
    if(!(S.sel&&S.sel.type==="edge"&&S.sel.i===i)){S.sel={type:"edge",i};draw();if(!W.on)inspector()}
    drag=kind==="label"?{mode:"bend",r:M.edges[i],snap:snapshot(),moved:false}:null;
  }else{
    if(S.connect)setConnect(false);
    if(S.sel){S.sel=null;draw();if(!W.on)inspector()}
    drag={mode:"pan",sx:ev.clientX,sy:ev.clientY,tx:V.tx,ty:V.ty};svg.classList.add("panning");
  }
});
svg.addEventListener("pointermove",ev=>{
  if(!drag)return;const w=toWorld(ev);
  if(drag.mode&&drag.mode.startsWith("seq")){seqMove(w);return}
  if(drag.mode==="node"){let x=w.x-drag.ox,y=w.y-drag.oy;if(S.snap){x=Math.round(x/10)*10;y=Math.round(y/10)*10}
    if(x!==drag.n.x||y!==drag.n.y){drag.n.x=x;drag.n.y=y;drag.moved=true;draw()}}
  else if(drag.mode==="bend"){const m=relMid(drag.r);drag.r.bend={dx:w.x-m.x,dy:w.y-m.y};drag.moved=true;draw()}
  else if(drag.mode==="pan"){V.tx=drag.tx+ev.clientX-drag.sx;V.ty=drag.ty+ev.clientY-drag.sy;applyView()}
});
function endDrag(){if(drag&&drag.moved){pushHistory(drag.snap);syncCode();save();if(S.sel&&!W.on)inspector()}drag=null;svg.classList.remove("panning")}
svg.addEventListener("pointerup",endDrag);svg.addEventListener("pointercancel",endDrag);
svg.addEventListener("wheel",ev=>{ev.preventDefault();const r=svg.getBoundingClientRect();zoomAt(V.k*Math.exp(-ev.deltaY*0.0015),ev.clientX-r.left,ev.clientY-r.top)},{passive:false});

function renameER(n,v){const k=cleanName(v);if(k&&k!==n.key)mutate(()=>{n.key=uniqueKey(k,n.id)})}
function onDouble(kind,a,b,w){
  if(kind==="title"||(kind==="node"&&M.kind==="er")){const n=byId(a);edit(`title:${a}`,n.key,v=>renameER(n,v))}
  else if(kind==="node"){const n=byId(a);edit(`node:${a}`,n.text,v=>{if(v.trim()&&v.trim()!==n.text)mutate(()=>{n.text=v.trim()})})}
  else if(kind==="attr"){const n=byId(a),at=n.attrs[+b];
    edit(`attr:${a}:${b}`,`${at.type} ${at.name}${at.keys.length?" "+at.keys.join(","):""}`,v=>{
      const t=v.trim().split(/\s+/);if(!t[0])return;
      mutate(()=>{at.type=t[0];at.name=t[1]||at.name;at.keys=t.slice(2).join(",").toUpperCase().split(",").map(s=>s.trim()).filter(k=>["PK","FK","UK"].includes(k))})})}
  else if(kind==="label"||kind==="rel"){const r=M.edges[+a];edit(r.label?`label:${a}`:`rel:${a}`,r.label||"",v=>mutate(()=>{r.label=v.trim()||(M.kind==="er"?"has":"")}),w)}
  else if(kind==="bg")addNode(w);
}
function edit(key,value,commit,at){
  const el=world.querySelector(`[data-hit="${key}"]`);const c=stage.getBoundingClientRect();
  let r=el?el.getBoundingClientRect():null;
  if(!r||key.startsWith("rel:")){const p=at||{x:0,y:0};r={left:c.left+p.x*V.k+V.tx-80,top:c.top+p.y*V.k+V.ty-15,width:160,height:30}}
  inline.style.left=Math.max(4,Math.min(c.width-180,r.left-c.left))+"px";inline.style.top=Math.max(4,r.top-c.top+(Math.min(r.height,60)-30)/2)+"px";
  inline.style.width=Math.min(c.width-8,Math.max(Math.min(r.width,320),170))+"px";
  inline.value=value;inline.hidden=false;inline._commit=commit;
  requestAnimationFrame(()=>{inline.focus();inline.select()});
}
function commitInline(){if(inline.hidden)return;const f=inline._commit;inline.hidden=true;inline._commit=null;if(f)f(inline.value)}
inline.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();commitInline()}if(e.key==="Escape"){inline.hidden=true;inline._commit=null}});
inline.addEventListener("blur",()=>setTimeout(commitInline,0));

/* ================= actions ================= */
function addNode(at){
  if(W.on)walkStop();
  if(M.kind==="seq")return seqAddPart();
  const r=svg.getBoundingClientRect();
  const p=at||{x:(r.width/2-V.tx)/V.k-60,y:(r.height/2-V.ty)/V.k-30};
  let n;
  if(M.kind==="er")n={id:nid(),key:uniqueKey("NEW_TABLE"),text:"",shape:"rect",attrs:[{type:"uuid",name:"id",keys:["PK"],comment:""}],note:"",x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10};
  else{let i=1;while(byKey("step"+i))i++;n={id:nid(),key:"step"+i,text:"New step",shape:"rect",attrs:[],note:"",x:Math.round(p.x/10)*10,y:Math.round(p.y/10)*10}}
  mutate(()=>{M.nodes.push(n);S.sel={type:"node",id:n.id}});
  if(M.kind==="er")edit(`title:${n.id}`,n.key,v=>renameER(n,v));else edit(`node:${n.id}`,n.text,v=>{if(v.trim())mutate(()=>{n.text=v.trim()})});
}
function setConnect(on,src){S.connect=on;S.src=on&&src?src:null;$("t-connect").setAttribute("aria-pressed",on);svg.classList.toggle("connecting",on);
  if(on&&W.on)walkStop();
  const h=$("hint");h.classList.toggle("on",on);h.textContent=on?(S.src?`Now click the box to connect "${nodeLabel(byId(S.src))}" to`:"Click the first box"):"";draw()}
function connectClick(n){
  if(!S.src){setConnect(true,n.id);return}
  const a=S.src;const e=M.kind==="er"?{a,b:n.id,ka:"one",kb:"zeroMany",ident:true,label:"has",bend:null}:{a,b:n.id,label:"",style:"solid",arrow:true,bend:null};
  mutate(()=>{M.edges.push(e);S.sel={type:"edge",i:M.edges.length-1}});setConnect(false);
}
function deleteSelection(){
  if(!S.sel)return;
  if(S.sel.type==="node"){const id=S.sel.id;mutate(()=>{M.nodes=M.nodes.filter(e=>e.id!==id);M.edges=M.edges.filter(r=>r.a!==id&&r.b!==id);S.sel=null})}
  else{const i=S.sel.i;mutate(()=>{M.edges.splice(i,1);S.sel=null})}
}

/* ================= walkthrough ================= */
function startNodes(){const inc=new Set(M.edges.filter(e=>e.a!==e.b).map(e=>e.b));const s=M.nodes.filter(n=>!inc.has(n.id));return s.length?s:M.nodes.slice(0,1)}
function walkStart(id){W.on=true;W.trail=[id];W.etrail=[];S.sel=null;S.focus=false;$("t-focus").setAttribute("aria-pressed",false);if(S.connect)setConnect(false);
  $("t-walk").setAttribute("aria-pressed",true);tab("inspect");draw();inspector();
  if(V.k<0.9){const r=svg.getBoundingClientRect();zoomAt(0.95,r.width/2,r.height/2)}centerOn(byId(id))}
function walkStep(i){const e=M.edges[i];W.trail.push(e.b);W.etrail.push(i);draw();inspector();centerOn(byId(e.b))}
function walkBack(){if(W.trail.length>1){W.trail.pop();W.etrail.pop();draw();inspector();centerOn(byId(W.trail[W.trail.length-1]))}}
function walkStop(){W.on=false;W.trail=[];W.etrail=[];$("t-walk").setAttribute("aria-pressed",false);draw();inspector()}

/* ================= sequence diagrams ================= */
const SEQ_ARROWS={"->>":"Solid arrow","-->>":"Dashed arrow (reply)","->":"Solid line, no head","-->":"Dashed line, no head","-x":"Solid with cross","--x":"Dashed with cross","-)":"Solid async","--)":"Dashed async"};
const SEQ_BLOCK=/^(loop|alt|else|opt|par|and|critical|option|break|rect|end|box|activate|deactivate|create|destroy|links?|properties|details)\b/i;
function parseSeq(src){
  const parts=new Map(),items=[],meta={layout:{},bends:[],notes:{}};let auto=false,title="",unsupported=null;const errors=[];
  const ensure=(k,type,label)=>{if(!parts.has(k))parts.set(k,{key:k,text:label||k,shape:type||"participant"});else{const p=parts.get(k);if(type)p.shape=type;if(label)p.text=label}return k};
  src.split(/\r?\n/).forEach((raw,i)=>{
    const t=raw.trim().replace(/;\s*$/,"");if(!t)return;
    if(t.startsWith("%%")){parseMeta(t,meta);return}
    if(/^sequenceDiagram\b/.test(t))return;
    if(/^autonumber\b/.test(t)){auto=true;return}
    let m=t.match(/^title\s*:?\s*(.*)$/i);if(m){title=m[1].trim();return}
    m=t.match(/^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/);if(m){ensure(m[2],m[1],m[3]&&m[3].trim());return}
    m=t.match(/^note\s+(left of|right of|over)\s+([^\s,:]+)(?:\s*,\s*([^\s:]+))?\s*:\s*(.*)$/i);
    if(m){ensure(m[2]);if(m[3])ensure(m[3]);items.push({t:"note",pos:m[1].toLowerCase(),a:m[2],b:m[3]||null,label:m[4].replace(/<br\s*\/?>/gi," ")});return}
    m=t.match(/^([^\s:<>+\-]+?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*([+-]?)\s*([^\s:<>+\-]+?)\s*:\s*(.*)$/);
    if(m){ensure(m[1]);ensure(m[4]);items.push({t:"msg",a:m[1],b:m[4],arrow:m[2],act:m[3],label:m[5]});return}
    if(SEQ_BLOCK.test(t)){if(!unsupported)unsupported={word:t.split(/\s+/)[0].toLowerCase(),line:i+1};return}
    errors.push(i+1);
  });
  return {parts:[...parts.values()],items,auto,title,meta,errors,unsupported};
}
function seqToMermaid(){
  const k=id=>byId(id).key;const L=["sequenceDiagram"];if(M.title)L.push(`    title ${M.title}`);if(M.auto)L.push("    autonumber");
  M.nodes.forEach(n=>L.push(`    ${n.shape==="actor"?"actor":"participant"} ${n.key}${n.text&&n.text!==n.key?` as ${n.text}`:""}`));
  M.edges.forEach(e=>{if(!byId(e.a)||(e.b&&!byId(e.b)))return;
    if(e.t==="note")L.push(`    Note ${e.pos} ${k(e.a)}${e.b&&e.pos==="over"?","+k(e.b):""}: ${e.label}`);
    else L.push(`    ${k(e.a)}${e.arrow}${e.act||""}${k(e.b)}: ${e.label}`)});
  const notes=M.nodes.filter(n=>n.note&&n.note.trim());
  if(notes.length){L.push("%% Notes saved by Untangle. Mermaid ignores these lines.");notes.forEach(n=>L.push(`%% note: ${n.key} ${n.note.trim().replace(/\n/g,"\\n")}`))}
  return L.join("\n");
}
function noteBox(e,cx){const xa=cx.get(e.a);let x0,x1;const tl=Math.min(240,tw(e.label,"lbl")+28);
  if(e.pos==="over"){if(e.b&&cx.has(e.b)){const xb=cx.get(e.b);x0=Math.min(xa,xb)-50;x1=Math.max(xa,xb)+50;if(x1-x0<tl){const c=(x0+x1)/2;x0=c-tl/2;x1=c+tl/2}}else{const h=Math.max(60,tl/2);x0=xa-h;x1=xa+h}}
  else if(e.pos==="left of"){x1=xa-14;x0=x1-Math.max(100,tl)}else{x0=xa+14;x1=x0+Math.max(100,tl)}
  return {x0,x1}}
function seqLayout(){
  const N=M.nodes;N.forEach(n=>{n.w=Math.ceil(Math.max(96,tw(n.text,"node")+30));n.h=n.shape==="actor"?66:42});
  const head=N.length?Math.max(42,...N.map(n=>n.h)):42;
  const idx=new Map(N.map((n,i)=>[n.id,i]));
  const gaps=N.map((n,i)=>i<N.length-1?Math.max(150,(n.w+N[i+1].w)/2+50):0);
  M.edges.forEach(e=>{if(e.t!=="msg")return;const i=idx.get(e.a),j=idx.get(e.b);if(i===undefined||j===undefined)return;
    const need=tw(e.label,"lbl")+(M.auto?56:40);
    if(i===j){if(i<N.length-1)gaps[i]=Math.max(gaps[i],need+40)}else if(Math.abs(i-j)===1){const g=Math.min(i,j);gaps[g]=Math.max(gaps[g],need)}});
  let x=60+(N[0]?N[0].w/2:0);const cx=new Map();N.forEach((n,i)=>{cx.set(n.id,x);n.x=x-n.w/2;n.y=head-n.h;x+=gaps[i]});
  let y=head+30;const rows=[];
  M.edges.forEach(e=>{if(!cx.has(e.a)){rows.push({y,h:0});return}
    if(e.t==="note"){e._nb=noteBox(e,cx);e._lines=wrapText(e.label,e._nb.x1-e._nb.x0-22);const h=e._lines.length*16+16;rows.push({y:y+4,h});y+=h+20}
    else{const h=e.a===e.b?60:46;rows.push({y:y+h-14,h});y+=h}});
  M._seq={cx,rows,head,bottom:y+26};
}
function crossAt(p,u){const c={x:p.x+u.x*7,y:p.y+u.y*7};return `<path class="mk" d="M${c.x-5} ${c.y-5}L${c.x+5} ${c.y+5}M${c.x-5} ${c.y+5}L${c.x+5} ${c.y-5}"/>`}
function openHead(p,u){const n={x:-u.y,y:u.x},b={x:p.x+u.x*10,y:p.y+u.y*10};return `<path class="mk" d="M${b.x+n.x*6} ${b.y+n.y*6}L${p.x} ${p.y}L${b.x-n.x*6} ${b.y-n.y*6}"/>`}
function renderSeq(plain){
  seqLayout();const {cx,rows,head,bottom}=M._seq;const L=plain?null:litSets();let out="",heads="";
  M.nodes.forEach(n=>{const x=cx.get(n.id);let cls="node";
    if(!plain){if(S.sel&&S.sel.type==="node"&&S.sel.id===n.id)cls+=" sel";if(S.src===n.id)cls+=" src";if(L&&!L.nodes.has(n.id))cls+=" dim"}
    out+=`<line class="lifeline${cls.includes(" dim")?" dim":""}" x1="${x}" x2="${x}" y1="${head}" y2="${bottom}"/>`;
    const noteDot=n.note&&n.note.trim()?`<circle class="note-dot" cx="${n.w-7}" cy="${n.shape==="actor"?7:7}" r="4"/>`:"";
    const shape=n.shape==="actor"
      ?`<rect class="row-hit" data-hit="node:${n.id}" width="${n.w}" height="${n.h}"/><g transform="translate(${n.w/2},3)"><circle class="actor-s" cx="0" cy="8" r="8"/><path class="actor-s" d="M0 16V32M-12 22H12M0 32L-10 44M0 32L10 44"/></g>${T("fn-text",n.w/2,n.h-5,n.text,"node","middle")}`
      :`<rect class="fn-shape" data-hit="node:${n.id}" width="${n.w}" height="${n.h}" rx="6"/>${T("fn-text",n.w/2,n.h/2+4.5,n.text,"node","middle")}`;
    heads+=`<g class="${cls}" transform="translate(${n.x},${n.y})">${shape}${noteDot}</g>`});
  let num=0;
  M.edges.forEach((e,i)=>{
    if(!cx.has(e.a)||(e.b&&!cx.has(e.b)))return;
    const r=rows[i];let cls="edge";
    if(!plain){if(S.sel&&S.sel.type==="edge"&&S.sel.i===i)cls+=" sel";
      if(L){if(L.mode==="seqwalk")cls+=i<L.si?" walked":i===L.si?" walked cur":" dim";else if(!L.edges.has(i))cls+=" dim"}}
    if(e.t==="note"){const nb=e._nb;
      out+=`<g class="${cls}"><rect class="note-box" data-hit="rel:${i}" x="${nb.x0}" y="${r.y}" width="${nb.x1-nb.x0}" height="${r.h}" rx="4"/>${e._lines.map((l,k)=>T("note-t",(nb.x0+nb.x1)/2,r.y+19+k*16,l,"lbl","middle")).join("")}</g>`;return}
    num++;const xa=cx.get(e.a),xb=cx.get(e.b),y=r.y;const dashed=e.arrow.startsWith("--");const hd=e.arrow.replace(/^--?/,"");
    let path,tip,u;const self=e.a===e.b;
    if(self){path=`M${xa} ${y-16}H${xa+44}V${y+6}H${xa+(hd===">>"?10:0)}`;tip={x:xa,y:y+6};u={x:1,y:0}}
    else{const dir=xb>xa?1:-1;path=`M${xa} ${y}H${xb-dir*(hd===">>"?10:0)}`;tip={x:xb,y};u={x:-dir,y:0}}
    const marks=hd===">>"?arrowHead(tip,u):hd==="x"?crossAt(tip,u):hd===")"?openHead(tip,u):"";
    const tx=self?xa+52:(xa+xb)/2,ty=self?y-21:y-8;
    const ny=self?y-16:y;
    const numB=M.auto?`<g class="seqnum"><circle cx="${xa}" cy="${ny}" r="9"/><text x="${xa}" y="${ny+3.5}" text-anchor="middle">${num}</text></g>`:"";
    const lw=tw(e.label,"lbl");
    const hit=self?`<rect class="row-hit" data-hit="rel:${i}" x="${xa}" y="${y-34}" width="${Math.max(70,lw+64)}" height="48"/>`
      :`<rect class="row-hit" data-hit="rel:${i}" x="${Math.min(xa,xb)}" y="${y-26}" width="${Math.max(20,Math.abs(xb-xa))}" height="36"/>`;
    const ends=plain||self?"":`<circle class="end-knob" data-hit="end:${i}:a" cx="${xa}" cy="${y}" r="7"/><circle class="end-knob" data-hit="end:${i}:b" cx="${xb}" cy="${y}" r="7"/>`;
    out+=`<g class="${cls}${dashed?" dashed":""}">${plain?"":hit}<path class="edge-line" d="${path}"/>${marks}${T("lbl-seq",tx,ty,e.label,"lbl",self?"start":"middle")}${numB}${ends}</g>`;
  });
  return out+heads;
}
function seqBBox(){seqLayout();const {cx,bottom}=M._seq;let x0=1e9,x1=-1e9;
  M.nodes.forEach(n=>{x0=Math.min(x0,n.x);x1=Math.max(x1,n.x+n.w)});
  M.edges.forEach(e=>{if(!cx.has(e.a))return;if(e.t==="note"&&e._nb){x0=Math.min(x0,e._nb.x0);x1=Math.max(x1,e._nb.x1)}else if(e.a===e.b){x1=Math.max(x1,cx.get(e.a)+60+tw(e.label,"lbl"))}});
  if(x0>x1){x0=0;x1=300}return {x0,y0:0,x1,y1:bottom}}
function nearestLifeline(x,max){let best=null,d=max||1e9;M.nodes.forEach(n=>{const dd=Math.abs(M._seq.cx.get(n.id)-x);if(dd<d){d=dd;best=n}});return best}
function seqDown(ev,kind,a,b,w){
  svg.setPointerCapture(ev.pointerId);
  if(W.on){if(kind==="rel"||kind==="end")walkTo(+a);else drag={mode:"pan",sx:ev.clientX,sy:ev.clientY,tx:V.tx,ty:V.ty};return}
  if(S.connect&&(kind==="node"||kind==="bg"||kind==="rel")){const n=kind==="node"?byId(a):nearestLifeline(w.x,40);if(n){seqConnect(n);return}}
  if(kind==="node"){if(!(S.sel&&S.sel.type==="node"&&S.sel.id===a)){S.sel={type:"node",id:a};draw();inspector()}
    drag={mode:"seqcol",n:byId(a),snap:snapshot(),moved:false};return}
  if(kind==="end"){const i=+a;if(!(S.sel&&S.sel.type==="edge"&&S.sel.i===i)){S.sel={type:"edge",i};draw();inspector()}drag={mode:"seqend",i,end:b,snap:snapshot(),moved:false};return}
  if(kind==="rel"){const i=+a;if(!(S.sel&&S.sel.type==="edge"&&S.sel.i===i)){S.sel={type:"edge",i};draw();inspector()}drag={mode:"seqrow",i,snap:snapshot(),moved:false};return}
  if(S.connect)setConnect(false);
  if(S.sel){S.sel=null;draw();inspector()}
  drag={mode:"pan",sx:ev.clientX,sy:ev.clientY,tx:V.tx,ty:V.ty};svg.classList.add("panning");
}
function seqMove(w){
  if(drag.mode==="seqcol"){const others=M.nodes.filter(x=>x!==drag.n);const k=others.filter(x=>M._seq.cx.get(x.id)<w.x).length;const cur=M.nodes.indexOf(drag.n);
    if(k!==cur){M.nodes.splice(cur,1);M.nodes.splice(k,0,drag.n);drag.moved=true;draw()}}
  else if(drag.mode==="seqrow"){const ys=M._seq.rows.map(r=>r.y);const it=M.edges[drag.i];const k=M.edges.map((_,j)=>j).filter(j=>j!==drag.i&&ys[j]<w.y).length;
    if(k!==drag.i){M.edges.splice(drag.i,1);M.edges.splice(k,0,it);drag.i=k;S.sel={type:"edge",i:k};drag.moved=true;draw()}}
  else if(drag.mode==="seqend"){const n=nearestLifeline(w.x);const e=M.edges[drag.i];if(n&&e[drag.end]!==n.id){e[drag.end]=n.id;drag.moved=true;draw()}}
}
function seqDouble(kind,a,b,w){
  if(kind==="node"){const n=byId(a);edit(`node:${a}`,n.text,v=>{if(v.trim()&&v.trim()!==n.text)mutate(()=>{n.text=v.trim()})})}
  else if(kind==="rel"||kind==="end"){const e=M.edges[+a];edit(`rel:${a}`,e.label,v=>{if(v.trim()!==e.label)mutate(()=>{e.label=v.trim()||"…"})},w)}
  else if(kind==="bg")seqAddPart();
}
function seqAddPart(){
  let i=1;while(byKey("P"+i))i++;const n={id:nid(),key:"P"+i,text:"New participant",shape:"participant",attrs:[],note:"",x:0,y:0};
  mutate(()=>{M.nodes.push(n);S.sel={type:"node",id:n.id}});
  edit(`node:${n.id}`,n.text,v=>{if(v.trim())mutate(()=>{n.text=v.trim()})});
}
function seqInsertAt(){return S.sel&&S.sel.type==="edge"?S.sel.i+1:M.edges.length}
function seqConnect(n){
  if(!S.src){setConnect(true,n.id);return}
  const at=seqInsertAt();const e={t:"msg",a:S.src,b:n.id,label:"New message",arrow:"->>",act:"",pos:"",bend:null};
  mutate(()=>{M.edges.splice(at,0,e);S.sel={type:"edge",i:at}});setConnect(false);
  edit(`rel:${at}`,e.label,v=>{if(v.trim())mutate(()=>{e.label=v.trim()})},{x:(M._seq.cx.get(e.a)+M._seq.cx.get(e.b))/2,y:M._seq.rows[at].y-8});
}
function seqWalkStart(){if(!M.edges.length){toast("Add a message first");return}W.on=true;W.si=0;S.sel=null;S.focus=false;$("t-focus").setAttribute("aria-pressed",false);if(S.connect)setConnect(false);
  $("t-walk").setAttribute("aria-pressed",true);tab("inspect");draw();inspector();if(V.k<0.8){const r=svg.getBoundingClientRect();zoomAt(0.95,r.width/2,r.height/2)}seqCenter()}
function walkTo(i){W.si=Math.max(0,Math.min(M.edges.length-1,i));draw();inspector();seqCenter()}
function seqCenter(){const e=M.edges[W.si];if(!e)return;const {cx,rows}=M._seq;const x=e.t==="note"?(e._nb.x0+e._nb.x1)/2:(cx.get(e.a)+cx.get(e.b))/2;centerOn({x,y:rows[W.si].y,w:0,h:0})}
function seqWalkPanel(){
  const e=M.edges[W.si],n=M.edges.length;const A=byId(e.a),B=e.b?byId(e.b):null;
  pane.innerHTML=`<p class="eyebrow">Walkthrough · step ${W.si+1} of ${n}</p>
    <div class="card-sm">${e.t==="note"?`<span>Note ${esc(e.pos)}</span><b>${esc(A.text)}</b>${B?`<span>and</span><b>${esc(B.text)}</b>`:""}`:`<b>${esc(A.text)}</b><span>→</span><b>${esc(B.text)}</b>`}</div>
    <p class="walk-now">${esc(e.label)}</p>
    ${e.t==="msg"&&B&&B.note&&B.note.trim()?`<div class="note-box">${esc(B.note)}</div>`:""}
    <div class="btns"><button class="btn" id="w-back"${W.si>0?"":" disabled"}>Back</button><button class="btn primary" id="w-next"${W.si<n-1?"":" disabled"}>Next</button><button class="btn" id="w-restart">Restart</button><button class="btn" id="w-exit">Exit</button></div>
    <p class="eyebrow">All steps</p>
    <div class="choices">${M.edges.map((x,i)=>`<button class="choice" data-i="${i}"${i===W.si?' style="border-color:var(--accent);background:var(--accent-soft)"':""}><kbd>${i+1}</kbd><span><b>${esc(x.label)}</b><small>${x.t==="note"?"Note":`${esc(byId(x.a).text)} → ${esc(byId(x.b).text)}`}</small></span></button>`).join("")}</div>
    <p class="msg" style="color:var(--muted)">Tip: use the arrow keys to step, or click any message on the canvas.</p>`;
  $("w-back").onclick=()=>walkTo(W.si-1);$("w-next").onclick=()=>walkTo(W.si+1);$("w-restart").onclick=()=>walkTo(0);$("w-exit").onclick=walkStop;
  pane.querySelectorAll(".choice").forEach(b=>b.onclick=()=>walkTo(+b.dataset.i));
}
function seqInspector(){
  const optP=(sel,blank)=>(blank?`<option value="">(none)</option>`:"")+M.nodes.map(n=>`<option value="${n.id}"${n.id===sel?" selected":""}>${esc(n.text)}</option>`).join("");
  if(!S.sel){
    const msgs=M.edges.filter(e=>e.t==="msg").length;
    pane.innerHTML=`<p class="eyebrow">Sequence diagram</p><h2>${esc(M.title||"Untitled sequence")}</h2>
      <div class="stats"><div class="stat"><b>${M.nodes.length}</b><span>Participants</span></div><div class="stat"><b>${msgs}</b><span>Messages</span></div></div>
      ${field("i-title","Title",M.title||"")}
      <label class="check"><input type="checkbox" id="i-auto"${M.auto?" checked":""}> Number the messages</label>
      <p class="eyebrow">What you can do</p>
      <ul class="tips">
        <li><b>Drag a participant</b> sideways to reorder the columns.</li>
        <li><b>Drag a message</b> up or down to change the order.</li>
        <li><b>Drag a message's end dot</b> onto another lifeline to change who sends or receives it.</li>
        <li><b>Double-click</b> any text to edit it, or empty space to add a participant.</li>
        <li><b>Connect</b>: click two participants (or their lifelines) to add a message.</li>
        <li><b>Walkthrough</b> plays the messages one at a time.</li>
      </ul>`;
    live($("i-title"),v=>{M.title=v.trim()});$("i-auto").onchange=e=>mutate(()=>{M.auto=e.target.checked});return}
  if(S.sel.type==="node"){const n=byId(S.sel.id);
    pane.innerHTML=`<p class="eyebrow">Participant · id <code>${esc(n.key)}</code></p>${field("i-text","Name",n.text)}
      <div class="field"><label for="i-type">Drawn as</label><select class="in" id="i-type"><option value="participant"${n.shape!=="actor"?" selected":""}>Box (system)</option><option value="actor"${n.shape==="actor"?" selected":""}>Stick figure (person)</option></select></div>
      ${field("i-note","Notes (shown in Walkthrough)",n.note,true)}
      <div class="btns"><button class="btn" id="i-conn">Message from here</button><button class="btn" id="i-addnote">Add note</button><button class="btn danger" id="i-del">Delete participant</button></div>`;
    live($("i-text"),v=>{n.text=v.trim()||n.key});live($("i-note"),v=>{n.note=v});
    $("i-type").onchange=e=>mutate(()=>{n.shape=e.target.value});
    $("i-conn").onclick=()=>setConnect(true,n.id);
    $("i-addnote").onclick=()=>{const at=M.edges.length;mutate(()=>{M.edges.push({t:"note",pos:"right of",a:n.id,b:null,label:"Note",act:"",arrow:"",bend:null});S.sel={type:"edge",i:at}})};
    $("i-del").onclick=deleteSelection;return}
  const i=S.sel.i,e=M.edges[i];
  const moves=`<button class="btn" id="i-up"${i>0?"":" disabled"}>Move up</button><button class="btn" id="i-down"${i<M.edges.length-1?"":" disabled"}>Move down</button>`;
  if(e.t==="note"){
    pane.innerHTML=`<p class="eyebrow">Note</p>${field("i-label","Text",e.label,true)}
      <div class="field"><label for="i-pos">Position</label><select class="in" id="i-pos">${["left of","right of","over"].map(p=>`<option${p===e.pos?" selected":""}>${p}</option>`).join("")}</select></div>
      <div class="field"><label for="i-a">Participant</label><select class="in" id="i-a">${optP(e.a)}</select></div>
      ${e.pos==="over"?`<div class="field"><label for="i-b">Stretch over to</label><select class="in" id="i-b">${optP(e.b,true)}</select></div>`:""}
      <div class="btns">${moves}<button class="btn danger" id="i-del">Delete note</button></div>`;
    $("i-pos").onchange=x=>mutate(()=>{e.pos=x.target.value;if(e.pos!=="over")e.b=null});
    $("i-a").onchange=x=>mutate(()=>{e.a=x.target.value});if($("i-b"))$("i-b").onchange=x=>mutate(()=>{e.b=x.target.value||null});
  }else{
    pane.innerHTML=`<p class="eyebrow">Message ${i+1}</p>${field("i-label","Text",e.label)}
      <div class="field"><label for="i-a">From</label><select class="in" id="i-a">${optP(e.a)}</select></div>
      <div class="field"><label for="i-b">To</label><select class="in" id="i-b">${optP(e.b)}</select></div>
      <div class="field"><label for="i-arrow">Arrow</label><select class="in" id="i-arrow">${Object.entries(SEQ_ARROWS).map(([k,l])=>`<option value="${k}"${k===e.arrow?" selected":""}>${l} (${k})</option>`).join("")}</select></div>
      <div class="field"><label for="i-act">Activation</label><select class="in" id="i-act"><option value=""${!e.act?" selected":""}>None</option><option value="+"${e.act==="+"?" selected":""}>Start activation on receiver (+)</option><option value="-"${e.act==="-"?" selected":""}>End activation (-)</option></select></div>
      <div class="btns">${moves}<button class="btn" id="i-below">Add message below</button><button class="btn" id="i-swap">Reverse</button></div>
      <div class="btns"><button class="btn danger" id="i-del">Delete message</button></div>`;
    $("i-a").onchange=x=>mutate(()=>{e.a=x.target.value});$("i-b").onchange=x=>mutate(()=>{e.b=x.target.value});
    $("i-arrow").onchange=x=>mutate(()=>{e.arrow=x.target.value});$("i-act").onchange=x=>mutate(()=>{e.act=x.target.value});
    $("i-swap").onclick=()=>mutate(()=>{[e.a,e.b]=[e.b,e.a]});
    $("i-below").onclick=()=>mutate(()=>{M.edges.splice(i+1,0,{t:"msg",a:e.b,b:e.a,label:"Reply",arrow:"-->>",act:"",pos:"",bend:null});S.sel={type:"edge",i:i+1}});
  }
  live($("i-label"),v=>{e.label=v.replace(/\n/g," ")});
  $("i-up").onclick=()=>mutate(()=>{M.edges.splice(i-1,0,M.edges.splice(i,1)[0]);S.sel={type:"edge",i:i-1}});
  $("i-down").onclick=()=>mutate(()=>{M.edges.splice(i+1,0,M.edges.splice(i,1)[0]);S.sel={type:"edge",i:i+1}});
  $("i-del").onclick=deleteSelection;
}

/* ================= toolbar ================= */
$("t-add").onclick=()=>addNode();
$("t-connect").onclick=()=>setConnect(!S.connect);
$("t-tidy").onclick=tidy;
$("t-undo").onclick=undo;
$("t-snap").onclick=()=>{S.snap=!S.snap;$("t-snap").setAttribute("aria-pressed",S.snap)};
$("t-focus").onclick=()=>{S.focus=!S.focus;$("t-focus").setAttribute("aria-pressed",S.focus);if(S.focus&&W.on)walkStop();if(S.focus&&!S.sel)toast("Select a box to see what it's connected to");draw()};
$("t-walk").onclick=()=>{if(M.kind==="seq"){if(W.on)walkStop();else seqWalkStart();return}if(M.kind!=="flow")return;if(W.on)walkStop();else{const s=startNodes();walkStart(s[0].id)}};
$("t-fit").onclick=()=>fit(true);
$("t-zin").onclick=()=>{const r=svg.getBoundingClientRect();zoomAt(V.k*1.2,r.width/2,r.height/2)};
$("t-zout").onclick=()=>{const r=svg.getBoundingClientRect();zoomAt(V.k/1.2,r.width/2,r.height/2)};
document.addEventListener("keydown",e=>{
  const t=e.target;if(t.matches&&t.matches("input,textarea,select"))return;
  if(!$("xmodal").hidden||!$("smodal").hidden||!$("hmodal").hidden)return;
  if(READONLY&&(e.ctrlKey||e.metaKey))return;
  if(READONLY&&!W.on){if(e.key==="Escape"&&S.sel){S.sel=null;draw();inspector()}return}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();undo();return}
  if(W.on&&M.kind==="seq"){if(e.key==="ArrowRight"||e.key==="ArrowDown"||e.key===" "){e.preventDefault();walkTo(W.si+1)}if(e.key==="ArrowLeft"||e.key==="ArrowUp"||e.key==="Backspace"){e.preventDefault();walkTo(W.si-1)}if(e.key==="Escape")walkStop();return}
  if(W.on){if(/^[1-9]$/.test(e.key)){const cur=W.trail[W.trail.length-1];const outs=M.edges.map((x,i)=>[x,i]).filter(([x])=>x.a===cur);const o=outs[+e.key-1];if(o)walkStep(o[1])}
    if(e.key==="Backspace"){e.preventDefault();walkBack()}if(e.key==="Escape")walkStop();return}
  if(e.key==="Delete"||e.key==="Backspace"){if(S.sel){e.preventDefault();deleteSelection()}}
  if(e.key==="Escape"){closeMenu();if(S.connect)setConnect(false);else if(S.sel){S.sel=null;draw();inspector()}}
});
$("m-edit").onclick=()=>{if(M.kind==="view"||!S.mview)return;S.mview=false;kindUI();draw();inspector();fit()};
$("m-mmd").onclick=()=>{if(S.mview||M.kind==="view")return;if(W.on)walkStop();if(S.connect)setConnect(false);S.sel=null;S.mview=true;kindUI();MV=null;draw();inspector()};
function kindUI(){
  const er=M.kind==="er",view=M.kind==="view";if(view)S.mview=false;
  const seq=M.kind==="seq";
  $("kind-tag").textContent=view?`${typeName(M.type)} · view only`:er?"ER diagram":seq?"Sequence diagram":`Flowchart · ${M.dir}`;$("t-add-l").textContent=er?"Add table":seq?"Add participant":"Add step";
  const v=viewing();
  ["t-add","t-connect","t-tidy","t-focus","t-snap"].forEach(id=>{$(id).disabled=v});
  $("t-walk").disabled=er||v;if(seq){$("t-tidy").disabled=true;$("t-snap").disabled=true}$("t-walk").title=er?"Walkthrough works on flowcharts":"Step through the flow one choice at a time";
  $("t-undo").disabled=!history.length;
  if(READONLY)["t-add","t-connect","t-tidy","t-undo","t-snap"].forEach(id=>{$(id).hidden=true});
  $("m-edit").disabled=view;$("m-edit").setAttribute("aria-pressed",!v);$("m-mmd").setAttribute("aria-pressed",v);
  if(v){$("stage-note").textContent="Drawn by Mermaid · Drag to pan, scroll to zoom · Export as PNG or SVG";return}
  if(seq){$("stage-note").textContent="Drag participants sideways or messages up and down · Drag a message's end dot to another lifeline · Double-click to edit";return}
  $("stage-note").textContent=er?"Drag tables or line labels · Double-click text to edit · Double-click empty space to add a table":"Drag boxes or line handles · Double-click to edit · Try Walkthrough to step through the flow";
}

/* ================= inspector ================= */
const pane=$("pane-inspect");
function field(id,label,value,area){return `<div class="field"><label for="${id}">${label}</label>${area?`<textarea class="in" id="${id}" rows="3">${esc(value)}</textarea>`:`<input class="in" id="${id}" value="${esc(value)}" spellcheck="false">`}</div>`}
function live(el,apply){let snap=null;el.addEventListener("focus",()=>{snap=snapshot()});
  el.addEventListener("input",()=>{apply(el.value);draw();syncCode();save()});
  el.addEventListener("change",()=>{pushHistory(snap);snap=snapshot()})}
function inspector(){
  if(W.on)return M.kind==="seq"?seqWalkPanel():walkPanel();
  if(viewing()){
    const err=MV&&MV.err;
    pane.innerHTML=M.kind==="view"?`<p class="eyebrow">View only</p><h2>${esc(typeName(M.type))}</h2>
      ${err?`<p class="msg err">${esc(err)}</p>`:""}
      ${M.why?`<p class="msg err">${esc(M.why)}</p>`:""}
      <p>Mermaid draws this diagram type for us. You can pan, zoom and export it as a high-quality PNG or SVG.</p>
      <p>To change it, edit the code in the <b>Mermaid code</b> tab and press <b>Apply code</b>.</p>
      <p class="msg" style="color:var(--muted)">Drag-and-drop editing works for flowcharts, ER diagrams and sequence diagrams (without loop/alt blocks). Class diagrams are next.</p>`
     :`<p class="eyebrow">Mermaid view</p><h2>Mermaid's own drawing</h2>
      ${err?`<p class="msg err">${esc(err)}</p>`:""}
      <p>This is how GitHub, Notion and other Mermaid tools draw your current code. It ignores your layout, because plain Mermaid can't store one.</p>
      <div class="btns"><button class="btn primary" id="v-back">Back to editing</button></div>`;
    if($("v-back"))$("v-back").onclick=()=>$("m-edit").onclick();
    if(err&&/load/.test(err)){pane.insertAdjacentHTML("beforeend",`<div class="btns"><button class="btn primary" id="v-retry">Try again</button></div>`);$("v-retry").onclick=()=>{MV=null;draw()}}
    return}
  if(READONLY)return readonlyPanel();
  if(M.kind==="seq")return seqInspector();
  const er=M.kind==="er";
  if(!S.sel){
    pane.innerHTML=`<p class="eyebrow">${er?"ER diagram":"Flowchart"}</p><h2>${er?"Food delivery data model":"Your flowchart"}</h2>
      <div class="stats"><div class="stat"><b>${M.nodes.length}</b><span>${er?"Tables":"Steps"}</span></div><div class="stat"><b>${M.edges.length}</b><span>${er?"Relationships":"Connections"}</span></div></div>
      <p class="eyebrow">What you can do</p>
      <ul class="tips">
        <li><b>Drag</b> a box to move it. Drag a line's label or handle to bend it.</li>
        <li><b>Double-click</b> any text to edit it, or empty space to add a ${er?"table":"step"}.</li>
        <li><b>Click a box</b> to edit it here and add notes. A blue dot marks boxes with notes.</li>
        <li><b>Focus</b> fades everything not connected to the selected box.</li>
        ${er?"":`<li><b>Walkthrough</b> steps through the flow one choice at a time.</li>`}
        <li><b>Tidy</b> lays everything out automatically. <b>Ctrl+Z</b> undoes.</li>
        <li><b>Export</b> as PNG, SVG or Markdown, or copy the Mermaid.</li>
      </ul>`;
    return}
  if(S.sel.type==="node"){
    const n=byId(S.sel.id);
    if(er){
      pane.innerHTML=`<p class="eyebrow">Table</p>${field("i-name","Name",n.key)}
        <div class="field"><label>Columns (type, name, keys)</label><div style="display:flex;flex-direction:column;gap:6px">${
        n.attrs.map((a,i)=>`<div class="attr-row"><input class="in mono" id="i-t-${i}" value="${esc(a.type)}" aria-label="Column ${i+1} type"><input class="in" id="i-n-${i}" value="${esc(a.name)}" aria-label="Column ${i+1} name">
          <div class="keys">${["PK","FK","UK"].map(k=>`<button class="kbtn ${k}" data-i="${i}" data-k="${k}" aria-pressed="${a.keys.includes(k)}" title="${{PK:"Primary key",FK:"Foreign key",UK:"Unique"}[k]}">${k}</button>`).join("")}</div>
          <button class="x" data-del="${i}" aria-label="Delete column ${esc(a.name)}">×</button></div>`).join("")}</div></div>
        <div class="btns"><button class="btn" id="i-addcol">Add column</button></div>
        ${field("i-note","Notes",n.note,true)}
        <div class="btns"><button class="btn" id="i-conn">Connect from here</button><button class="btn danger" id="i-del">Delete table</button></div>`;
      live($("i-name"),v=>{const k=cleanName(v);if(k)n.key=uniqueKey(k,n.id)});
      n.attrs.forEach((a,i)=>{live($("i-t-"+i),v=>{a.type=v.trim()||a.type});live($("i-n-"+i),v=>{a.name=v.trim().replace(/\s+/g,"_")||a.name})});
      pane.querySelectorAll(".kbtn").forEach(b=>b.onclick=()=>{const a=n.attrs[+b.dataset.i],k=b.dataset.k;mutate(()=>{a.keys=a.keys.includes(k)?a.keys.filter(x=>x!==k):[...a.keys,k].sort((x,y)=>"PKFKUK".indexOf(x)-"PKFKUK".indexOf(y))})});
      pane.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>mutate(()=>{n.attrs.splice(+b.dataset.del,1)}));
      $("i-addcol").onclick=()=>{mutate(()=>{n.attrs.push({type:"string",name:"new_column",keys:[],comment:""})});const el=$("i-n-"+(n.attrs.length-1));if(el){el.focus();el.select()}};
    }else{
      pane.innerHTML=`<p class="eyebrow">Step · id <code>${esc(n.key)}</code></p>${field("i-text","Text",n.text,true)}
        <div class="field"><label for="i-shape">Shape</label><select class="in" id="i-shape">${Object.entries(SHAPES).map(([k,l])=>`<option value="${k}"${k===n.shape?" selected":""}>${l}</option>`).join("")}</select></div>
        ${field("i-note","Notes (shown in Walkthrough)",n.note,true)}
        <div class="btns"><button class="btn" id="i-walk">Walk from here</button><button class="btn" id="i-conn">Connect from here</button><button class="btn danger" id="i-del">Delete step</button></div>`;
      live($("i-text"),v=>{n.text=v.replace(/\n/g," ")});
      $("i-shape").onchange=e=>mutate(()=>{n.shape=e.target.value});
      $("i-walk").onclick=()=>walkStart(n.id);
    }
    live($("i-note"),v=>{n.note=v});
    $("i-conn").onclick=()=>setConnect(true,n.id);
    $("i-del").onclick=deleteSelection;
    return}
  const r=M.edges[S.sel.i],A=byId(r.a),B=byId(r.b);
  if(er){
    const sel=(id,v)=>`<select class="in" id="${id}">${Object.entries(KIND_LABEL).map(([k,l])=>`<option value="${k}"${k===v?" selected":""}>${l}</option>`).join("")}</select>`;
    pane.innerHTML=`<p class="eyebrow">Relationship</p><div class="card-sm"><b>${esc(A.key)}</b><span>→</span><b>${esc(B.key)}</b></div>
      ${field("i-label","Label",r.label||"")}
      <div class="field"><label for="i-ka">${esc(A.key)} end</label>${sel("i-ka",r.ka)}</div>
      <div class="field"><label for="i-kb">${esc(B.key)} end</label>${sel("i-kb",r.kb)}</div>
      <label class="check"><input type="checkbox" id="i-ident"${r.ident?" checked":""}> Identifying (solid line)</label>
      <div class="btns"><button class="btn" id="i-straight"${r.bend?"":" disabled"}>Straighten line</button><button class="btn" id="i-swap">Swap direction</button></div>
      <div class="btns"><button class="btn danger" id="i-del">Delete relationship</button></div>
      <p class="eyebrow">Mermaid: ${esc(LEFT_OUT[r.ka]+(r.ident?"--":"..")+RIGHT_OUT[r.kb])}</p>`;
    $("i-ka").onchange=e=>mutate(()=>{r.ka=e.target.value});$("i-kb").onchange=e=>mutate(()=>{r.kb=e.target.value});
    $("i-ident").onchange=e=>mutate(()=>{r.ident=e.target.checked});
  }else{
    pane.innerHTML=`<p class="eyebrow">Connection</p><div class="card-sm"><b>${esc(A.text)}</b><span>→</span><b>${esc(B.text)}</b></div>
      ${field("i-label","Label (shown as the choice in Walkthrough)",r.label||"")}
      <div class="field"><label for="i-style">Line</label><select class="in" id="i-style"><option value="solid"${r.style==="solid"?" selected":""}>Solid</option><option value="thick"${r.style==="thick"?" selected":""}>Thick</option><option value="dotted"${r.style==="dotted"?" selected":""}>Dotted</option></select></div>
      <label class="check"><input type="checkbox" id="i-arrow"${r.arrow?" checked":""}> Arrowhead</label>
      <div class="btns"><button class="btn" id="i-straight"${r.bend?"":" disabled"}>Straighten line</button><button class="btn" id="i-swap">Swap direction</button></div>
      <div class="btns"><button class="btn danger" id="i-del">Delete connection</button></div>
      <p class="eyebrow">Mermaid: ${esc(OPS[r.style][r.arrow?0:1])}</p>`;
    $("i-style").onchange=e=>mutate(()=>{r.style=e.target.value});$("i-arrow").onchange=e=>mutate(()=>{r.arrow=e.target.checked});
  }
  live($("i-label"),v=>{r.label=v});
  $("i-straight").onclick=()=>mutate(()=>{r.bend=null});
  $("i-swap").onclick=()=>mutate(()=>{[r.a,r.b]=[r.b,r.a];if(M.kind==="er")[r.ka,r.kb]=[r.kb,r.ka]});
  $("i-del").onclick=deleteSelection;
}
function readonlyPanel(){
  const kindName={er:"ER diagram",flow:"Flowchart",seq:"Sequence diagram"}[M.kind]||"Diagram";let sel="";
  if(S.sel&&S.sel.type==="node"){const n=byId(S.sel.id);if(n)sel=`<p class="eyebrow">${M.kind==="er"?"Table":M.kind==="seq"?"Participant":"Step"}</p><h2>${esc(nodeLabel(n))}</h2>`+
    (M.kind==="er"&&n.attrs.length?`<div class="card-sm" style="flex-direction:column;align-items:flex-start;gap:2px">${n.attrs.map(a=>`<span>${esc(a.type)} <b>${esc(a.name)}</b> ${esc(a.keys.join(" "))}</span>`).join("")}</div>`:"")+
    (n.note&&n.note.trim()?`<div class="note-box">${esc(n.note)}</div>`:"")}
  else if(S.sel&&S.sel.type==="edge"){const e=M.edges[S.sel.i];if(e){const A=byId(e.a),B=e.b?byId(e.b):null;
    sel=`<p class="eyebrow">${M.kind==="seq"?(e.t==="note"?"Note":"Message"):M.kind==="er"?"Relationship":"Connection"}</p><h2>${esc(e.label||"(no label)")}</h2>`+(A&&B?`<div class="card-sm"><b>${esc(nodeLabel(A))}</b><span>→</span><b>${esc(nodeLabel(B))}</b></div>`:"")}}
  pane.innerHTML=(sel||`<p class="eyebrow">${kindName} · view only</p><h2>${esc(DOC_TITLE)}</h2>`)+`<p class="eyebrow">What you can do</p><ul class="tips"><li>Drag to pan and scroll to zoom.</li><li>Click a box or line to see its details${M.kind==="er"?"":" and notes"}.</li>${M.kind==="er"?"":"<li><b>Walkthrough</b> steps through it one stage at a time.</li>"}<li><b>Focus</b> fades everything not connected to what you select.</li><li><b>Export</b> saves a PNG, SVG or the Mermaid code.</li></ul>`;
}
function walkPanel(){
  const cur=byId(W.trail[W.trail.length-1]);const outs=M.edges.map((e,i)=>[e,i]).filter(([e])=>e.a===cur.id);
  const starts=startNodes();
  pane.innerHTML=`<p class="eyebrow">Walkthrough · step ${W.trail.length}</p>
    <p class="walk-now">${esc(cur.text)}</p>
    ${cur.note&&cur.note.trim()?`<div class="note-box">${esc(cur.note)}</div>`:""}
    ${outs.length?`<p class="eyebrow">${outs.length>1?"Choose a path":"Next"}</p><div class="choices">${outs.map(([e,i],k)=>`<button class="choice" data-e="${i}">${k<9?`<kbd>${k+1}</kbd>`:""}<span><b>${esc(e.label||byId(e.b).text)}</b>${e.label?`<small>→ ${esc(byId(e.b).text)}</small>`:""}</span></button>`).join("")}</div>`
      :`<div class="note-box">End of this path.</div>`}
    <div class="btns"><button class="btn" id="w-back"${W.trail.length>1?"":" disabled"}>Back</button><button class="btn" id="w-restart">Restart</button><button class="btn" id="w-exit">Exit walkthrough</button></div>
    ${starts.length>1?`<div class="field"><label for="w-start">Start from</label><select class="in" id="w-start">${starts.map(s=>`<option value="${s.id}"${s.id===W.trail[0]?" selected":""}>${esc(s.text)}</option>`).join("")}</select></div>`:""}
    <p class="eyebrow">Path so far</p><div class="trail">${W.trail.map(id=>`<span>${esc(byId(id).text)}</span>`).join("→")}</div>
    <p class="msg" style="color:var(--muted)">Tip: press 1–9 to choose, Backspace to go back. You can also click the dashed boxes on the canvas.</p>`;
  pane.querySelectorAll(".choice").forEach(b=>b.onclick=()=>walkStep(+b.dataset.e));
  $("w-back").onclick=walkBack;$("w-restart").onclick=()=>walkStart(W.trail[0]);$("w-exit").onclick=walkStop;
  if($("w-start"))$("w-start").onchange=e=>walkStart(e.target.value);
}

/* ================= code tab, samples ================= */
const code=$("code");let codeDirty=false;
function syncCode(){if(!codeDirty)code.value=toMermaid()}
code.addEventListener("input",()=>{codeDirty=true;$("c-msg").textContent=""});
function applySource(src,keep){
  const {model,errors}=build(src,keep);const m=$("c-msg");
  if(!model||(model.kind!=="view"&&!model.nodes.length)){m.className="msg err";m.textContent=errors[0]||"Nothing to draw. Check that the code starts with erDiagram or flowchart.";tab("code");return false}
  const snap=snapshot();const kindChanged=model.kind!==M.kind;
  if(W.on)walkStop();M=model;S.sel=null;S.mview=false;MV=null;pushHistory(snap);codeDirty=false;kindUI();changed();
  if(errors.length){m.className="msg err";m.textContent=`Loaded, but skipped line${errors.length>1?"s":""} ${errors.join(", ")} that couldn't be read.`}
  else if(M.kind==="view"){m.className="msg ok";m.textContent=`Opened a ${typeName(M.type).toLowerCase()}. It's view only${M.why?" because "+M.why.charAt(0).toLowerCase()+M.why.slice(1):" for now: pan, zoom and export it."}`}
  else{m.className="msg ok";m.textContent=M.kind==="seq"?`Loaded ${M.nodes.length} participants and ${M.edges.length} messages.`:`Loaded ${M.nodes.length} ${M.kind==="er"?"tables":"steps"} and ${M.edges.length} connections.`}
  if(kindChanged||!keep)fit();
  return true;
}
$("c-apply").onclick=()=>applySource(code.value,true);
$("c-copy").onclick=()=>copyCode();
function copyCode(){
  const text=toMermaid();
  const fb=()=>{tab("code");codeDirty=false;syncCode();code.focus();code.select();toast("Press Ctrl+C (or Cmd+C) to copy")};
  try{navigator.clipboard.writeText(text).then(()=>toast("Mermaid code copied"),fb)}catch(e){fb()}
}
function tab(which){const ins=which==="inspect";$("tab-inspect").setAttribute("aria-selected",ins);$("tab-code").setAttribute("aria-selected",!ins);$("pane-inspect").hidden=!ins;$("pane-code").hidden=ins;if(!ins)syncCode()}
$("tab-inspect").onclick=()=>tab("inspect");$("tab-code").onclick=()=>tab("code");

/* ================= export ================= */
function downloadFile(name,data,type){const blob=data instanceof Blob?data:new Blob([data],{type:type||"text/plain"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),4000)}
const menu=$("export-menu");
function closeMenu(){menu.hidden=true;$("t-export").setAttribute("aria-expanded",false)}
$("t-export").onclick=e=>{e.stopPropagation();const open=menu.hidden;menu.hidden=!open;$("t-export").setAttribute("aria-expanded",open);
  if(open){const b=$("t-export").getBoundingClientRect(),t=document.querySelector(".toolbar").getBoundingClientRect();menu.style.left=Math.max(6,Math.min(b.left-t.left,t.width-240))+"px";menu.querySelector("button").focus()}};
document.addEventListener("click",e=>{if(!menu.hidden&&!menu.contains(e.target)&&!$("t-export").contains(e.target))closeMenu()});
menu.querySelectorAll("button").forEach(b=>b.onclick=()=>{closeMenu();doExport(b.dataset.x)});
function fileBase(){return M.kind==="er"?"data-model":M.kind==="flow"?"flowchart":M.kind==="seq"?"sequence":(String(M.type||"diagram").replace(/[^\w-]/g,"").toLowerCase()||"diagram")}
const PALETTE={
  light:{"--panel":"#FFFFFF","--ink":"#18202E","--muted":"#5A6476","--line":"#D4D9E2","--canvas":"#FFFFFF","--head":"#E9EDF4","--edge":"#5F6980","--node-line":"#9AA3B5","--accent":"#2D55E0","--accent-soft":"#E2E8FC","--pk":"#A86A12","--fk":"#0E7F74","--uk":"#7C4FC4"},
  dark:{"--panel":"#151B25","--ink":"#E5E9F1","--muted":"#98A2B4","--line":"#2A3241","--canvas":"#111720","--head":"#1C2431","--edge":"#8D97AB","--node-line":"#566074","--accent":"#7D9BFF","--accent-soft":"#1F2846","--pk":"#E5AF4A","--fk":"#4CC6B6","--uk":"#B793F2"}};
const BG={light:"#FFFFFF",dark:"#111720"};
async function buildExport(bg){
  const dark=bg==="dark";
  if(viewing()){
    const r=await mermaidSVG(toMermaid(),dark);const [x,y,w,h]=r.vb;const root=r.root;
    root.setAttribute("xmlns","http://www.w3.org/2000/svg");
    if(bg!=="transparent"){const rect=root.ownerDocument.createElementNS("http://www.w3.org/2000/svg","rect");
      rect.setAttribute("x",x);rect.setAttribute("y",y);rect.setAttribute("width",w);rect.setAttribute("height",h);rect.setAttribute("fill",BG[bg]);root.insertBefore(rect,root.firstChild)}
    return {w:Math.ceil(w),h:Math.ceil(h),text:new XMLSerializer().serializeToString(root)};
  }
  const b=bbox(),pad=28,x=b.x0-pad,y=b.y0-pad,w=Math.ceil(b.x1-b.x0+pad*2),h=Math.ceil(b.y1-b.y0+pad*2);
  const vars=Object.entries(PALETTE[dark?"dark":"light"]).map(([k,v])=>`${k}:${v}`).join(";");
  EXPORTING=true;let inner;try{inner=renderInner(true)}finally{EXPORTING=false}
  const back=bg==="transparent"?"":`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${BG[bg]}"/>`;
  return {w,h,text:`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${x} ${y} ${w} ${h}"><style>svg{${vars}}${SVG_CSS}</style>${back}${inner}</svg>`};
}
const MAXSIDE=16000,MAXAREA=2.4e8;
function fitScale(s,scale){let k=scale;while(k>1&&(s.w*k>MAXSIDE||s.h*k>MAXSIDE||s.w*s.h*k*k>MAXAREA))k--;return k}
function toPNG(s,scale){return new Promise((res,rej)=>{const url=URL.createObjectURL(new Blob([s.text],{type:"image/svg+xml"}));const img=new Image();
  img.onload=()=>{try{const c=document.createElement("canvas");c.width=Math.round(s.w*scale);c.height=Math.round(s.h*scale);const x=c.getContext("2d");x.imageSmoothingQuality="high";x.drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);c.toBlob(b=>b?res(b):rej(new Error("png")),"image/png")}catch(e){URL.revokeObjectURL(url);rej(e)}};
  img.onerror=()=>{URL.revokeObjectURL(url);rej(new Error("img"))};img.src=url})}
const X={fmt:"png",scale:2,bg:"light",data:null,name:"",tok:0,url:null};
const kb=n=>n<1024*1024?`${Math.max(1,Math.round(n/1024))} KB`:`${(n/1048576).toFixed(1)} MB`;
function segSet(id,v){$(id).querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.v===String(v)))}
async function renderExport(){
  const tok=++X.tok;const info=$("x-info");info.className="msg";info.textContent="Drawing…";$("x-save").disabled=true;
  segSet("x-fmt",X.fmt);segSet("x-scale",X.scale);segSet("x-bg",X.bg);$("x-scale-row").hidden=X.fmt!=="png";
  $("x-save").textContent=X.fmt==="png"?"Save PNG":"Save SVG";$("x-copy").hidden=X.fmt!=="svg";
  try{
    const s=await buildExport(X.bg);if(tok!==X.tok)return;
    let blob,note="";
    if(X.fmt==="png"){const k=fitScale(s,X.scale);if(k<X.scale)note=` Reduced to ${k}× because the diagram is very large.`;
      blob=await toPNG(s,k);if(tok!==X.tok)return;X.data=blob;X.name=`${fileBase()}${k>1?`@${k}x`:""}.png`;
      info.textContent=`${Math.round(s.w*k).toLocaleString()} × ${Math.round(s.h*k).toLocaleString()} px · ${kb(blob.size)}.${note}`}
    else{blob=new Blob([s.text],{type:"image/svg+xml"});X.data=s.text;X.svgText=s.text;X.name=`${fileBase()}.svg`;
      info.textContent=`Vector image, sharp at any size · ${kb(blob.size)}. Text is sized to fit its boxes on any computer.`}
    if(X.url)URL.revokeObjectURL(X.url);X.url=URL.createObjectURL(blob);$("x-img").src=X.url;$("x-save").disabled=false;
  }catch(e){if(tok!==X.tok)return;info.className="msg err";
    info.textContent=X.fmt==="png"&&/secur|taint/i.test(String(e&&(e.name+e.message)))?"This diagram can't be turned into a PNG in the browser. Use SVG instead.":(viewing()&&MV&&MV.err?MV.err:"Couldn't draw the image. Try SVG, or a smaller size.")}
}
function openExport(){X.bg=isDark()?"dark":"light";$("xmodal").hidden=false;renderExport();$("x-close").focus()}
[["x-fmt","fmt"],["x-scale","scale"],["x-bg","bg"]].forEach(([id,key])=>$(id).querySelectorAll("button").forEach(b=>b.onclick=()=>{X[key]=key==="scale"?+b.dataset.v:b.dataset.v;renderExport()}));
$("x-close").onclick=()=>{$("xmodal").hidden=true};
$("xmodal").addEventListener("click",e=>{if(e.target===$("xmodal"))$("xmodal").hidden=true});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("xmodal").hidden)$("xmodal").hidden=true});
$("x-copy").onclick=()=>{const t=X.svgText||"";try{navigator.clipboard.writeText(t).then(()=>{$("x-info").className="msg ok";$("x-info").textContent="SVG code copied."},()=>{$("x-info").textContent="Copy isn't available here."})}catch(e){$("x-info").textContent="Copy isn't available here."}};
$("x-save").onclick=()=>{if(!X.data)return;downloadFile(X.name,X.data,X.fmt==="png"?"image/png":"image/svg+xml");const info=$("x-info");info.className="msg ok";info.textContent=`Downloaded ${X.name}.`};
async function doExport(kind){
  if(!viewing()&&!M.nodes.length){toast("Nothing to export yet");return}
  if(kind==="copy")return copyCode();
  if(kind==="md"){downloadFile(fileBase()+".md","```mermaid\n"+toMermaid()+"\n```\n","text/markdown");toast(`Downloaded ${fileBase()}.md`);return}
  openExport();
}

/* ================= app glue: loading, saving, sharing, history ================= */
let DOC=null,DOC_TITLE="Untitled diagram",lastSaved="",saveT=0,saving=false,again=false;
async function api(path,opts={}){
  const r=await fetch(path,{method:opts.method||"GET",credentials:"same-origin",headers:{"Content-Type":"application/json","X-Requested-With":"untangle"},body:opts.body?JSON.stringify(opts.body):undefined});
  let data={};try{data=await r.json()}catch(e){}
  if(r.status===401&&MODE==="edit"){location.href="/login?next="+encodeURIComponent(location.pathname);throw new Error("Please log in.")}
  if(!r.ok){const err=new Error(data.error||"Something went wrong. Please try again.");err.status=r.status;throw err}
  return data;
}
function setStatus(text,cls){const el=$("save-status");el.textContent=text;el.className="save-status"+(cls?" "+cls:"")}
function appSave(){
  if(MODE==="share"||!M)return;
  if(MODE==="demo"){store("untangle-demo",toMermaid());return}
  if(!DOC)return;
  clearTimeout(saveT);setStatus("Unsaved changes");saveT=setTimeout(()=>flush(false),900);
}
async function makeThumb(){try{const t=(await buildExport("light")).text;return t.length<380000?t:null}catch(e){return null}}
async function flush(checkpoint){
  if(MODE!=="edit"||!DOC)return;clearTimeout(saveT);
  if(saving){again=true;return}
  const src=toMermaid(),title=($("doc-title").value.trim()||"Untitled diagram").slice(0,120);
  if(src===lastSaved&&title===DOC.title&&!checkpoint){setStatus("Saved","ok");return}
  saving=true;setStatus("Saving…");
  const thumb=await makeThumb();
  try{const r=await api(`/api/diagrams/${DOC.id}`,{method:"PUT",body:{source:src,title,thumb,checkpoint:!!checkpoint}});
    DOC=r.diagram;DOC_TITLE=DOC.title;document.title=`${DOC.title} · Untangle`;lastSaved=src;setStatus("All changes saved","ok")}
  catch(e){setStatus(e.status===413?e.message:"Couldn't save. Retrying…","err");if(e.status!==413)saveT=setTimeout(()=>flush(false),5000)}
  finally{saving=false;if(again){again=false;flush(false)}}
}
window.addEventListener("beforeunload",e=>{if(MODE==="edit"&&DOC&&(toMermaid()!==lastSaved||saving)){flush(false);e.preventDefault();e.returnValue=""}});

/* ---- share dialog ---- */
function shareUrl(){return DOC&&DOC.shareToken?`${location.origin}/s/${DOC.shareToken}`:""}
function renderShare(){const on=!!(DOC&&DOC.shareToken);$("s-on").checked=on;$("s-link-row").hidden=!on;$("s-link").value=shareUrl();
  $("s-msg").className="msg";$("s-msg").textContent=on?"Anyone with this link can view, step through and export the diagram. They can't change it.":"Only you can see this diagram."}
async function openShare(){await flush(false);renderShare();$("smodal").hidden=false;$("s-on").focus()}
$("s-on").onchange=async e=>{const want=e.target.checked;try{const r=await api(`/api/diagrams/${DOC.id}/share`,{method:"POST",body:{enabled:want}});DOC.shareToken=r.shareToken;renderShare()}catch(err){e.target.checked=!want;$("s-msg").className="msg err";$("s-msg").textContent=err.message}};
$("s-copy").onclick=()=>{const t=shareUrl();try{navigator.clipboard.writeText(t).then(()=>{$("s-msg").className="msg ok";$("s-msg").textContent="Link copied."},()=>{$("s-link").select()})}catch(e){$("s-link").select()}};
$("s-close").onclick=()=>{$("smodal").hidden=true};

/* ---- history dialog ---- */
const when=t=>{const d=new Date(t),now=new Date();const same=d.toDateString()===now.toDateString();
  return (same?"Today":d.toLocaleDateString(undefined,{day:"numeric",month:"short",year:d.getFullYear()===now.getFullYear()?undefined:"numeric"}))+", "+d.toLocaleTimeString(undefined,{hour:"numeric",minute:"2-digit"})};
async function openHistory(){
  await flush(false);$("hmodal").hidden=false;const list=$("h-list");list.innerHTML=`<p class="msg">Loading…</p>`;
  try{const r=await api(`/api/diagrams/${DOC.id}/versions`);
    list.innerHTML=r.versions.length?r.versions.map((v,i)=>`<div class="hrow"><span><b>${esc(when(v.created_at))}</b><small>${i===0?"Latest version":(v.size/1024).toFixed(1)+" KB"}</small></span>${i===0?"":`<button class="btn" data-v="${v.id}">Restore</button>`}</div>`).join(""):`<p class="msg">No saved versions yet.</p>`;
    list.querySelectorAll("[data-v]").forEach(b=>b.onclick=async()=>{b.disabled=true;
      try{const v=await api(`/api/diagrams/${DOC.id}/versions/${b.dataset.v}`);await flush(true);applySource(v.version.source,true);await flush(true);$("hmodal").hidden=true;toast(`Restored the version from ${when(v.version.created_at)}. Undo brings back what you had.`)}
      catch(e){b.disabled=false;toast(e.message)}});
  }catch(e){list.innerHTML=`<p class="msg err">${esc(e.message)}</p>`}
}
$("h-close").onclick=()=>{$("hmodal").hidden=true};
["smodal","hmodal"].forEach(id=>$(id).addEventListener("click",e=>{if(e.target===$(id))$(id).hidden=true}));
document.addEventListener("keydown",e=>{if(e.key==="Escape"){$("smodal").hidden=true;$("hmodal").hidden=true}});

/* ---- boot ---- */
async function boot(){
  document.body.classList.add("mode-"+MODE);if(READONLY)document.body.classList.add("readonly");
  $("b-share").hidden=$("b-history").hidden=MODE!=="edit";$("doc-title").readOnly=MODE==="share";
  $("b-copy").hidden=MODE!=="share";$("b-signup").hidden=MODE!=="demo";$("demo-banner").hidden=MODE!=="demo";$("demo-tpl").hidden=MODE!=="demo";
  if(READONLY){$("c-apply").hidden=true;$("code").readOnly=true}
  $("logo").href=MODE==="edit"?"/app":"/";
  let src="",title="";
  try{
    if(MODE==="edit"){const r=await api(`/api/diagrams/${location.pathname.split("/")[2]}`);DOC=r.diagram;src=DOC.source;title=DOC.title;lastSaved=src;setStatus("All changes saved","ok")}
    else if(MODE==="share"){const r=await api(`/api/share/${location.pathname.split("/")[2]}`);src=r.diagram.source;title=r.diagram.title;$("owner").textContent=`Shared by ${r.diagram.owner}`}
    else{const T=window.UNTANGLE_TEMPLATES||[];const want=new URLSearchParams(location.search).get("t");const tpl=T.find(x=>x.id===want)||T[0];
      const saved=want?null:store("untangle-demo");src=saved&&detectKind(saved)?saved:tpl.source;title="Try Untangle";
      $("demo-tpl").innerHTML=`<option value="">Load a sample…</option>`+T.map(x=>`<option value="${x.id}">${esc(x.title)}</option>`).join("");
      $("demo-tpl").onchange=e=>{const x=T.find(y=>y.id===e.target.value);e.target.value="";if(x&&applySource(x.source,false))fit()}}
  }catch(e){
    $("stage").innerHTML=`<div class="empty"><h2>${MODE==="share"?"This link doesn't work":"Couldn't open this diagram"}</h2><p>${esc(e.message)}</p><a class="btn primary" href="${MODE==="edit"?"/app":"/"}">${MODE==="edit"?"Back to my diagrams":"Go to Untangle"}</a></div>`;
    $("save-status").textContent="";return}
  DOC_TITLE=title;$("doc-title").value=title;document.title=`${title} · Untangle`;
  let first=build(src,false);if(!first.model)first={model:{kind:"view",type:firstWord(src)||"unknown",src:src.trim(),dir:"TD",nodes:[],edges:[]}};
  M=first.model;$("t-undo").disabled=true;kindUI();draw();syncCode();inspector();fit();
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(()=>{if(!viewing())draw();fit()});
  if(MODE==="edit")setTimeout(async()=>{const thumb=await makeThumb();if(thumb)api(`/api/diagrams/${DOC.id}`,{method:"PUT",body:{thumb}}).catch(()=>{})},1500);
}
$("doc-title").addEventListener("input",()=>appSave());
$("doc-title").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.target.blur()}});
$("doc-title").addEventListener("change",()=>flush(false));
$("b-share").onclick=openShare;$("b-history").onclick=openHistory;
$("b-copy").onclick=async()=>{const tok=location.pathname.split("/")[2];
  try{const r=await api(`/api/share/${tok}/copy`,{method:"POST"});location.href=`/d/${r.diagram.id}`}
  catch(e){if(e.status===401)location.href=`/signup?next=${encodeURIComponent(location.pathname)}`;else toast(e.message)}};
window.addEventListener("resize",()=>applyView());
boot();
})();
