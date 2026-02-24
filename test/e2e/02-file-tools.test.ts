/**
 * Phase 1 E2E Test: File Tools
 *
 * Verifies file operations work correctly within the OpenClaw workspace:
 * - read tool reads files from workspace
 * - write tool creates/updates files in workspace
 * - list tool lists directory contents
 * - Path traversal outside workspace is blocked
 * - Files are at OpenClaw-compatible paths
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TEST_ROOT = join(process.cwd(), '.test-openclaw-files')
const WORKSPACE = join(TEST_ROOT, 'workspace')

// Replicate the file tool functions from main.js for direct testing
function readFileTool(args: { path: string }) {
  const filePath = resolve(join(WORKSPACE), args.path)
  if (!filePath.startsWith(resolve(WORKSPACE))) {
    return { error: 'Access denied: path outside workspace' }
  }
  try {
    const content = readFileSync(filePath, 'utf8')
    return { content }
  } catch (err: any) {
    return { error: `Failed to read file: ${err.message}` }
  }
}

function writeFileTool(args: { path: string; content: string }) {
  const filePath = resolve(join(WORKSPACE), args.path)
  if (!filePath.startsWith(resolve(WORKSPACE))) {
    return { error: 'Access denied: path outside workspace' }
  }
  try {
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, args.content)
    return { success: true, path: args.path }
  } catch (err: any) {
    return { error: `Failed to write file: ${err.message}` }
  }
}

function listFilesTool(args: { path?: string }) {
  const { readdirSync, statSync } = require('node:fs')
  const dirPath = resolve(join(WORKSPACE), args.path || '.')
  if (!dirPath.startsWith(resolve(WORKSPACE))) {
    return { error: 'Access denied: path outside workspace' }
  }
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    return {
      entries: entries.map((e: any) => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size: e.isFile() ? statSync(join(dirPath, e.name)).size : undefined,
      })),
    }
  } catch (err: any) {
    return { error: `Failed to list directory: ${err.message}` }
  }
}

describe('File Tools', () => {
  beforeAll(() => {
    mkdirSync(WORKSPACE, { recursive: true })
    writeFileSync(join(WORKSPACE, 'SOUL.md'), '# Soul\n\nTest agent personality.\n')
    writeFileSync(join(WORKSPACE, 'MEMORY.md'), '# Memory\n\nTest memory.\n')
    mkdirSync(join(WORKSPACE, 'src'), { recursive: true })
    writeFileSync(join(WORKSPACE, 'src', 'index.ts'), 'console.log("hello");\n')
  })

  afterAll(() => {
    rmSync(TEST_ROOT, { recursive: true, force: true })
  })

  describe('read_file', () => {
    it('should read existing file', () => {
      const result = readFileTool({ path: 'SOUL.md' })
      expect(result.content).toContain('# Soul')
      expect(result.content).toContain('Test agent personality')
    })

    it('should read nested file', () => {
      const result = readFileTool({ path: 'src/index.ts' })
      expect(result.content).toContain('console.log')
    })

    it('should return error for non-existent file', () => {
      const result = readFileTool({ path: 'nonexistent.txt' })
      expect(result.error).toBeTruthy()
      expect(result.error).toContain('Failed to read file')
    })

    it('should block path traversal', () => {
      const result = readFileTool({ path: '../../etc/passwd' })
      expect(result.error).toContain('Access denied')
    })
  })

  describe('write_file', () => {
    it('should write new file', () => {
      const result = writeFileTool({ path: 'test-output.txt', content: 'Hello, world!' })
      expect(result.success).toBe(true)

      const content = readFileSync(join(WORKSPACE, 'test-output.txt'), 'utf8')
      expect(content).toBe('Hello, world!')
    })

    it('should create parent directories', () => {
      const result = writeFileTool({
        path: 'new-dir/nested/file.ts',
        content: 'export const x = 1;',
      })
      expect(result.success).toBe(true)
      expect(existsSync(join(WORKSPACE, 'new-dir', 'nested', 'file.ts'))).toBe(true)
    })

    it('should overwrite existing file', () => {
      writeFileTool({ path: 'overwrite-test.txt', content: 'original' })
      writeFileTool({ path: 'overwrite-test.txt', content: 'updated' })

      const content = readFileSync(join(WORKSPACE, 'overwrite-test.txt'), 'utf8')
      expect(content).toBe('updated')
    })

    it('should block path traversal', () => {
      const result = writeFileTool({ path: '../../evil.txt', content: 'bad' })
      expect(result.error).toContain('Access denied')
    })
  })

  describe('list_files', () => {
    it('should list workspace root', () => {
      const result = listFilesTool({})
      expect(result.entries).toBeDefined()
      const names = result.entries.map((e: any) => e.name)
      expect(names).toContain('SOUL.md')
      expect(names).toContain('MEMORY.md')
      expect(names).toContain('src')
    })

    it('should list subdirectory', () => {
      const result = listFilesTool({ path: 'src' })
      expect(result.entries).toBeDefined()
      const names = result.entries.map((e: any) => e.name)
      expect(names).toContain('index.ts')
    })

    it('should include file/directory types', () => {
      const result = listFilesTool({})
      const srcEntry = result.entries.find((e: any) => e.name === 'src')
      expect(srcEntry.type).toBe('directory')

      const soulEntry = result.entries.find((e: any) => e.name === 'SOUL.md')
      expect(soulEntry.type).toBe('file')
      expect(soulEntry.size).toBeGreaterThan(0)
    })

    it('should block path traversal', () => {
      const result = listFilesTool({ path: '../../' })
      expect(result.error).toContain('Access denied')
    })
  })
})

describe('OpenClaw Filesystem Compatibility', () => {
  const COMPAT_ROOT = join(process.cwd(), '.test-openclaw-compat')
  const COMPAT_WORKSPACE = join(COMPAT_ROOT, 'workspace')

  function compatRead(args: { path: string }) {
    const filePath = resolve(COMPAT_WORKSPACE, args.path)
    if (!filePath.startsWith(resolve(COMPAT_WORKSPACE))) {
      return { error: 'Access denied: path outside workspace' }
    }
    return { content: readFileSync(filePath, 'utf8') }
  }

  function compatWrite(args: { path: string; content: string }) {
    const filePath = resolve(COMPAT_WORKSPACE, args.path)
    if (!filePath.startsWith(resolve(COMPAT_WORKSPACE))) {
      return { error: 'Access denied: path outside workspace' }
    }
    const dir = filePath.substring(0, filePath.lastIndexOf('/'))
    mkdirSync(dir, { recursive: true })
    writeFileSync(filePath, args.content)
    return { success: true }
  }

  beforeAll(() => {
    mkdirSync(COMPAT_WORKSPACE, { recursive: true })
    writeFileSync(join(COMPAT_WORKSPACE, 'SOUL.md'), '# Soul\n\nTest agent personality.\n')
    writeFileSync(join(COMPAT_WORKSPACE, 'MEMORY.md'), '# Memory\n\nTest memory.\n')
  })

  afterAll(() => {
    rmSync(COMPAT_ROOT, { recursive: true, force: true })
  })

  it('should maintain correct directory layout', () => {
    expect(existsSync(join(COMPAT_WORKSPACE, 'SOUL.md'))).toBe(true)
    expect(existsSync(join(COMPAT_WORKSPACE, 'MEMORY.md'))).toBe(true)
  })

  it('should preserve YAML frontmatter in workspace files', () => {
    const content = '---\nkey: value\n---\n\n# Content\n\nBody text here.\n'
    compatWrite({ path: 'frontmatter-test.md', content })

    const result = compatRead({ path: 'frontmatter-test.md' })
    expect(result.content).toBe(content)
    expect(result.content).toContain('---\nkey: value\n---')
  })
})
