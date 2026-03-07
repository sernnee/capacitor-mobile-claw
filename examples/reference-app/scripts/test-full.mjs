#!/usr/bin/env node
/**
 * test-full.mjs — Pre-push test gate for mobile-claw reference app.
 *
 * Runs all available test suites in sequence:
 *   1. Node.js unit tests (vitest, always runs)
 *   2. Android E2E sentinel tests (if ADB device available)
 *   3. iOS E2E sentinel tests (if SSH to Mac build machine available)
 *
 * Gracefully skips unavailable platforms. Exit 0 only if all ran tests pass.
 *
 * Usage:
 *   node scripts/test-full.mjs
 *   npm run test:full
 */

import { execSync, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REF_APP = path.resolve(__dirname, '..')
const ROOT = path.resolve(REF_APP, '..', '..')

const ADB = process.env.ADB_PATH || (
  process.platform === 'darwin'
    ? `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`
    : `${process.env.HOME}/Android/Sdk/platform-tools/adb`
)
const IOS_SSH_HOST = process.env.IOS_SSH_HOST || 'rogelioruizgatica@10.61.192.207'
const IOS_SSH_TIMEOUT = 5 // seconds

// ── Helpers ─────────────────────────────────────────────────────────────

function banner(text) {
  const line = '═'.repeat(60)
  console.log(`\n${line}\n  ${text}\n${line}`)
}

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`)
  const result = spawnSync('bash', ['-c', cmd], {
    stdio: 'inherit',
    timeout: opts.timeout || 600_000,
    cwd: opts.cwd,
  })
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${cmd}`)
  }
  return result
}

function check(cmd) {
  try {
    execSync(cmd, { encoding: 'utf8', timeout: 10000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

// ── Results ─────────────────────────────────────────────────────────────

const results = {
  node: null,    // 'pass' | 'fail' | null
  android: null, // 'pass' | 'fail' | 'skip' | null
  ios: null,     // 'pass' | 'fail' | 'skip' | null
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. NODE TESTS
// ═══════════════════════════════════════════════════════════════════════════

banner('1 — Node.js Tests (vitest)')

try {
  run('npm test', { cwd: ROOT, timeout: 120_000 })
  results.node = 'pass'
  console.log('\n  Node tests: PASS')
} catch (err) {
  results.node = 'fail'
  console.error('\n  Node tests: FAIL')
  console.error(`  ${err.message}`)
}

if (results.node === 'fail') {
  console.error('\n  Node tests failed — aborting.')
  printSummary()
  process.exit(1)
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. ANDROID E2E
// ═══════════════════════════════════════════════════════════════════════════

banner('2 — Android E2E (CDP + ADB)')

const hasAdb = existsSync(ADB) && check(`${ADB} devices 2>&1 | grep -w device`)

if (!hasAdb) {
  console.log('  No ADB device detected — SKIPPING Android tests')
  results.android = 'skip'
} else {
  try {
    // Check app is installed
    const installed = check(`${ADB} shell pm list packages | grep ${encodeURI('io.mobileclaw.reference')}`)
    if (!installed) {
      console.log('  App not installed on device — building...')
      run('npm run cap:build', { cwd: REF_APP })
      run('npx cap sync android', { cwd: REF_APP })
      const gradlew = path.join(REF_APP, 'android', 'gradlew')
      if (existsSync(gradlew)) {
        run('./gradlew assembleDebug', { cwd: path.join(REF_APP, 'android'), timeout: 300_000 })
        run(`${ADB} install -r android/app/build/outputs/apk/debug/app-debug.apk`, { cwd: REF_APP })
      }
    }

    // Launch app
    console.log('  Launching app...')
    try { execSync(`${ADB} shell am force-stop io.mobileclaw.reference`, { timeout: 5000 }) } catch {}
    execSync(`${ADB} shell am start -n io.mobileclaw.reference/.MainActivity`, { timeout: 5000 })
    // Wait for app to start
    await new Promise(r => setTimeout(r, 5000))

    // Run sentinel tests via CDP
    run('node test-sentinel-e2e.mjs', { cwd: REF_APP, timeout: 600_000 })
    results.android = 'pass'
    console.log('\n  Android E2E: PASS')
  } catch (err) {
    results.android = 'fail'
    console.error('\n  Android E2E: FAIL')
    console.error(`  ${err.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. iOS E2E
// ═══════════════════════════════════════════════════════════════════════════

banner('3 — iOS E2E (Mac via SSH)')

const hasSsh = check(`ssh -o ConnectTimeout=${IOS_SSH_TIMEOUT} -o BatchMode=yes ${IOS_SSH_HOST} 'echo OK' 2>/dev/null`)

if (!hasSsh) {
  console.log(`  SSH to ${IOS_SSH_HOST} not available — SKIPPING iOS tests`)
  results.ios = 'skip'
} else {
  try {
    // rsync reference-app to Mac
    console.log('  Syncing reference-app to Mac...')
    run(`rsync -az --delete --exclude node_modules --exclude ios --exclude android --exclude dist ${REF_APP}/ ${IOS_SSH_HOST}:~/choreruiz/mobile-claw/examples/reference-app/`)

    // rsync root mobile-claw (dist + source)
    run(`rsync -az --delete --exclude node_modules --exclude examples ${ROOT}/ ${IOS_SSH_HOST}:~/choreruiz/mobile-claw/`)

    // Install + build + test on Mac
    const sshCmd = [
      'cd ~/choreruiz/mobile-claw',
      'npm install',
      'npm run build',
      'cd examples/reference-app',
      'npm install',
      'npm run cap:build',
      'node test-sentinel-e2e-ios.mjs',
    ].join(' && ')

    run(`ssh -o ConnectTimeout=${IOS_SSH_TIMEOUT} ${IOS_SSH_HOST} '${sshCmd}'`, { timeout: 600_000 })
    results.ios = 'pass'
    console.log('\n  iOS E2E: PASS')
  } catch (err) {
    results.ios = 'fail'
    console.error('\n  iOS E2E: FAIL')
    console.error(`  ${err.message}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

printSummary()

function printSummary() {
  const icon = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }
  banner('Summary')
  console.log(`  Node:    ${icon[results.node] || 'N/A'}`)
  console.log(`  Android: ${icon[results.android] || 'N/A'}`)
  console.log(`  iOS:     ${icon[results.ios] || 'N/A'}`)

  const anyFailed = Object.values(results).includes('fail')
  if (anyFailed) {
    console.log('\n  RESULT: FAIL — fix failures before pushing\n')
  } else {
    console.log('\n  RESULT: ALL PASS\n')
  }
}

const anyFailed = Object.values(results).includes('fail')
process.exit(anyFailed ? 1 : 0)
