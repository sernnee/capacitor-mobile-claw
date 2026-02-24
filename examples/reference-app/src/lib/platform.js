import { Capacitor } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()
export const platform = Capacitor.getPlatform() // 'web' | 'ios' | 'android'

export async function copyToClipboard(text) {
  if (isNative) {
    const { Clipboard } = await import('@capacitor/clipboard')
    await Clipboard.write({ string: text })
  } else {
    await navigator.clipboard.writeText(text)
  }
}
