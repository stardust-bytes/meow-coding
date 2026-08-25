// Build the meow-cliproxy Go sidecar for the current platform (or GOOS/GOARCH
// when cross-compiling). Output lands in out/cliproxy/<os>-<arch>/ so
// electron-builder can copy it into extraResources as "cliproxy".
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
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

// Source files that shape the binary (tests don't). Used to detect a prebuilt
// sidecar that has gone stale since it was produced.
function sidecarSources() {
  return readdirSync(sidecarDir)
    .filter(f => f.endsWith('.go') || f === 'go.mod' || f === 'go.sum')
    .filter(f => !f.endsWith('_test.go'))
}

const goAvailable = (() => {
  try {
    execFileSync(goCmd, ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

if (goAvailable) {
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
} else {
  // No Go toolchain on this machine: fall back to a prebuilt sidecar so
  // packaging still works. The binary may lag the source, so say so loudly.
  const prebuilt = [outFile, path.join(sidecarDir, `meow-cliproxy${exe}`)]
    .find(p => existsSync(p))
  if (!prebuilt) {
    console.error(
      `[build-cliproxy] Go toolchain not found (\`${goCmd}\` is not on PATH) and no prebuilt ` +
      `meow-cliproxy for ${goos}-${goarch}.\n` +
      'Install Go from https://go.dev/dl/ (or set GO_BIN) to build the sidecar from source, ' +
      `or drop a prebuilt binary at ${path.join(sidecarDir, `meow-cliproxy${exe}`)}.`
    )
    process.exit(1)
  }
  if (prebuilt !== outFile) {
    copyFileSync(prebuilt, outFile)
    console.warn(`[build-cliproxy] Go toolchain not found; copied prebuilt ${path.relative(rootDir, prebuilt)} -> ${path.relative(rootDir, outFile)}.`)
  } else {
    console.warn(`[build-cliproxy] Go toolchain not found; reusing prebuilt ${path.relative(rootDir, prebuilt)}.`)
  }
  const prebuiltMtime = statSync(prebuilt).mtimeMs
  const staleSource = sidecarSources().find(f => statSync(path.join(sidecarDir, f)).mtimeMs > prebuiltMtime)
  if (staleSource) {
    console.warn(
      `[build-cliproxy] WARNING: prebuilt is older than ${path.join('sidecars/meow-cliproxy', staleSource)} — ` +
      'the packaged sidecar may be missing recent source changes. Install Go and rerun `npm run dist` to rebuild.'
    )
  }
}
