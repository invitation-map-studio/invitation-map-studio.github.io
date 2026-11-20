import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { layout } from '../src/geography'
import type { Geography, Label, Point } from '../src/model'

const fixture = JSON.parse(readFileSync(new URL('../data/dasan74.json', import.meta.url),'utf8'))

// Check the interior of each text's estimated painted area, after undoing its rotation.
function intersectsLabel(text:Label, start:Point, end:Point) {
  const angle=text.angle*Math.PI/180, c=Math.cos(angle), s=Math.sin(angle)
  const local=([x,y]:Point):Point=>[(x-text.x)*c+(y-text.y)*s, -(x-text.x)*s+(y-text.y)*c]
  const [a,b]=[local(start),local(end)]
  const width=Array.from(text.text).reduce((sum,char)=>sum+(/\s/.test(char)?.32:/[a-z\d]/i.test(char)?.58:.96),0)*text.size
  const rectangle=[[-width/2,width/2],[-text.size*.94,text.size*.13]]
  let enter=0,leave=1
  for(let axis=0;axis<2;axis++) {
    const delta=b[axis]-a[axis]
    if(!delta) {
      if(a[axis]<rectangle[axis][0] || a[axis]>rectangle[axis][1]) return false
    } else {
      const t1=(rectangle[axis][0]-a[axis])/delta,t2=(rectangle[axis][1]-a[axis])/delta
      enter=Math.max(enter,Math.min(t1,t2))
      leave=Math.min(leave,Math.max(t1,t2))
    }
  }
  return enter<=leave
}

test('다산74의 목적지·도로명·시설명과 도로선이 교차하지 않는다',()=>{
  const geo:Geography=fixture.geo
  const {items}=layout(geo,fixture.name)
  const labels=items.filter(i=>i.kind==='text' && !i.footer && !['title','north'].includes(i.id))
  assert.ok(labels.some(i=>i.kind==='text' && i.text==='다산중앙로82번안길'))
  assert.ok(labels.some(i=>i.kind==='text' && i.text===fixture.name))
  assert.ok(labels.some(i=>i.id.startsWith('label-')))
  for(const label of labels) {
    assert.equal(label.kind,'text')
    if(label.kind!=='text') continue
    for(const road of items) {
      if(road.kind!=='line' || !road.id.startsWith('road-')) continue
      for(let i=1;i<road.points.length;i++) {
        assert.equal(intersectsLabel(label,road.points[i-1],road.points[i]),false,label.text+' / '+road.id)
      }
    }
  }
})
