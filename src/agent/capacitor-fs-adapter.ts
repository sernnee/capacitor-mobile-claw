/**
 * Capacitor Filesystem adapter for isomorphic-git.
 *
 * isomorphic-git accepts a custom `fs` parameter with a `promises` namespace.
 * This adapter wraps @capacitor/filesystem to provide the required interface:
 *   - readFile, writeFile, mkdir, rmdir, unlink, stat, lstat, readdir
 *
 * All paths are absolute (relative to app data root). isomorphic-git passes
 * absolute paths when `dir` is set.
 */

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

/**
 * Convert an absolute-looking path to a path relative to Directory.Data.
 * isomorphic-git will pass paths like "/workspace/.git/HEAD" — we strip
 * the leading slash and use Directory.Data as the base.
 */
function toRelative(p: string): string {
  return p.replace(/^\/+/, '').replace(/\/+$/, '')
}

/**
 * Wrap a Capacitor Filesystem error so isomorphic-git recognises "not found".
 * isomorphic-git checks `err.code === 'ENOENT'` in its `exists()` helper;
 * without this, any stat on a missing file is treated as an unexpected error
 * and propagates up, breaking git.init() and other operations.
 */
function rethrowAsEnoent(err: unknown): never {
  const msg = (err as any)?.message ?? ''
  if (msg.includes('does not exist') || msg.includes('not found')) {
    const e: any = new Error(msg)
    e.code = 'ENOENT'
    throw e
  }
  throw err
}

const promises = {
  async readFile(filepath: string, opts?: { encoding?: string } | string): Promise<string | Uint8Array> {
    const encoding = typeof opts === 'string' ? opts : opts?.encoding
    const path = toRelative(filepath)

    try {
      if (encoding === 'utf8') {
        const result = await Filesystem.readFile({
          path,
          directory: Directory.Data,
          encoding: Encoding.UTF8,
        })
        return result.data as string
      }

      // Binary read — return Uint8Array
      const result = await Filesystem.readFile({
        path,
        directory: Directory.Data,
      })

      // Capacitor returns base64 string for binary reads
      const base64 = result.data as string
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      return bytes
    } catch (err) {
      rethrowAsEnoent(err)
    }
  },

  async writeFile(
    filepath: string,
    data: string | Uint8Array,
    _opts?: { encoding?: string; mode?: number } | string,
  ): Promise<void> {
    const path = toRelative(filepath)

    if (typeof data === 'string') {
      // Write strings as UTF-8 text regardless of encoding option.
      // isomorphic-git sometimes passes no encoding for text files (e.g. HEAD, config).
      await Filesystem.writeFile({
        path,
        data,
        directory: Directory.Data,
        encoding: Encoding.UTF8,
        recursive: true,
      })
    } else {
      // Uint8Array → base64
      let binary = ''
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i])
      }
      const base64 = btoa(binary)
      await Filesystem.writeFile({
        path,
        data: base64,
        directory: Directory.Data,
        recursive: true,
      })
    }
  },

  async mkdir(filepath: string, _opts?: { recursive?: boolean }): Promise<void> {
    const path = toRelative(filepath)
    try {
      await Filesystem.mkdir({
        path,
        directory: Directory.Data,
        recursive: true,
      })
    } catch (err: any) {
      // "Directory exists" is not an error
      if (err?.message?.includes('exist')) return
      throw err
    }
  },

  async rmdir(filepath: string, _opts?: { recursive?: boolean }): Promise<void> {
    const path = toRelative(filepath)
    await Filesystem.rmdir({
      path,
      directory: Directory.Data,
      recursive: true,
    })
  },

  async unlink(filepath: string): Promise<void> {
    const path = toRelative(filepath)
    await Filesystem.deleteFile({
      path,
      directory: Directory.Data,
    })
  },

  async stat(filepath: string): Promise<{
    type: string
    mode: number
    size: number
    ino: number
    mtimeMs: number
    ctimeMs: number
    uid: number
    gid: number
    dev: number
    isFile: () => boolean
    isDirectory: () => boolean
    isSymbolicLink: () => boolean
  }> {
    const path = toRelative(filepath)
    try {
      const result = await Filesystem.stat({
        path,
        directory: Directory.Data,
      })

      const isDir = result.type === 'directory'
      const mtime = result.mtime ? new Date(result.mtime).getTime() : Date.now()

      return {
        type: isDir ? 'dir' : 'file',
        mode: isDir ? 0o40755 : 0o100644,
        size: result.size || 0,
        ino: 0,
        mtimeMs: mtime,
        ctimeMs: mtime,
        uid: 1,
        gid: 1,
        dev: 1,
        isFile: () => !isDir,
        isDirectory: () => isDir,
        isSymbolicLink: () => false,
      }
    } catch (err) {
      rethrowAsEnoent(err)
    }
  },

  async lstat(filepath: string) {
    return promises.stat(filepath)
  },

  async readdir(filepath: string): Promise<string[]> {
    const path = toRelative(filepath)
    const result = await Filesystem.readdir({
      path,
      directory: Directory.Data,
    })
    // Strip trailing slashes that Android Capacitor Filesystem appends to directory names.
    // isomorphic-git calls stat() on each returned name; a trailing slash causes stat to
    // look for a directory at "name/" which doesn't exist as a path component.
    return result.files.map((f) => f.name.replace(/\/$/, ''))
  },

  async readlink(_filepath: string): Promise<string> {
    throw new Error('readlink not supported')
  },

  async symlink(_target: string, _filepath: string): Promise<void> {
    throw new Error('symlink not supported')
  },

  async chmod(_filepath: string, _mode: number): Promise<void> {
    // No-op on mobile
  },
}

/**
 * The fs adapter object for isomorphic-git.
 * Usage: `git.init({ fs: capacitorFs, dir: '/workspace' })`
 */
export const capacitorFs = { promises }
