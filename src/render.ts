import type {Item, Project} from './model'
const NS='http://www.w3.org/2000/svg'
function svg(tag:string, attrs:Record<string,string|number>={}) {
  const el=document.createElementNS(NS,tag)
  for(const [key,val] of Object.entries(attrs)) el.setAttribute(key,String(val))
  return el
}
function draw(item:Item, ink:string) {
  const fill={ink,soft:'#686163',line:'#b9b1ad'}[item.tone]
  if(item.kind==='line') return svg('path',{d:item.points.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' '),fill:'none',stroke:fill,'stroke-width':item.width})
  if(item.kind==='text'){
    const el=svg('text',{x:item.x,y:item.y,'font-family':item.font==='serif'?'Noto Serif CJK KR':'Noto Sans CJK KR','font-weight':item.weight,'font-size':item.size,'text-anchor':item.anchor,'letter-spacing':item.spacing,fill})
    el.textContent=item.text
    if(item.angle) el.setAttribute('transform',`rotate(${item.angle} ${item.x} ${item.y})`)
    return el
  }
  if(item.kind==='dot') return svg('circle',{cx:item.x,cy:item.y,r:item.radius,fill})
  const g=svg('g',{transform:`translate(${item.x} ${item.y}) scale(${item.radius/28})`,fill})
  for(let angle=0;angle<360;angle+=60) g.append(svg('ellipse',{cx:0,cy:-14.25,rx:5,ry:13.75,transform:`rotate(${angle})`}))
  g.append(svg('circle',{r:6}))
  return g
}
export function render(project:Project,mapOnly=false,interactive=false) {
  const height=mapOnly?1140:1440
  const root=svg('svg',{width:'140mm',height:`${height/10}mm`,viewBox:`0 0 1400 ${height}`,role:'img','aria-label':mapOnly?'오시는 길 약도':project.name+' 약도'})
  for(const item of project.spec.items){
    if(item.hidden || (mapOnly && item.footer)) continue
    const isTitle=item.kind==='text' && (item.id==='ref-0'||item.id==='title')
    const el=draw(isTitle && project.review.status==='pending' ? {...item,size:24,spacing:0,tone:'soft',text:project.origin==='reference'?'원본 재현 · 위치 재확인 전':'확인 필요 시안 · 위치 미검수'}:item,project.spec.ink)
    if(interactive) el.setAttribute('data-item',item.id)
    root.append(el)
  }
  if(project.origin==='osm'){
    const el=svg('text',{x:700,y:1125,'text-anchor':'middle','font-size':17,'font-family':'Noto Sans CJK KR',fill:'#504949'})
    el.textContent='© OpenStreetMap contributors · https://www.openstreetmap.org/copyright'
    root.append(el)
  }
  return root
}
export const serialize=(p:Project,mapOnly=false)=>new XMLSerializer().serializeToString(render(p,mapOnly))
