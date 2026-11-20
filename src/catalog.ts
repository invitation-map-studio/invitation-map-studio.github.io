import places from '../data/evaluation/addresses.json'
import venues from './venues.json'
import type { Geography } from './model'
const models = import.meta.glob<Geography>('./samples/*.json', { import: 'default' })
export const catalog = [
  ...places.slice(1).map((row, i) => ({ ...row, sample: String(i + 2).padStart(2, '0') })),
  ...venues,
].map((row) => ({ ...row, load: models['./samples/' + row.sample + '.json'] }))
export const datasetAt = '2026-11-18T21:21:02Z'
