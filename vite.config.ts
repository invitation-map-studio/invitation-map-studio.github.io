import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
function fingerprint(dir: string, hash: ReturnType<typeof createHash>) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) fingerprint(path, hash)
    else hash.update(path).update(readFileSync(path))
  }
}
export default defineConfig(() => {
  const hash = createHash('sha256').update(readFileSync('package-lock.json'))
  fingerprint('src', hash)
  try {
    fingerprint('public/fonts', hash)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return { base: './', define: { __RENDER_BUILD__: JSON.stringify(hash.digest('hex')) } }
})
