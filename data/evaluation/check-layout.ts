import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { layout } from '../../src/geography'
import type { Geography, Point } from '../../src/model'

// Text boxes approximate glyph widths. Intersections flag candidates for visual review.
function intersects(a: Point, b: Point, box: number[]) {
  let from = 0, to = 1
  const dx = b[0] - a[0], dy = b[1] - a[1]
  for (const [p, q] of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dy,a[1]-box[1]],[dy,box[3]-a[1]]]) {
    if (!p && q < 0) return false
    if (p < 0) from = Math.max(from, q / p)
    if (p > 0) to = Math.min(to, q / p)
  }
  return from <= to
}

const dir = process.argv[2]
const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'))
for (const [index, record] of results.records.entries()) {
  const file = String(index + 1).padStart(2, '0') + '.json'
  const geo: Geography = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const start = performance.now()
  const spec = layout(geo, record.name)
  const milliseconds = +(performance.now() - start).toFixed(2)
  const runs = spec.items.filter(i => i.kind === 'line' && i.id.startsWith('road-'))
  const labels = spec.items.filter(i => i.kind === 'text' && (i.id.startsWith('label-') || i.id.startsWith('street-')))
  let conflict = 0
  for (const label of labels) {
    if (label.kind !== 'text') continue
    const width = Array.from(label.text).reduce((sum,g) => sum + (g.charCodeAt(0) < 128 ? .55 : 1), 0) * label.size
    const box = [-width / 2, -.8 * label.size, width / 2, .1 * label.size]
    const angle = -label.angle * Math.PI / 180
    const local = ([x,y]: Point): Point => [(x - label.x) * Math.cos(angle) - (y - label.y) * Math.sin(angle),
      (x - label.x) * Math.sin(angle) + (y - label.y) * Math.cos(angle)]
    if (runs.some(run => run.kind === 'line' && run.points.slice(1).some((b,i) => intersects(local(run.points[i]),local(b),box)))) conflict++
  }
  record.layout = { milliseconds, roadRuns: runs.length, labels: labels.length, streetLabels: labels.filter(i => i.id.startsWith('street-')).length,
    addressRoadLabeled: labels.some(i => i.kind === 'text' && i.text === record.address.split(' ').at(-2)),
    venueInFooter: spec.items.find(i => i.id === 'venue')?.footer, potentialLabelRoadConflicts: conflict }
}
writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2) + '\n')
