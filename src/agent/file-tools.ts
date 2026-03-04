/**
 * Native file tools using @capacitor/filesystem.
 *
 * Replaces the Node.js worker's file tools (read_file, write_file, list_files,
 * grep_files, find_files, edit_file) with direct Capacitor filesystem calls.
 * No worker round-trip needed.
 */

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import type { AgentToolResult } from '@mariozechner/pi-agent-core'

const SKIP_DIRS = new Set(['.git', '.openclaw', 'node_modules'])

/**
 * On iOS, Capacitor-NodeJS stores its data under Library/ (not Documents/).
 * Directory.Data maps to Documents/ on iOS but filesDir on Android.
 * We must use Directory.Library on iOS so all file operations resolve
 * to the same base directory (Library/nodejs/data/).
 */
function getDataDirectory(): Directory {
  return Capacitor.getPlatform() === 'ios' ? Directory.Library : Directory.Data
}

/** Workspace root path, set by engine on init. */
let _workspaceRoot = 'workspace'

/** Set the workspace root path (relative to Directory.Data). */
export function setWorkspaceRoot(root: string): void {
  _workspaceRoot = root
}

/** Resolve a relative path to a full workspace path, with traversal protection. */
function resolvePath(relativePath: string): string {
  const safe = relativePath.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+/, '')

  // Block path traversal
  const parts = safe.split('/')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') return '' // Signal invalid path
    if (part !== '.' && part !== '') resolved.push(part)
  }

  return `${_workspaceRoot}/${resolved.join('/')}`
}

function isValidPath(fullPath: string): boolean {
  return fullPath.startsWith(`${_workspaceRoot}/`)
}

function toolResult(data: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    details: data,
  }
}

// ── read_file ───────────────────────────────────────────────────────────────

export async function readFileNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  const path = resolvePath(params.path as string)
  if (!isValidPath(path)) return toolResult({ error: 'Access denied: path outside workspace' })

  try {
    const result = await Filesystem.readFile({
      path,
      directory: getDataDirectory(),
      encoding: Encoding.UTF8,
    })
    return toolResult({ content: result.data as string })
  } catch (err: any) {
    return toolResult({ error: `Failed to read file: ${err.message}` })
  }
}

// ── write_file ──────────────────────────────────────────────────────────────

export async function writeFileNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  const path = resolvePath(params.path as string)
  if (!isValidPath(path)) return toolResult({ error: 'Access denied: path outside workspace' })

  try {
    await Filesystem.writeFile({
      path,
      data: params.content as string,
      directory: getDataDirectory(),
      encoding: Encoding.UTF8,
      recursive: true,
    })
    const relativePath = path.substring(_workspaceRoot.length + 1)
    return toolResult({ success: true, path: relativePath })
  } catch (err: any) {
    return toolResult({ error: `Failed to write file: ${err.message}` })
  }
}

// ── list_files ──────────────────────────────────────────────────────────────

export async function listFilesNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  const path = resolvePath((params.path as string) || '.')
  if (!isValidPath(path) && path !== `${_workspaceRoot}/`)
    return toolResult({ error: 'Access denied: path outside workspace' })

  const dirPath = path.endsWith('/') ? path.slice(0, -1) : path

  try {
    const result = await Filesystem.readdir({
      path: dirPath,
      directory: getDataDirectory(),
    })

    const entries = await Promise.all(
      result.files
        .filter((e) => !SKIP_DIRS.has(e.name))
        .map(async (e) => {
          const entry: { name: string; type: string; size?: number } = {
            name: e.name,
            type: e.type === 'directory' ? 'directory' : 'file',
          }
          if (e.type !== 'directory') {
            try {
              const stat = await Filesystem.stat({
                path: `${dirPath}/${e.name}`,
                directory: getDataDirectory(),
              })
              entry.size = stat.size || 0
            } catch {
              /* skip */
            }
          }
          return entry
        }),
    )

    return toolResult({ entries })
  } catch (err: any) {
    return toolResult({ error: `Failed to list directory: ${err.message}` })
  }
}

// ── grep_files ──────────────────────────────────────────────────────────────

export async function grepFilesNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  const searchPath = resolvePath((params.path as string) || '.')
  if (!isValidPath(searchPath) && searchPath !== `${_workspaceRoot}/`) {
    return toolResult({ error: 'Access denied: path outside workspace' })
  }

  try {
    const flags = params.case_insensitive ? 'gi' : 'g'
    const regex = new RegExp(params.pattern as string, flags)
    const matches: { file: string; line: number; content: string }[] = []
    const MAX_MATCHES = 200

    async function searchDir(dirPath: string): Promise<void> {
      if (matches.length >= MAX_MATCHES) return
      const result = await Filesystem.readdir({ path: dirPath, directory: getDataDirectory() })

      for (const entry of result.files) {
        if (matches.length >= MAX_MATCHES) return
        if (SKIP_DIRS.has(entry.name)) continue
        const fullPath = `${dirPath}/${entry.name}`

        if (entry.type === 'directory') {
          await searchDir(fullPath)
        } else {
          try {
            const file = await Filesystem.readFile({
              path: fullPath,
              directory: getDataDirectory(),
              encoding: Encoding.UTF8,
            })
            const content = file.data as string
            const lines = content.split('\n')
            const relPath = fullPath.substring(_workspaceRoot.length + 1)

            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= MAX_MATCHES) break
              regex.lastIndex = 0
              if (regex.test(lines[i])) {
                matches.push({ file: relPath, line: i + 1, content: lines[i].substring(0, 500) })
              }
            }
          } catch {
            /* skip binary/unreadable */
          }
        }
      }
    }

    // Check if searchPath is a file or directory
    const dirPath = searchPath.endsWith('/') ? searchPath.slice(0, -1) : searchPath
    try {
      const stat = await Filesystem.stat({ path: dirPath, directory: getDataDirectory() })
      if (stat.type === 'file') {
        const file = await Filesystem.readFile({
          path: dirPath,
          directory: getDataDirectory(),
          encoding: Encoding.UTF8,
        })
        const content = file.data as string
        const lines = content.split('\n')
        const relPath = dirPath.substring(_workspaceRoot.length + 1)
        for (let i = 0; i < lines.length && matches.length < MAX_MATCHES; i++) {
          regex.lastIndex = 0
          if (regex.test(lines[i])) {
            matches.push({ file: relPath, line: i + 1, content: lines[i].substring(0, 500) })
          }
        }
      } else {
        await searchDir(dirPath)
      }
    } catch {
      await searchDir(dirPath)
    }

    return toolResult({ matches, total: matches.length })
  } catch (err: any) {
    return toolResult({ error: `Search failed: ${err.message}` })
  }
}

// ── find_files ──────────────────────────────────────────────────────────────

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`, 'i')
}

export async function findFilesNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  const searchPath = resolvePath((params.path as string) || '.')
  if (!isValidPath(searchPath) && searchPath !== `${_workspaceRoot}/`) {
    return toolResult({ error: 'Access denied: path outside workspace' })
  }

  try {
    const pattern = globToRegex(params.pattern as string)
    const results: { path: string; type: string; size?: number }[] = []
    const MAX_RESULTS = 200

    async function searchDir(dirPath: string): Promise<void> {
      if (results.length >= MAX_RESULTS) return
      const result = await Filesystem.readdir({ path: dirPath, directory: getDataDirectory() })

      for (const entry of result.files) {
        if (results.length >= MAX_RESULTS) return
        if (SKIP_DIRS.has(entry.name)) continue
        const fullPath = `${dirPath}/${entry.name}`

        if (pattern.test(entry.name)) {
          const relPath = fullPath.substring(_workspaceRoot.length + 1)
          const item: { path: string; type: string; size?: number } = {
            path: relPath,
            type: entry.type === 'directory' ? 'directory' : 'file',
          }
          if (entry.type !== 'directory') {
            try {
              const stat = await Filesystem.stat({ path: fullPath, directory: getDataDirectory() })
              item.size = stat.size || 0
            } catch {
              /* skip */
            }
          }
          results.push(item)
        }

        if (entry.type === 'directory') {
          await searchDir(fullPath)
        }
      }
    }

    const dirPath = searchPath.endsWith('/') ? searchPath.slice(0, -1) : searchPath
    await searchDir(dirPath)
    return toolResult({ files: results, total: results.length })
  } catch (err: any) {
    return toolResult({ error: `Find failed: ${err.message}` })
  }
}

// ── edit_file ───────────────────────────────────────────────────────────────

export async function editFileNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  const path = resolvePath(params.path as string)
  if (!isValidPath(path)) return toolResult({ error: 'Access denied: path outside workspace' })

  try {
    const file = await Filesystem.readFile({
      path,
      directory: getDataDirectory(),
      encoding: Encoding.UTF8,
    })
    const content = file.data as string
    const oldText = params.old_text as string
    const newText = params.new_text as string

    const index = content.indexOf(oldText)
    if (index === -1) {
      return toolResult({ error: 'old_text not found in file. Use read_file to verify the exact content.' })
    }

    const newContent = content.substring(0, index) + newText + content.substring(index + oldText.length)
    await Filesystem.writeFile({
      path,
      data: newContent,
      directory: getDataDirectory(),
      encoding: Encoding.UTF8,
    })

    const relativePath = path.substring(_workspaceRoot.length + 1)
    return toolResult({ success: true, path: relativePath, replacements: 1 })
  } catch (err: any) {
    return toolResult({ error: `Failed to edit file: ${err.message}` })
  }
}
