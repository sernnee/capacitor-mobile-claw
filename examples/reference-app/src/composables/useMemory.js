/**
 * useMemory — Vue composable wrapping MemoryManager from capacitor-lancedb.
 *
 * Provides reactive state + lifecycle hooks for the memory system.
 * Singleton — shared across all components that call useMemory().
 */

import { ref } from 'vue'
import { MemoryManager } from 'capacitor-lancedb'

// ── Module-level singleton ───────────────────────────────────────────────

const memory = new MemoryManager()

const initialized = ref(false)
const memoryCount = ref(0)
const indexing = ref(false)
const lastError = ref(null)

let initPromise = null

// ── Config storage (localStorage for reference app simplicity) ──────────

const STORAGE_KEY = 'mobileclaw_memory_config'

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveConfig(partial) {
  try {
    const current = loadSavedConfig()
    const merged = { ...current, ...partial }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged))
  } catch { /* non-fatal */ }
}

// ── Init ─────────────────────────────────────────────────────────────────

/**
 * Initialize the memory system.
 * @param {import('capacitor-lancedb').MemoryManagerConfig} config
 */
async function initMemory(config = {}) {
  if (initPromise) return initPromise
  initPromise = _doInit(config)
  return initPromise
}

async function _doInit(config) {
  try {
    const saved = loadSavedConfig()
    const merged = {
      dbPath: 'memory-lancedb',
      autoRecall: true,
      autoCapture: true,
      ...saved,
      ...config,
    }
    await memory.init(merged)
    initialized.value = true
    await refreshCount()
  } catch (e) {
    lastError.value = `Memory init failed: ${e.message}`
  }
}

// ── Stats ────────────────────────────────────────────────────────────────

async function refreshCount() {
  try {
    memoryCount.value = await memory.count()
  } catch {
    memoryCount.value = 0
  }
}

// ── File indexing ────────────────────────────────────────────────────────

/**
 * Re-index workspace memory files into LanceDB.
 * @param {Function} readFile  — engine.readFile
 * @param {Function} invokeTool — engine.invokeTool (for list_files)
 */
async function reindex(readFile, invokeTool) {
  if (!initialized.value) return { indexed: 0, errors: ['Not initialized'] }
  indexing.value = true
  try {
    const listFiles = async (dirPath) => {
      const result = await invokeTool('list_files', { path: dirPath })
      // Worker returns { files: [{ name, type }] } in the result content
      if (result?.content) {
        const parsed = typeof result.content === 'string' ? JSON.parse(result.content) : result.content
        return { files: parsed.files || [] }
      }
      return { files: [] }
    }
    const result = await memory.indexFiles(readFile, listFiles)
    await refreshCount()
    return result
  } catch (e) {
    return { indexed: 0, errors: [e.message] }
  } finally {
    indexing.value = false
  }
}

// ── Config updates ───────────────────────────────────────────────────────

function updateMemoryConfig(partial) {
  memory.updateConfig(partial)
  saveConfig(partial)
}

// ── Clear ────────────────────────────────────────────────────────────────

async function clearMemories() {
  if (!initialized.value) return
  await memory.clear()
  memoryCount.value = 0
}

// ── Public composable ────────────────────────────────────────────────────

export function useMemory() {
  return {
    // The MemoryManager instance (for tools, recall, capture)
    memory,

    // Reactive state
    initialized,
    memoryCount,
    indexing,
    lastError,

    // Lifecycle
    initMemory,
    refreshCount,
    reindex,

    // Config
    updateMemoryConfig,
    loadSavedConfig,

    // Data management
    clearMemories,
  }
}
