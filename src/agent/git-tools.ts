/**
 * Native git tools using isomorphic-git + @capacitor/filesystem.
 *
 * Replaces the Node.js worker's git tools (git_init, git_status, git_add,
 * git_commit, git_log, git_diff) with isomorphic-git running in the WebView
 * using a Capacitor filesystem adapter.
 */

import type { AgentToolResult } from '@mariozechner/pi-agent-core'
import git from 'isomorphic-git'
import { capacitorFs } from './capacitor-fs-adapter'

/** Workspace root path, set by engine on init. */
let _workspaceDir = ''

/** Set the workspace directory (absolute path for isomorphic-git). */
export function setWorkspaceDir(dir: string): void {
  _workspaceDir = dir
}

function toolResult(data: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    details: data,
  }
}

// ── git_init ────────────────────────────────────────────────────────────────

export async function gitInitNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  const defaultBranch = (params.default_branch as string) || 'main'
  try {
    await git.init({ fs: capacitorFs, dir: _workspaceDir, defaultBranch })

    // Auto-create .gitignore if it doesn't exist
    try {
      await capacitorFs.promises.readFile(`${_workspaceDir}/.gitignore`, { encoding: 'utf8' })
    } catch {
      await capacitorFs.promises.writeFile(`${_workspaceDir}/.gitignore`, '.openclaw/\n', { encoding: 'utf8' })
    }

    return toolResult({ success: true, message: `Initialized git repository with branch "${defaultBranch}"` })
  } catch (err: any) {
    return toolResult({ error: `Failed to initialize git: ${err.message}` })
  }
}

// ── git_status ──────────────────────────────────────────────────────────────

export async function gitStatusNative(_params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  try {
    const matrix = await git.statusMatrix({ fs: capacitorFs, dir: _workspaceDir })
    const files = matrix
      .map(([filepath, head, workdir, stage]: [string, number, number, number]) => {
        let status = 'unmodified'
        if (head === 0 && workdir === 2 && stage === 0) status = 'untracked'
        else if (head === 0 && workdir === 2 && stage === 2) status = 'added'
        else if (head === 0 && workdir === 2 && stage === 3) status = 'added (modified)'
        else if (head === 1 && workdir === 2 && stage === 1) status = 'modified (unstaged)'
        else if (head === 1 && workdir === 2 && stage === 2) status = 'modified (staged)'
        else if (head === 1 && workdir === 2 && stage === 3) status = 'modified (staged + unstaged)'
        else if (head === 1 && workdir === 0 && stage === 0) status = 'deleted (unstaged)'
        else if (head === 1 && workdir === 0 && stage === 1) status = 'deleted (staged)'
        return { path: filepath, status }
      })
      .filter((f: { status: string }) => f.status !== 'unmodified')
    return toolResult({ files })
  } catch (err: any) {
    return toolResult({ error: `Failed to get status: ${err.message}` })
  }
}

// ── git_add ─────────────────────────────────────────────────────────────────

export async function gitAddNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  try {
    if (params.path === '.') {
      const matrix = await git.statusMatrix({ fs: capacitorFs, dir: _workspaceDir })
      for (const [filepath, head, workdir, stage] of matrix) {
        if (workdir === 0) {
          await git.remove({ fs: capacitorFs, dir: _workspaceDir, filepath })
        } else if (head !== workdir || workdir !== stage) {
          await git.add({ fs: capacitorFs, dir: _workspaceDir, filepath })
        }
      }
      return toolResult({ success: true, message: 'All changes staged' })
    } else {
      await git.add({ fs: capacitorFs, dir: _workspaceDir, filepath: params.path as string })
      return toolResult({ success: true, path: params.path })
    }
  } catch (err: any) {
    return toolResult({ error: `Failed to stage: ${err.message}` })
  }
}

// ── git_commit ──────────────────────────────────────────────────────────────

export async function gitCommitNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  try {
    const sha = await git.commit({
      fs: capacitorFs,
      dir: _workspaceDir,
      message: params.message as string,
      author: {
        name: (params.author_name as string) || 'mobile-claw',
        email: (params.author_email as string) || 'agent@mobile-claw.local',
      },
    })
    return toolResult({ success: true, sha, message: params.message })
  } catch (err: any) {
    return toolResult({ error: `Failed to commit: ${err.message}` })
  }
}

// ── git_log ─────────────────────────────────────────────────────────────────

export async function gitLogNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  try {
    const commits = await git.log({
      fs: capacitorFs,
      dir: _workspaceDir,
      depth: (params.max_count as number) || 10,
    })
    return toolResult({
      commits: commits.map((c) => ({
        sha: c.oid,
        message: c.commit.message,
        author: c.commit.author.name,
        email: c.commit.author.email,
        timestamp: new Date(c.commit.author.timestamp * 1000).toISOString(),
      })),
    })
  } catch (err: any) {
    return toolResult({ error: `Failed to get log: ${err.message}` })
  }
}

// ── git_diff ────────────────────────────────────────────────────────────────

export async function gitDiffNative(params: Record<string, unknown>): Promise<AgentToolResult<unknown>> {
  try {
    const matrix = await git.statusMatrix({ fs: capacitorFs, dir: _workspaceDir })
    const changes: { path: string; previous: string | null; current: string | null; type: string }[] = []

    let headOid: string | null = null
    try {
      headOid = await git.resolveRef({ fs: capacitorFs, dir: _workspaceDir, ref: 'HEAD' })
    } catch {
      /* no commits yet */
    }

    for (const [filepath, head, workdir, stage] of matrix) {
      const isRelevant = params.cached ? stage !== head : workdir !== stage
      if (!isRelevant) continue

      let currentContent: string | null = null
      try {
        currentContent = (await capacitorFs.promises.readFile(`${_workspaceDir}/${filepath}`, {
          encoding: 'utf8',
        })) as string
      } catch {
        /* file deleted */
      }

      let previousContent: string | null = null
      if (headOid) {
        try {
          const { blob } = await git.readBlob({ fs: capacitorFs, dir: _workspaceDir, oid: headOid, filepath })
          previousContent = new TextDecoder().decode(blob)
        } catch {
          /* new file */
        }
      }

      changes.push({
        path: filepath,
        previous: previousContent ? previousContent.substring(0, 2000) : null,
        current: currentContent ? currentContent.substring(0, 2000) : null,
        type: !previousContent ? 'added' : !currentContent ? 'deleted' : 'modified',
      })
    }

    return toolResult({ changes })
  } catch (err: any) {
    return toolResult({ error: `Failed to get diff: ${err.message}` })
  }
}
