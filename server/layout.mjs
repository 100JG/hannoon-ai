/* Deterministic SVG renderer. Only escaped text and fixed geometry reach the image. */
const BLUE = '#2E49D3';
export const DIAGRAM_TYPES = ['flowchart','decision_tree','hierarchy','mindmap','timeline','cycle','comparison','architecture'];
export function escapeXML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function widthUnit(c) { return /[\u0000-\u00ff]/.test(c) ? .56 : 1; }
function wrap(text, columns=22) {
  const lines=[];
  for (const paragraph of String(text || '').split('\n')) {
    let line='', size=0;
    for (const c of paragraph) {
      const w=widthUnit(c);
      if (size+w>columns && line) { lines.push(line); line=''; size=0; }
      line+=c; size+=w;
    }
    if (line || !paragraph) lines.push(line);
  }
  return lines.length ? lines : [''];
}
function nodeHeight(node,w=240) {
  return 42+wrap(node.label,(w-36)/15).length*21+(node.detail ? 14+wrap(node.detail,(w-36)/12).length*17 : 0)+(node.order_label ? 10+wrap(node.order_label,(w-36)/11).length*16 : 0);
}
function text(lines,x,y,size,fill='#202943',weight=400) {
  return `<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${lines.map((line,i)=>`<tspan x="${x}" dy="${i ? size*1.42 : 0}">${escapeXML(line)}</tspan>`).join('')}</text>`;
}
function rankNodes(ir) {
  const ranks=new Map(ir.nodes.map(n=>[n.id,0]));
  const incoming=new Map(ir.nodes.map(n=>[n.id,0]));
  const adjacency=new Map(ir.nodes.map(n=>[n.id,[]]));
  for (const e of ir.edges) { incoming.set(e.target,incoming.get(e.target)+1); adjacency.get(e.source)?.push(e.target); }
  const queue=ir.nodes.filter(n=>!incoming.get(n.id)).map(n=>n.id), seen=new Set();
  for (let i=0;i<queue.length;i++) {
    const id=queue[i]; seen.add(id);
    for (const target of adjacency.get(id) || []) {
      ranks.set(target,Math.max(ranks.get(target),ranks.get(id)+1));
      incoming.set(target,incoming.get(target)-1);
      if (!incoming.get(target)) queue.push(target);
    }
  }
  // Loop members stay on a common row; edges alone express their direction.
  for (const n of ir.nodes) if (!seen.has(n.id)) ranks.set(n.id, Math.min(5,ranks.get(n.id)));
  return ranks;
}
function arrange(ir) {
  const positions=new Map(), top=112, gap=62, margin=90, w=248;
  if (ir.diagram_type==='cycle') {
    const cardH=Math.max(...ir.nodes.map(n=>nodeHeight(n,w))), radius=Math.max(235,(Math.hypot(w,cardH)+30)/(2*Math.sin(Math.PI/ir.nodes.length)));
    const cx=radius+w/2+80, cy=radius+cardH/2+top;
    const byId=new Map(ir.nodes.map(n=>[n.id,n])),next=new Map(ir.edges.map(e=>[e.source,e.target])),ordered=[],seen=new Set();let id=ir.nodes[0].id;
    while(byId.has(id)&&!seen.has(id)){seen.add(id);ordered.push(byId.get(id));id=next.get(id);}for(const n of ir.nodes)if(!seen.has(n.id))ordered.push(n);
    ordered.forEach((n,i)=>{const a=-Math.PI/2+i*2*Math.PI/ir.nodes.length; positions.set(n.id,{x:cx+Math.cos(a)*radius-w/2,y:cy+Math.sin(a)*radius-cardH/2,w,h:cardH,level:i});});
    return {positions,width:Math.ceil(cx*2),height:Math.ceil(cy+radius+cardH/2+70)};
  }
  if (ir.diagram_type==='timeline') {
    let y=top;
    for (const n of ir.nodes) {const h=nodeHeight(n,550); positions.set(n.id,{x:210,y,w:550,h,level:0}); y+=h+48;}
    return {positions,width:850,height:y+30,timeline:true};
  }
  if (ir.diagram_type==='comparison') {
    const cols=Math.min(3,ir.nodes.length), cardH=Math.max(...ir.nodes.map(n=>nodeHeight(n,w)));
    ir.nodes.forEach((n,i)=>positions.set(n.id,{x:margin+(i%cols)*(w+30),y:top+Math.floor(i/cols)*(cardH+40),w,h:cardH,level:Math.floor(i/cols)}));
    return {positions,width:margin*2+cols*w+(cols-1)*30,height:top+Math.ceil(ir.nodes.length/cols)*(cardH+40)+30};
  }
  if (ir.diagram_type==='architecture') {
    const groups=new Map(); for(const n of ir.nodes){const k=n.group||'';if(!groups.has(k))groups.set(k,[]);groups.get(k).push(n);}
    let y=top;const boxes=[];
    for(const [label,nodes] of groups){const cols=Math.min(3,nodes.length),h=Math.max(...nodes.map(n=>nodeHeight(n,w))),gy=y; y+=label?42:15;
      nodes.forEach((n,i)=>positions.set(n.id,{x:margin+25+(i%cols)*(w+30),y:y+Math.floor(i/cols)*(h+45),w,h,level:boxes.length}));
      y+=Math.ceil(nodes.length/cols)*(h+45); boxes.push({x:margin,y:gy,w:3*w+2*30+50,h:y-gy-15,label});y+=42;}
    return {positions,width:margin*2+3*w+2*30+50,height:y+20,boxes};
  }
  const ranks=rankNodes(ir),levels=new Map();
  for(const n of ir.nodes){const r=ranks.get(n.id);if(!levels.has(r))levels.set(r,[]);levels.get(r).push(n);}
  if(ir.diagram_type==='mindmap'){
    const columnHeights=new Map([...levels].map(([rank,nodes])=>[rank,nodes.reduce((sum,n)=>sum+nodeHeight(n,w)+36,0)]));
    const bodyHeight=Math.max(...columnHeights.values());
    for(const [rank,nodes] of levels){let y=top+(bodyHeight-columnHeights.get(rank))/2;for(const n of nodes){const h=nodeHeight(n,w);positions.set(n.id,{x:margin+rank*(w+90),y,w,h,level:rank});y+=h+36;}}
    return {positions,width:margin*2+(Math.max(...levels.keys())+1)*(w+90)-90,height:top+bodyHeight+40};
  }
  let y=top,maxCols=1;
  for(const rank of [...levels.keys()].sort((a,b)=>a-b)) {
    const nodes=levels.get(rank),cols=Math.min(4,nodes.length),h=Math.max(...nodes.map(n=>nodeHeight(n,w)));maxCols=Math.max(maxCols,cols);
    nodes.forEach((n,i)=>positions.set(n.id,{x:margin+(i%cols)*(w+38),y:y+Math.floor(i/cols)*(h+gap),w,h,level:rank}));
    y+=Math.ceil(nodes.length/cols)*(h+gap);
  }
  const width=margin*2+maxCols*w+(maxCols-1)*38;
  // Centre sparse tree levels, preserving source order within each level.
  for(const nodes of levels.values())if(nodes.length<=4){const shift=(width-(nodes.length*w+(nodes.length-1)*38))/2-margin;for(const n of nodes)positions.get(n.id).x+=shift;}
  return {positions,width,height:y+35};
}
export function renderDiagram(ir) {
  if (!ir || !DIAGRAM_TYPES.includes(ir.diagram_type) || !Array.isArray(ir.nodes) || !ir.nodes.length || ir.nodes.length>30 || ir.edges?.length>40) throw new Error('표현할 내용이 많습니다. 원문을 나누어 입력해 주세요.');
  const layout=arrange(ir),{positions,width}=layout;
  const titleLines=wrap(ir.title,(width-96)/22),extra=(titleLines.length-1)*32,height=layout.height+extra;
  if(extra){for(const p of positions.values())p.y+=extra;for(const box of layout.boxes||[])box.y+=extra;}
  const parts=[`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXML(ir.title)}"><title>${escapeXML(ir.title)}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10" fill="none" stroke="${BLUE}" stroke-width="1.4"/></marker></defs><rect width="100%" height="100%" fill="#F7F8FC"/><g font-family="Arial, Noto Sans KR, sans-serif">`,text(titleLines,48,48,22,'#202943',700),`<path d="M48 ${76+extra}H${width-48}" stroke="#D9DEED" stroke-width="1"/>`];
  for(const box of layout.boxes||[]){parts.push(`<rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="12" fill="#EDF0FF" stroke="#D6DCF6"/>`);if(box.label)parts.push(text([box.label],box.x+20,box.y+27,13,BLUE,600));}
  if(layout.timeline){const vals=[...positions.values()];parts.push(`<path d="M155 ${vals[0].y+25}V${vals.at(-1).y+25}" stroke="${BLUE}" stroke-width="2"/>`);for(const p of vals)parts.push(`<circle cx="155" cy="${p.y+25}" r="5" fill="${BLUE}"/><path d="M160 ${p.y+25}H${p.x}" stroke="#ADB9ED"/>`);}
  ir.edges.forEach((e,i)=>{
    const a=positions.get(e.source),b=positions.get(e.target);if(!a||!b)return;
    let path,lx,ly;
    if(ir.diagram_type==='mindmap'&&b.x>a.x){const x1=a.x+a.w,y1=a.y+a.h/2,x2=b.x,y2=b.y+b.h/2,mid=(x1+x2)/2;path=`M${x1} ${y1}H${mid}V${y2}H${x2}`;lx=mid;ly=(y1+y2)/2-8;
    }else if(ir.diagram_type==='cycle'){
      const ax=a.x+a.w/2,ay=a.y+a.h/2,bx=b.x+b.w/2,by=b.y+b.h/2,dx=bx-ax,dy=by-ay;
      const af=Math.min(a.w/2/Math.max(Math.abs(dx),.01),a.h/2/Math.max(Math.abs(dy),.01)),bf=Math.min(b.w/2/Math.max(Math.abs(dx),.01),b.h/2/Math.max(Math.abs(dy),.01));
      const x1=ax+dx*af,y1=ay+dy*af,x2=bx-dx*bf,y2=by-dy*bf;path=`M${x1} ${y1}L${x2} ${y2}`;lx=(x1+x2)/2;ly=(y1+y2)/2-9;
    }else if(b.y>=a.y+a.h && b.y-(a.y+a.h)<100){const x1=a.x+a.w/2,y1=a.y+a.h,x2=b.x+b.w/2,y2=b.y,mid=(y1+y2)/2;path=`M${x1} ${y1}V${mid}H${x2}V${y2}`;lx=(x1+x2)/2;ly=mid-9;
    }else {const right=(i%2)===0,lane=right?width-25-(i%8)*6:25+(i%8)*6,x1=right?a.x+a.w:a.x,x2=right?b.x+b.w:b.x,y1=a.y+a.h/2,y2=b.y+b.h/2;path=`M${x1} ${y1}H${lane}V${y2}H${x2}`;lx=lane+(right?-9:9);ly=(y1+y2)/2;}
    parts.push(`<path data-edge-id="${escapeXML(e.id)}" d="${path}" fill="none" stroke="${BLUE}" stroke-width="1.3"${ir.diagram_type==='mindmap'||ir.diagram_type==='hierarchy'?'':' marker-end="url(#arrow)"'}${e.uncertain?' stroke-dasharray="5 4"':''}/>`);
    if(e.label){const lines=wrap(e.label,16),bw=Math.max(...lines.map(s=>Array.from(s).length))*11+16;parts.push(`<rect x="${lx-bw/2}" y="${ly-14}" width="${bw}" height="${lines.length*17+6}" rx="4" fill="#F7F8FC"/>`,text(lines,lx-bw/2+8,ly,11,'#3D4C7D'));}
  });
  for(const n of ir.nodes){const p=positions.get(n.id);parts.push(`<g data-node-id="${escapeXML(n.id)}"><rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${n.kind==='decision'?5:12}" fill="#FFFFFF" stroke="${n.uncertain?'#8190BB':BLUE}" stroke-width="${n.kind==='decision'?1.8:1.2}"${n.uncertain?' stroke-dasharray="5 4"':''}/><rect x="${p.x}" y="${p.y+12}" width="3" height="${p.h-24}" rx="1.5" fill="${BLUE}"/>`);let y=p.y+30;
    if(n.order_label){const dateLines=wrap(n.order_label,(p.w-36)/11);parts.push(text(dateLines,p.x+18,y,11,BLUE,600));y+=10+dateLines.length*16;}
    const labelLines=wrap(n.label,(p.w-36)/15);parts.push(text(labelLines,p.x+18,y,15,'#202943',600));y+=(labelLines.length-1)*21+25;
    if(n.detail)parts.push(text(wrap(n.detail,(p.w-36)/12),p.x+18,y,12,'#59647E'));
    parts.push('</g>');
  }
  return parts.join('')+'</g></svg>';
}
