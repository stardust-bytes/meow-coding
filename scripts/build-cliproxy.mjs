// Build the meow-cliproxy Go sidecar for the current platform (or GOOS/GOARCH
// when cross-compiling). Output lands in out/cliproxy/<os>-<arch>/ so
// electron-builder can copy it into extraResources as "cliproxy".
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const sidecarDir = path.join(rootDir, 'sidecars', 'meow-cliproxy')

// CLIPROXY_PLATFORM/CLIPROXY_ARCH mirror what electron-builder.ts consumes so a
// cross-compiled dist packages the artifact it actually built.
const goos = process.env.CLIPROXY_PLATFORM ?? process.env.GOOS ?? process.platform
const goarch = process.env.CLIPROXY_ARCH ?? process.env.GOARCH ?? process.arch
const exe = goos === 'win32' ? '.exe' : ''
const outDir = path.join(rootDir, 'out', 'cliproxy', `${goos}-${goarch}`)
const outFile = path.join(outDir, `meow-cliproxy${exe}`)
mkdirSync(outDir, { recursive: true })

const goCmd = process.env.GO_BIN ?? 'go'
const env = {
  ...process.env,
  GOOS: goos === 'win32' ? 'windows' : goos,
  GOARCH: goarch === 'x64' ? 'amd64' : goarch,
  CGO_ENABLED: '0'
}

console.log(`[build-cliproxy] ${goCmd} build -> ${path.relative(rootDir, outFile)}`)
execFileSync(goCmd, ['build', '-trimpath', '-o', outFile, '.'], {
  cwd: sidecarDir,
  env,
  stdio: 'inherit'
})

// Unit-test the wrapper on host builds only; cross-compiled binaries cannot
// execute on the build machine.
const isHostBuild = !process.env.GOOS && !process.env.GOARCH && !process.env.CLIPROXY_PLATFORM
if (isHostBuild) {
  execFileSync(goCmd, ['test', './...'], { cwd: sidecarDir, env, stdio: 'inherit' })
}
