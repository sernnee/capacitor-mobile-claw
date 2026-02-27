#!/usr/bin/env node
/**
 * patch-sqlite-ios.mjs — Postinstall patch for @capacitor-community/sqlite SPM support.
 *
 * @capacitor-community/sqlite@8.x lacks:
 *   1. Package.swift (no SPM support — PR #673 open upstream)
 *   2. CAPBridgedPlugin protocol conformance (required for Capacitor 8 SPM plugin registration)
 *
 * This script patches node_modules in-place. Idempotent — skips if already patched.
 * When upstream PR #673 merges, the Package.swift check becomes a no-op.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SQLITE_ROOT = join(__dirname, '..', 'node_modules', '@capacitor-community', 'sqlite')

if (!existsSync(SQLITE_ROOT)) {
  console.log('[patch-sqlite-ios] @capacitor-community/sqlite not installed — skipping')
  process.exit(0)
}

let patchCount = 0

// ── 1. Package.swift ──────────────────────────────────────────────────────

const packageSwiftPath = join(SQLITE_ROOT, 'Package.swift')

if (existsSync(packageSwiftPath)) {
  console.log('[patch-sqlite-ios] Package.swift already exists — skipping')
} else {
  const packageSwift = `// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "CapacitorCommunitySqlite",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapacitorCommunitySqlite",
            targets: ["CapacitorSQLitePlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", from: "8.0.0"),
        .package(url: "https://github.com/sqlcipher/SQLCipher.swift.git", from: "4.12.0"),
        .package(url: "https://github.com/weichsel/ZIPFoundation.git", from: "0.9.20")
    ],
    targets: [
        .target(
            name: "CapacitorSQLitePlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "SQLCipher", package: "SQLCipher.swift"),
                .product(name: "ZIPFoundation", package: "ZIPFoundation")
            ],
            path: "ios/Plugin",
            exclude: ["CapacitorSQLitePlugin.h", "CapacitorSQLitePlugin.m", "Info.plist"])
    ]
)
`
  writeFileSync(packageSwiftPath, packageSwift)
  console.log('[patch-sqlite-ios] Created Package.swift')
  patchCount++
}

// ── 2. CAPBridgedPlugin conformance ───────────────────────────────────────

const pluginSwiftPath = join(SQLITE_ROOT, 'ios', 'Plugin', 'CapacitorSQLitePlugin.swift')

if (!existsSync(pluginSwiftPath)) {
  console.log('[patch-sqlite-ios] CapacitorSQLitePlugin.swift not found — skipping CAPBridgedPlugin patch')
} else {
  const src = readFileSync(pluginSwiftPath, 'utf8')

  if (src.includes('CAPBridgedPlugin')) {
    console.log('[patch-sqlite-ios] CAPBridgedPlugin already present — skipping')
  } else {
    // Replace class declaration to add CAPBridgedPlugin conformance + required properties
    const oldDecl = `@objc(CapacitorSQLitePlugin)
// swiftlint:disable file_length
// swiftlint:disable type_body_length
public class CapacitorSQLitePlugin: CAPPlugin {`

    const newDecl = `@objc(CapacitorSQLitePlugin)
// swiftlint:disable file_length
// swiftlint:disable type_body_length
public class CapacitorSQLitePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapacitorSQLitePlugin"
    public let jsName = "CapacitorSQLite"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "echo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createNCConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeNCConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNCDatabasePath", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getVersion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "execute", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "executeSet", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "run", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isDBExists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isDBOpen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteDatabase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "importFromJson", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isJsonValid", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exportToJson", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteExportedRows", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "createSyncTable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSyncDate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSyncDate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addUpgradeStatement", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "copyFromAssets", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isDatabase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isNCDatabase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isTableExists", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getDatabaseList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getTableList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getMigratableDbList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "addSQLiteSuffix", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteOldDatabases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "moveDatabasesAndAddSuffix", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkConnectionsConsistency", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSecretStored", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEncryptionSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "changeEncryptionSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearEncryptionSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getFromHTTPRequest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkEncryptionSecret", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isInConfigEncryption", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isInConfigBiometricAuth", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isDatabaseEncrypted", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "beginTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "commitTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "rollbackTransaction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isTransactionActive", returnType: CAPPluginReturnPromise),
    ]`

    if (!src.includes(oldDecl)) {
      console.error('[patch-sqlite-ios] Could not find expected class declaration — skipping')
      console.error('[patch-sqlite-ios] The plugin source may have been updated. Manual review needed.')
    } else {
      const patched = src.replace(oldDecl, newDecl)
      writeFileSync(pluginSwiftPath, patched)
      console.log('[patch-sqlite-ios] Patched CapacitorSQLitePlugin.swift with CAPBridgedPlugin')
      patchCount++
    }
  }
}

if (patchCount > 0) {
  console.log(`[patch-sqlite-ios] Applied ${patchCount} patch(es)`)
} else {
  console.log('[patch-sqlite-ios] No patches needed')
}
