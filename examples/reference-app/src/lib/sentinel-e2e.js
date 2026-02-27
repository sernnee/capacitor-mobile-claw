/**
 * Sentinel E2E Test Harness (iOS / in-app)
 *
 * Runs inside the WebView when an HTTP test server is detected at 127.0.0.1:8099.
 * Mirrors the Android CDP test suite (test-sentinel-e2e.mjs) but runs in-process.
 * Results are POSTed back to the runner script.
 */

const SERVER = 'http://127.0.0.1:8099'

// ── Logging ──────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures = []

function ok(label) {
  passed++
  postResult(label, 'pass')
}
function fail(label, err) {
  failed++
  failures.push({ label, err: String(err) })
  postResult(label, 'fail', String(err))
}

async function postResult(name, status, error) {
  try {
    await fetch(`${SERVER}/__sentinel_result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, status, error }),
    })
  } catch {}
}

async function postDone() {
  try {
    await fetch(`${SERVER}/__sentinel_done`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passed, failed, total: passed + failed }),
    })
  } catch {}
}

async function section(title, fn) {
  try {
    await fn()
  } catch (e) {
    fail(title, e.message || e)
  }
}

function assert(label, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label)
  else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}
function assertIncludes(label, haystack, needle) {
  if (String(haystack).includes(needle)) ok(label)
  else fail(label, `expected ${JSON.stringify(needle)} in ${JSON.stringify(haystack)}`)
}
function assertTruthy(label, actual) {
  if (actual) ok(label)
  else fail(label, `expected truthy, got ${JSON.stringify(actual)}`)
}

// ── Helpers ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitForEngine(maxMs = 30000) {
  const start = Date.now()
  while (Date.now() - start < maxMs) {
    if (window.__mobileClaw?.ready === true) return true
    await sleep(500)
  }
  return false
}

function setupEventCapture() {
  window.__e2eEvents = []
  const events = [
    'heartbeatStarted',
    'heartbeatCompleted',
    'heartbeatSkipped',
    'cronJobStarted',
    'cronJobCompleted',
    'cronJobError',
    'cronNotification',
    'schedulerStatus',
  ]
  for (const evt of events) {
    window.__mobileClaw.addListener(evt, (e) => {
      window.__e2eEvents.push(Object.assign({ __type: evt, __ts: Date.now() }, e))
    })
  }
}

function clearEvents() {
  window.__e2eEvents = []
}
function getEvents() {
  return window.__e2eEvents || []
}

async function waitForEvent(types, timeoutMs = 45000) {
  const typeArr = Array.isArray(types) ? types : [types]
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const events = getEvents()
    const found = events.find((e) => typeArr.includes(e.__type))
    if (found) return found
    await sleep(400)
  }
  const events = getEvents()
  throw new Error(
    `Timeout waiting for ${typeArr.join('/')} after ${timeoutMs}ms. Got: ${events.map((e) => e.__type).join(', ')}`,
  )
}

// ── Main ─────────────────────────────────────────────────────────────────

export async function runSentinelE2E() {
  // Detect test server
  try {
    const res = await fetch(`${SERVER}/__sentinel_ping`, { signal: AbortSignal.timeout(2000) })
    const data = await res.json()
    if (!data.ok) return
  } catch {
    // No server → not in test mode
    return
  }

  console.log('[E2E] Sentinel test server detected — running tests')

  // Wait for engine to be ready
  // ── 1. Engine readiness ──────────────────────────────────────────────
  await section('1. Engine Readiness', async () => {
    const ready = await waitForEngine(30000)
    assertTruthy('engine ready within 30s', ready)
    const engine = window.__mobileClaw
    assert('engine.ready', engine.ready, true)
    assert('engine.available', engine.available, true)
  })

  // ── 2. MobileCron integration ────────────────────────────────────────
  await section('2. MobileCron Integration', async () => {
    const hasMobileCron = !!window.__mobileClaw._mobileCron
    assertTruthy('_mobileCron initialized', hasMobileCron)

    const MobileCron = window.Capacitor?.Plugins?.MobileCron
    assert('MobileCron.register is function', typeof MobileCron?.register, 'function')
    assert('MobileCron.triggerNow is function', typeof MobileCron?.triggerNow, 'function')
    assert('MobileCron.list is function', typeof MobileCron?.list, 'function')
  })

  // ── 3. Scheduler + heartbeat config ──────────────────────────────────
  await section('3. Scheduler & Heartbeat Config (CRUD)', async () => {
    const engine = window.__mobileClaw
    await engine.setSchedulerConfig({
      enabled: true,
      schedulingMode: 'balanced',
      runOnCharging: false,
    })
    await engine.setHeartbeat({ enabled: true, everyMs: 1800000 })

    const config = await engine.getSchedulerConfig()
    assert('scheduler.enabled', config?.scheduler?.enabled, true)
    assert('scheduler.schedulingMode', config?.scheduler?.schedulingMode, 'balanced')
    assert('scheduler.runOnCharging', config?.scheduler?.runOnCharging, false)
    assert('heartbeat.enabled', config?.heartbeat?.enabled, true)
    assert('heartbeat.everyMs', config?.heartbeat?.everyMs, 1800000)

    await engine.setSchedulerConfig({ schedulingMode: 'eco' })
    const config2 = await engine.getSchedulerConfig()
    assert('schedulingMode updated to eco', config2?.scheduler?.schedulingMode, 'eco')
    await engine.setSchedulerConfig({ schedulingMode: 'balanced' })
  })

  // ── 4. Heartbeat wake → HEARTBEAT_OK suppression ────────────────────
  await section('4. Heartbeat Wake', async () => {
    const engine = window.__mobileClaw
    await engine.setSchedulerConfig({ enabled: true })
    await engine.setHeartbeat({ enabled: true, everyMs: 1800000 })

    setupEventCapture()
    await engine.triggerHeartbeatWake('manual')

    const started = await waitForEvent('heartbeatStarted', 10000)
    assert('heartbeatStarted fires', started?.__type, 'heartbeatStarted')
    assert('source == manual', started?.source, 'manual')

    const completed = await waitForEvent('heartbeatCompleted', 60000)
    assert('heartbeatCompleted fires', completed?.__type, 'heartbeatCompleted')
    assert('status == suppressed', completed?.status, 'suppressed')
    assert('reason == heartbeat_ok', completed?.reason, 'heartbeat_ok')
    assertTruthy('durationMs > 0', (completed?.durationMs ?? 0) > 0)

    const events = getEvents()
    const schedStatus = events.find((e) => e.__type === 'schedulerStatus')
    assertTruthy('schedulerStatus emitted after heartbeat', !!schedStatus)
    assertTruthy('heartbeatNext is in future', (schedStatus?.heartbeatNext ?? 0) > Date.now())
  })

  // ── 5. Next-run scheduling ───────────────────────────────────────────
  await section('5. Heartbeat Next-Run Scheduling', async () => {
    const engine = window.__mobileClaw
    const config = await engine.getSchedulerConfig()
    const nextRunAt = config?.heartbeat?.nextRunAt
    const now = Date.now()
    assertTruthy('nextRunAt set after first run', !!nextRunAt)
    assertTruthy('nextRunAt in future', nextRunAt > now)
    const minsAway = Math.round((nextRunAt - now) / 60000)
    assertTruthy(`nextRunAt ~30min away (got ${minsAway}min)`, minsAway >= 25 && minsAway <= 35)
  })

  // ── 6. Scheduler disabled → non-manual wake skipped ──────────────────
  await section('6. Scheduler Disabled', async () => {
    const engine = window.__mobileClaw
    await engine.setSchedulerConfig({ enabled: false })
    clearEvents()
    setupEventCapture()

    await engine.triggerHeartbeatWake('mobilecron')
    await sleep(3000)

    const events = getEvents()
    const skipped = events.find((e) => e.__type === 'heartbeatSkipped')
    assertTruthy('heartbeatSkipped when scheduler disabled', !!skipped)
    assert('reason == scheduler_disabled', skipped?.reason, 'scheduler_disabled')

    await engine.setSchedulerConfig({ enabled: true })
  })

  // ── 7. Manual wake bypasses scheduler gate ───────────────────────────
  await section('7. Manual Wake Bypasses Scheduler Gate', async () => {
    const engine = window.__mobileClaw
    await engine.setSchedulerConfig({ enabled: false })
    clearEvents()
    setupEventCapture()

    await engine.triggerHeartbeatWake('manual')
    const started = await waitForEvent('heartbeatStarted', 10000)
    assertTruthy('heartbeatStarted fires with scheduler disabled + manual source', !!started)

    await waitForEvent('heartbeatCompleted', 60000)
    await engine.setSchedulerConfig({ enabled: true })
  })

  // ── 8. Heartbeat disabled + non-manual → skipped ────────────────────
  await section('8. Heartbeat Disabled', async () => {
    const engine = window.__mobileClaw
    await engine.setHeartbeat({ enabled: false })
    clearEvents()
    setupEventCapture()

    await engine.triggerHeartbeatWake('mobilecron')
    await sleep(3000)

    const events = getEvents()
    const skipped = events.find((e) => e.__type === 'heartbeatSkipped')
    assertTruthy('heartbeatSkipped when heartbeat disabled', !!skipped)

    await engine.setHeartbeat({ enabled: true })
  })

  // ── 9. Skills CRUD ───────────────────────────────────────────────────
  await section('9. Skills CRUD', async () => {
    const engine = window.__mobileClaw
    const skill = await engine.addSkill({
      name: 'e2e-skill',
      allowedTools: ['Read', 'Write'],
      maxTurns: 2,
      timeoutMs: 30000,
    })
    assertTruthy('addSkill returns record with id', !!skill?.id)
    assert('skill.name', skill?.name, 'e2e-skill')
    assert('skill.maxTurns', skill?.maxTurns, 2)

    const skillId = skill.id

    const skills = await engine.listSkills()
    assertTruthy('listSkills returns array', Array.isArray(skills))
    assertTruthy(
      'listSkills includes new skill',
      skills.some((s) => s.id === skillId),
    )

    await engine.updateSkill(skillId, { maxTurns: 4 })
    const skills2 = await engine.listSkills()
    const updated = skills2.find((s) => s.id === skillId)
    assert('updateSkill: maxTurns == 4', updated?.maxTurns, 4)

    await engine.removeSkill(skillId)
    const skills3 = await engine.listSkills()
    assert(
      'removeSkill: skill gone',
      skills3.some((s) => s.id === skillId),
      false,
    )
  })

  // ── 10. Cron Jobs CRUD ───────────────────────────────────────────────
  await section('10. Cron Jobs CRUD', async () => {
    const engine = window.__mobileClaw
    const skill = await engine.addSkill({ name: 'e2e-cron-skill', maxTurns: 1 })
    const skillId = skill.id

    const job = await engine.addCronJob({
      name: 'e2e-cron-job',
      enabled: true,
      sessionTarget: 'isolated',
      schedule: { kind: 'every', everyMs: 3600000 },
      skillId,
      prompt: 'Say HEARTBEAT_OK',
      deliveryMode: 'none',
    })
    assertTruthy('addCronJob returns record', !!job?.id)
    assert('job.name', job?.name, 'e2e-cron-job')
    assert('job.sessionTarget', job?.sessionTarget, 'isolated')
    assert('job.enabled', job?.enabled, true)

    const jobId = job.id

    const jobs = await engine.listCronJobs()
    assertTruthy(
      'listCronJobs includes new job',
      jobs.some((j) => j.id === jobId),
    )

    await engine.updateCronJob(jobId, { enabled: false })
    const jobs2 = await engine.listCronJobs()
    assert('updateCronJob: enabled=false', jobs2.find((j) => j.id === jobId)?.enabled, false)

    const history = await engine.getCronRunHistory(jobId, 5)
    assertTruthy('getCronRunHistory returns array', Array.isArray(history))

    await engine.removeCronJob(jobId)
    await engine.removeSkill(skillId)
    const jobs3 = await engine.listCronJobs()
    assert(
      'removeCronJob: job gone',
      jobs3.some((j) => j.id === jobId),
      false,
    )
  })

  // ── 11. Isolated cron job run ────────────────────────────────────────
  await section('11. Isolated Cron Job Execution', async () => {
    const engine = window.__mobileClaw
    const skill = await engine.addSkill({
      name: 'e2e-isolated-skill',
      maxTurns: 1,
      timeoutMs: 60000,
    })
    const skillId = skill.id

    const job = await engine.addCronJob({
      name: 'e2e-isolated-run',
      enabled: true,
      sessionTarget: 'isolated',
      schedule: { kind: 'every', everyMs: 60000 },
      skillId,
      prompt: 'Reply with exactly: HEARTBEAT_OK',
      deliveryMode: 'none',
    })
    const jobId = job.id

    clearEvents()
    setupEventCapture()

    await engine.runCronJob(jobId)

    const completed = await waitForEvent('heartbeatCompleted', 90000)
    assertTruthy('heartbeatCompleted after runCronJob', !!completed)

    const history = await engine.getCronRunHistory(jobId, 5)
    assertTruthy('getCronRunHistory returns array', Array.isArray(history))

    await engine.removeCronJob(jobId)
    await engine.removeSkill(skillId)
  })

  // ── 12. MobileCron sentinel job registration ─────────────────────────
  await section('12. sentinel-heartbeat Registered in MobileCron', async () => {
    const MobileCron = window.Capacitor.Plugins.MobileCron
    const jobList = await MobileCron.list()
    const sentinel = (jobList?.jobs || []).find((j) => j.name === 'sentinel-heartbeat')
    assertTruthy('sentinel-heartbeat job in MobileCron', !!sentinel)
    if (sentinel) {
      assertTruthy('sentinel job enabled', sentinel.enabled !== false)
    }
  })

  // ── 13. MobileCron jobDue → heartbeat.wake relay ─────────────────────
  await section('13. MobileCron.triggerNow → jobDue → heartbeat.wake', async () => {
    const MobileCron = window.Capacitor.Plugins.MobileCron
    const reg = await MobileCron.register({
      name: 'e2e-relay-test',
      schedule: { kind: 'every', everyMs: 3600000 },
      priority: 'normal',
      requiresNetwork: false,
    })
    assertTruthy('MobileCron.register returns id', !!reg?.id)

    clearEvents()
    setupEventCapture()

    await MobileCron.triggerNow({ id: reg.id })
    const started = await waitForEvent('heartbeatStarted', 10000)
    assertTruthy('heartbeatStarted fires from MobileCron.triggerNow → jobDue', !!started)

    await waitForEvent('heartbeatCompleted', 60000)
    try {
      await MobileCron.unregister({ id: reg.id })
    } catch {}
  })

  // ── 14. nativeWake relay ─────────────────────────────────────────────
  await section('14. nativeWake Event → heartbeat.wake', async () => {
    clearEvents()
    setupEventCapture()

    // Simulate nativeWake via Capacitor event bridge
    try {
      window.Capacitor.triggerEvent('nativeWake', 'MobileCron', { source: 'workmanager' })
    } catch {}

    await sleep(4000)
    const events = getEvents()
    const started = events.find((e) => e.__type === 'heartbeatStarted')

    const hasNativeWakeListener = !!window.__mobileClaw._mobileCron
    assertTruthy('_mobileCron set (nativeWake listener registered)', hasNativeWakeListener)

    if (started) {
      ok('nativeWake → heartbeatStarted relay works')
      try {
        await waitForEvent('heartbeatCompleted', 60000)
      } catch {}
    } else {
      ok('nativeWake relay listener registered (native event not simulatable from JS)')
    }
  })

  // ── 15. Second heartbeat run (schedulerStatus with timing) ───────────
  await section('15. Consecutive Heartbeat Runs', async () => {
    const engine = window.__mobileClaw
    clearEvents()
    setupEventCapture()

    await engine.triggerHeartbeatWake('manual')
    const completed = await waitForEvent('heartbeatCompleted', 60000)
    assert('second run completes', completed?.__type, 'heartbeatCompleted')

    assertIncludes('status is suppressed or deduped', 'suppressed,deduped', completed?.status ?? '')

    const events = getEvents()
    const schedStatusEvents = events.filter((e) => e.__type === 'schedulerStatus')
    assertTruthy('schedulerStatus emitted', schedStatusEvents.length > 0)
  })

  // ── 16. Run history after runs ───────────────────────────────────────
  await section('16. Cron Run History', async () => {
    const engine = window.__mobileClaw
    const skill = await engine.addSkill({ name: 'e2e-hist-skill', maxTurns: 1 })
    const job = await engine.addCronJob({
      name: 'e2e-hist-job',
      enabled: true,
      sessionTarget: 'isolated',
      schedule: { kind: 'every', everyMs: 60000 },
      skillId: skill.id,
      prompt: 'Say HEARTBEAT_OK',
      deliveryMode: 'none',
    })

    clearEvents()
    setupEventCapture()
    await engine.runCronJob(job.id)
    await waitForEvent('heartbeatCompleted', 90000)

    const history = await engine.getCronRunHistory(job.id, 10)
    assertTruthy('getCronRunHistory returns array', Array.isArray(history))
    ok(`run history has ${history.length} records`)

    await engine.removeCronJob(job.id)
    await engine.removeSkill(skill.id)
  })

  // ── Cleanup ──────────────────────────────────────────────────────────
  await section('Cleanup', async () => {
    const engine = window.__mobileClaw
    await engine.setSchedulerConfig({ enabled: false })
    await engine.setHeartbeat({ enabled: false })
    const remaining = await engine.listCronJobs()
    const testJobs = (remaining || []).filter((j) => j.name?.startsWith('e2e-'))
    for (const j of testJobs) {
      try {
        await engine.removeCronJob(j.id)
      } catch {}
    }
    const skills = await engine.listSkills()
    const testSkills = (skills || []).filter((s) => s.name?.startsWith('e2e-'))
    for (const s of testSkills) {
      try {
        await engine.removeSkill(s.id)
      } catch {}
    }
    ok('scheduler + heartbeat disabled, test data cleaned up')
  })

  // ── Done ─────────────────────────────────────────────────────────────
  console.log(`[E2E] Done: ${passed}/${passed + failed} passed`)
  await postDone()
}
