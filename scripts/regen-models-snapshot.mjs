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
    const models = {}
    for (const [mid, m] of Object.entries(prov.models ?? {})) {
      if (typeof m !== 'object' || m === null) continue
      const raw = {}
      if (typeof m.reasoning === 'boolean') raw.reasoning = m.reasoning
      if (typeof m.release_date === 'string') raw.release_date = m.release_date
      if (m.limit && (m.limit.context !== undefined || m.limit.output !== undefined)) {
        raw.limit = {}
        if (m.limit.context !== undefined) raw.limit.context = m.limit.context
        if (m.limit.output !== undefined) raw.limit.output = m.limit.output
      }
      if (Array.isArray(m.reasoning_options)) raw.reasoning_options = m.reasoning_options
      models[mid] = raw
    }
    out[pid] = {
      name: typeof prov.name === 'string' ? prov.name : pid,
      ...(typeof prov.api === 'string' ? { api: prov.api } : {}),
      ...(typeof prov.npm === 'string' ? { npm: prov.npm } : {}),
      models
    }
  }

  writeFileSync(OUT, JSON.stringify(out))
  console.log(`Wrote ${OUT} (${Object.keys(out).length} providers)`)
}

main().catch((err) => { console.error(err); process.exit(1) })
