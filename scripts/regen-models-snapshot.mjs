import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL = 'https://models.dev/api.json'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../src/main/models-snapshot.json')

async function main() {
  const res = await fetch(URL, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json()

  const out = {}
  for (const [pid, p] of Object.entries(json)) {
    if (typeof p !== 'object' || p === null) continue
    const prov = p
    const models = Object.keys(prov.models ?? {})
    const variants = {}
    for (const [mid, m] of Object.entries(prov.models ?? {})) {
      if (typeof m !== 'object' || m === null) continue
      const opts = m.reasoning_options
      if (!Array.isArray(opts)) continue
      const effort = opts.find((o) => typeof o === 'object' && o !== null && o.type === 'effort')
      if (!effort || !Array.isArray(effort.values)) continue
      const values = effort.values.filter((v) => typeof v === 'string')
      if (values.length > 0) variants[mid] = values
    }
    out[pid] = {
      name: typeof prov.name === 'string' ? prov.name : pid,
      ...(typeof prov.api === 'string' ? { api: prov.api } : {}),
      models,
      ...(Object.keys(variants).length > 0 ? { variants } : {})
    }
  }

  writeFileSync(OUT, JSON.stringify(out))
  console.log(`Wrote ${OUT} (${Object.keys(out).length} providers)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
