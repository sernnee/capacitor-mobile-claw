/**
 * Auth profile management via @capacitor/filesystem.
 *
 * Replaces the Node.js worker's auth-profiles.json file operations.
 * Reads/writes auth profiles directly from the WebView.
 */

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

function getDataDirectory(): Directory {
  return Capacitor.getPlatform() === 'ios' ? Directory.Library : Directory.Data
}

interface AuthProfile {
  provider: string
  type: 'oauth' | 'api_key'
  key?: string
  access?: string
  refresh?: string
  [key: string]: unknown
}

interface AuthProfiles {
  version: number
  profiles: Record<string, AuthProfile>
  lastGood: Record<string, string>
  usageStats: Record<string, unknown>
}

let _openclawRoot = 'nodejs/data'

export function setAuthRoot(root: string): void {
  _openclawRoot = root
}

function authProfilesPath(agentId = 'main'): string {
  return `${_openclawRoot}/agents/${agentId}/agent/auth-profiles.json`
}

async function loadAuthProfiles(agentId = 'main'): Promise<AuthProfiles> {
  try {
    const result = await Filesystem.readFile({
      path: authProfilesPath(agentId),
      directory: getDataDirectory(),
      encoding: Encoding.UTF8,
    })
    return JSON.parse(result.data as string)
  } catch {
    return { version: 1, profiles: {}, lastGood: {}, usageStats: {} }
  }
}

async function saveAuthProfiles(profiles: AuthProfiles, agentId = 'main'): Promise<void> {
  await Filesystem.writeFile({
    path: authProfilesPath(agentId),
    data: JSON.stringify(profiles, null, 2),
    directory: getDataDirectory(),
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

function resolveApiKeyForProvider(authProfiles: AuthProfiles, provider: string): string | null {
  // Prefer lastGood profile for this provider
  const lastGoodKey = authProfiles.lastGood?.[provider]
  if (lastGoodKey && authProfiles.profiles[lastGoodKey]) {
    const p = authProfiles.profiles[lastGoodKey]
    if (p.provider === provider) {
      if (p.type === 'oauth' && p.access) return p.access
      if (p.type === 'api_key' && p.key) return p.key
    }
  }
  // Fallback: scan profiles (prefer oauth over api_key for anthropic)
  let fallbackApiKey: string | null = null
  for (const profile of Object.values(authProfiles.profiles)) {
    if (profile.provider !== provider) continue
    if (profile.type === 'oauth' && profile.access) return profile.access
    if (profile.type === 'api_key' && profile.key && !fallbackApiKey) {
      fallbackApiKey = profile.key
    }
  }
  return fallbackApiKey
}

/**
 * Get the API key for a provider. Returns { apiKey, isOAuth }.
 */
export async function getAuthToken(
  provider = 'anthropic',
  agentId = 'main',
): Promise<{ apiKey: string | null; isOAuth: boolean }> {
  const profiles = await loadAuthProfiles(agentId)
  const apiKey = resolveApiKeyForProvider(profiles, provider)
  const isOAuth = apiKey ? apiKey.startsWith('sk-ant-oat') : false
  return { apiKey, isOAuth }
}

/**
 * Set an API key or OAuth token for a provider.
 */
export async function setAuthKey(
  key: string,
  provider = 'anthropic',
  agentId = 'main',
  type: 'api_key' | 'oauth' = 'api_key',
): Promise<void> {
  const profiles = await loadAuthProfiles(agentId)
  const profileId = `${provider}-${type}`
  profiles.profiles[profileId] = {
    provider,
    type,
    ...(type === 'oauth' ? { access: key } : { key }),
  }
  profiles.lastGood[provider] = profileId
  await saveAuthProfiles(profiles, agentId)
}

/**
 * Delete auth for a provider.
 */
export async function deleteAuth(provider = 'anthropic', agentId = 'main'): Promise<void> {
  const profiles = await loadAuthProfiles(agentId)
  for (const [id, profile] of Object.entries(profiles.profiles)) {
    if (profile.provider === provider) {
      delete profiles.profiles[id]
    }
  }
  delete profiles.lastGood[provider]
  await saveAuthProfiles(profiles, agentId)
}

/**
 * Get auth status (has key, masked key) for a provider.
 */
export async function getAuthStatus(
  provider = 'anthropic',
): Promise<{ hasKey: boolean; masked: string; provider: string }> {
  const profiles = await loadAuthProfiles('main')
  let hasKey = false
  let masked = ''
  for (const profile of Object.values(profiles.profiles)) {
    if (profile.provider === provider) {
      const key = profile.key || profile.access || ''
      if (key) {
        hasKey = true
        masked = key.length > 11 ? `${key.substring(0, 7)}***${key.substring(key.length - 4)}` : '***'
        break
      }
    }
  }
  return { hasKey, masked, provider }
}
