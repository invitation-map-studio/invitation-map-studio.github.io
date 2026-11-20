import places from '../data/evaluation/addresses.json'
import type { Geography } from './model'
const models = import.meta.glob<Geography>('./samples/*.json', { import: 'default' })
export const catalog = places
  .slice(1)
  .map((row, i) => ({
    ...row,
    load: models['./samples/' + String(i + 2).padStart(2, '0') + '.json'],
  }))
export const datasetAt = '2026-11-18T21:21:02Z'
