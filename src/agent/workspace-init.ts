/**
 * Workspace initialization and system prompt — no worker dependency.
 *
 * Replaces the Node.js worker's ensureOpenClawDirs(), initDefaultFiles(),
 * and loadSystemPrompt() using @capacitor/filesystem.
 */

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

/**
 * On iOS, Capacitor-NodeJS stores data under Library/ (not Documents/).
 * Directory.Data maps to Documents/ on iOS but filesDir on Android.
 * Use Library on iOS so workspace ops align with Capacitor-NodeJS's DATADIR.
 */
function getDataDirectory(): Directory {
  return Capacitor.getPlatform() === 'ios' ? Directory.Library : Directory.Data
}

let _openclawRoot = 'nodejs/data'

export function setOpenclawRoot(root: string): void {
  _openclawRoot = root
}

export function getOpenclawRoot(): string {
  return _openclawRoot
}

export function getWorkspacePath(): string {
  return `${_openclawRoot}/workspace`
}

/**
 * Determine the openclaw root path based on platform.
 * On Android: Capacitor-NodeJS uses `nodejs/data` under Directory.Data
 * On iOS: Same convention
 * This matches what the worker used to report in `worker.ready`.
 */
export function detectOpenclawRoot(): string {
  // Both Android and iOS use the same Capacitor-NodeJS data directory convention
  return 'nodejs/data'
}

const DEFAULT_FILES: Record<string, string> = {
  'IDENTITY.md': `# Identity

You are **Claw**, an AI assistant that lives on the user's mobile device.

## Capabilities
- Read, write, and edit files in the workspace
- Search files with grep and glob patterns
- Execute JavaScript and Python code in sandboxed environments
- Manage git repositories (init, add, commit, log, diff)
- Maintain persistent memory across conversations

## Behavior
- Be concise and direct — this is a mobile device with limited screen space
- Prefer short responses unless the user asks for detail
- When using tools, explain what you're doing briefly
- Ask for approval before writing files, editing code, or committing — the user sees an approval prompt
`,
  'SOUL.md': `# Soul

You are a capable, resourceful assistant that helps users work with files, code, and projects on their mobile device.

## Core Principles
- **Accuracy over speed**: Read files before editing. Understand before acting.
- **Transparency**: When you use a tool, say what you're doing and why.
- **Respect the workspace**: Don't create unnecessary files. Don't modify what wasn't asked.
- **Security first**: Never execute code that could harm the device. Sandbox execution exists for safety.
- **Mobile-aware**: Keep responses concise. The user is on a phone.

## Tool Usage Guidelines
- Use \`read_file\` before \`edit_file\` — understand what's there first
- Use \`list_files\` to explore before assuming file locations
- Use \`grep_files\` to find specific content across the workspace
- Always explain file modifications before making them
- For code execution, prefer JavaScript unless Python is specifically needed
`,
  'MEMORY.md': `# Memory

Persistent knowledge base. Claw updates this file to remember important context across conversations.

## Long-Term Memory
You have persistent vector memory tools: memory_recall, memory_store, memory_forget, memory_search, memory_get.
Relevant memories are automatically injected into your context. Use memory/YYYY-MM-DD.md files for daily notes.

## Workspace
- Fresh workspace, no project loaded yet

## User Preferences
- (none recorded yet)
`,
}

const VAULT_ALIAS_PROMPT = `
## Vault Aliases

The user may provide sensitive information that has been replaced with vault aliases in the format \`{{VAULT:<type>_<hash>}}\`.
Examples: \`{{VAULT:cc_4521}}\`, \`{{VAULT:ssn_a3f1}}\`, \`{{VAULT:email_c9d3}}\`, \`{{VAULT:pwd_b7e2}}\`

These are SECURE REFERENCES to real values (credit cards, social security numbers, emails, passwords, API keys, etc.) stored in the device's hardware-encrypted vault (iOS Keychain / Android Keystore).

**How to use vault aliases:**
- When you need to use a vaulted value in a tool call, include the alias as-is in the tool arguments
- The system will automatically resolve aliases to real values before the tool executes, after the user authorizes biometrically
- Use aliases naturally in your responses: "I'll use your card {{VAULT:cc_4521}} for the payment"
- The user sees the original data on their end; the aliases are only visible to you

**What NOT to do:**
- Do not try to guess or infer what a vault alias contains
- Do not ask the user to re-enter sensitive data that was already vaulted
- Do not persist vault aliases to files or memory — they are ephemeral session references
- Do not attempt to decode, reverse, or manipulate the alias format
`

/**
 * Ensure all required directories exist.
 */
export async function ensureWorkspaceDirs(): Promise<void> {
  const dirs = [
    _openclawRoot,
    `${_openclawRoot}/agents/main/agent`,
    `${_openclawRoot}/agents/main/sessions`,
    `${_openclawRoot}/workspace`,
    `${_openclawRoot}/workspace/.openclaw`,
  ]

  for (const dir of dirs) {
    try {
      await Filesystem.mkdir({
        path: dir,
        directory: getDataDirectory(),
        recursive: true,
      })
    } catch (err: any) {
      // "Directory exists" is not an error
      if (!err?.message?.includes('exist')) {
        console.warn(`[workspace] mkdir failed for ${dir}:`, err?.message)
      }
    }
  }
}

/**
 * Create default workspace files if they don't exist.
 */
export async function initDefaultFiles(): Promise<void> {
  const wsRoot = `${_openclawRoot}/workspace`

  for (const [filename, content] of Object.entries(DEFAULT_FILES)) {
    try {
      await Filesystem.stat({
        path: `${wsRoot}/${filename}`,
        directory: getDataDirectory(),
      })
      // File exists, skip
    } catch {
      // File doesn't exist, create it
      await Filesystem.writeFile({
        path: `${wsRoot}/${filename}`,
        data: content,
        directory: getDataDirectory(),
        encoding: Encoding.UTF8,
        recursive: true,
      })
    }
  }

  // Create default auth-profiles.json if it doesn't exist
  const authPath = `${_openclawRoot}/agents/main/agent/auth-profiles.json`
  try {
    await Filesystem.stat({ path: authPath, directory: getDataDirectory() })
  } catch {
    await Filesystem.writeFile({
      path: authPath,
      data: JSON.stringify({ version: 1, profiles: {}, lastGood: {}, usageStats: {} }, null, 2),
      directory: getDataDirectory(),
      encoding: Encoding.UTF8,
      recursive: true,
    })
  }

  // Create default openclaw.json if it doesn't exist
  const configPath = `${_openclawRoot}/openclaw.json`
  try {
    await Filesystem.stat({ path: configPath, directory: getDataDirectory() })
  } catch {
    await Filesystem.writeFile({
      path: configPath,
      data: JSON.stringify(
        {
          gateway: { port: 18789 },
          agents: {
            defaults: {
              model: { primary: 'anthropic/claude-sonnet-4-5' },
            },
            list: [{ id: 'main', default: true }],
          },
        },
        null,
        2,
      ),
      directory: getDataDirectory(),
      encoding: Encoding.UTF8,
      recursive: true,
    })
  }
}

/**
 * Load the system prompt from workspace files (IDENTITY.md, SOUL.md, MEMORY.md).
 */
export async function loadSystemPrompt(): Promise<string> {
  const wsRoot = `${_openclawRoot}/workspace`
  let systemPrompt = ''

  for (const [filename, prefix] of [
    ['IDENTITY.md', ''],
    ['SOUL.md', ''],
    ['MEMORY.md', '## Memory\n'],
  ] as const) {
    try {
      const result = await Filesystem.readFile({
        path: `${wsRoot}/${filename}`,
        directory: getDataDirectory(),
        encoding: Encoding.UTF8,
      })
      const content = result.data as string
      if (content) {
        systemPrompt += `${prefix + content}\n\n`
      }
    } catch {
      // File doesn't exist, skip
    }
  }

  if (!systemPrompt) {
    systemPrompt = 'You are a helpful AI assistant running on a mobile device.'
  }

  systemPrompt += VAULT_ALIAS_PROMPT
  return systemPrompt
}

/**
 * Curated model lists by provider.
 */
const CURATED_MODELS: Record<string, Array<{ id: string; name: string; description: string; default?: boolean }>> = {
  anthropic: [
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', description: 'Fast and capable', default: true },
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Quick and lightweight' },
    { id: 'claude-opus-4', name: 'Claude Opus 4', description: 'Most capable' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', description: 'Fast and capable', default: true },
    { id: 'openai/gpt-4o', name: 'GPT-4o', description: "OpenAI's flagship" },
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
    { id: 'openai/o4-mini', name: 'o4 Mini', description: 'Reasoning model' },
    { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Google — fast' },
    { id: 'google/gemini-2.5-pro', name: 'Gemini 2.5 Pro', description: 'Google — powerful' },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', description: 'Efficient and capable' },
    { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', description: 'Open-source' },
    { id: 'x-ai/grok-4', name: 'Grok 4', description: 'xAI model' },
    { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B', description: 'Large MoE model' },
  ],
  openai: [
    { id: 'gpt-4o', name: 'GPT-4o', description: "OpenAI's flagship", default: true },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast and affordable' },
    { id: 'o4-mini', name: 'o4 Mini', description: 'Reasoning model' },
  ],
}

export function getModels(
  provider = 'anthropic',
): Array<{ id: string; name: string; description: string; default?: boolean }> {
  return CURATED_MODELS[provider] || CURATED_MODELS.anthropic
}

/**
 * Full workspace initialization: create dirs, default files, configure tools.
 */
export async function initWorkspace(): Promise<{ openclawRoot: string }> {
  const root = detectOpenclawRoot()
  setOpenclawRoot(root)
  await ensureWorkspaceDirs()
  await initDefaultFiles()
  return { openclawRoot: root }
}
