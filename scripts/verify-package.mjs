import { builtinModules, createRequire } from "node:module"
import { existsSync, readFileSync, statSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

const builtinNames = new Set([
    ...builtinModules,
    ...builtinModules.map((name) => name.replace(/^node:/, "")),
])

const requiredRepoFiles = [
    "dist/index.js",
    "dist/index.d.ts",
    "dist/tui.js",
    "dist/tui.d.ts",
    "dcp.schema.json",
    "dcp.example.jsonc",
    "README.md",
    "LICENSE",
]

const requiredTarballFiles = [
    "package.json",
    "dist/index.js",
    "dist/index.d.ts",
    "dist/tui.js",
    "dist/tui.d.ts",
    "dcp.schema.json",
    "dcp.example.jsonc",
    "README.md",
    "LICENSE",
]

const forbiddenTarballPatterns = [
    /^node_modules\//,
    /^lib\//, // TUI and plugin are bundled; raw TS source must not ship
    /^index\.ts$/,
    /^tui\.tsx$/,
    /^server\.js$/,
    /^tests\//,
    /^scripts\//,
    /^docs\//,
    /^assets\//,
    /^notes\//,
    /^\.github\//,
    /^package-lock\.json$/,
    /^tsconfig\.json$/,
    /^tsup\.config\.ts$/,
]

const packageInfoCache = new Map()

function fail(message) {
    console.error(`package verification failed: ${message}`)
    process.exit(1)
}

function assertRepoFilesExist() {
    for (const relativePath of requiredRepoFiles) {
        if (!existsSync(path.join(root, relativePath))) {
            fail(`missing required file: ${relativePath}`)
        }
    }
}

function assertPackageJsonShape() {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))

    if (pkg.main !== "./dist/index.js") {
        fail(`package.json main must remain ./dist/index.js, found ${pkg.main ?? "<missing>"}`)
    }

    if (pkg.exports?.["."]?.import !== "./dist/index.js") {
        fail("expected package.json exports['.'].import to be './dist/index.js'")
    }

    if (pkg.exports?.["./server"] !== undefined) {
        fail("package.json must not export './server' (the V1 server path was removed)")
    }

    if (pkg.exports?.["./tui"]?.import !== "./dist/tui.js") {
        fail("expected package.json exports['./tui'].import to be './dist/tui.js'")
    }

    const files = Array.isArray(pkg.files) ? pkg.files : []
    for (const entry of ["dist/", "dcp.schema.json", "dcp.example.jsonc", "README.md", "LICENSE"]) {
        if (!files.includes(entry)) {
            fail(`package.json files must include ${entry}`)
        }
    }
    for (const forbidden of ["lib/", "tui.tsx", "server.js"]) {
        if (files.includes(forbidden)) {
            fail(`package.json files must not include ${forbidden} (bundled output ships instead)`)
        }
    }
}

function getImportStatements(source) {
    const entries = []
    // Static imports (including multiline and side-effect/namespace forms).
    const staticPattern = /\bimport\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/g
    for (const match of source.matchAll(staticPattern)) {
        entries.push({ clause: match[1].trim(), specifier: match[2] })
    }
    // Side-effect imports: import "pkg"
    const sideEffectPattern = /\bimport\s*["']([^"']+)["']/g
    for (const match of source.matchAll(sideEffectPattern)) {
        entries.push({ clause: "", specifier: match[1] })
    }
    // Dynamic imports: import("pkg")
    const dynamicPattern = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
    for (const match of source.matchAll(dynamicPattern)) {
        entries.push({ clause: "*", specifier: match[1] })
    }
    return entries
}

function getImportKind(clause) {
    if (clause === "") return "side-effect"
    if (clause === "*") return "dynamic"
    if (clause.startsWith("type ") || /\btype\s*\{/.test(clause)) return "type"
    if (clause.startsWith("* as ")) return "namespace"
    if (clause.startsWith("{")) return "named"
    if (clause.includes(",")) {
        const [, trailing = ""] = clause.split(",", 2)
        const trailingTrimmed = trailing.trim()
        if (trailingTrimmed.startsWith("* as ")) return "default+namespace"
        if (trailingTrimmed.startsWith("type ")) return "default+named"
        return "default+named"
    }
    return "default"
}

function getPackageName(specifier) {
    if (specifier.startsWith("@")) {
        const parts = specifier.split("/")
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
    }
    return specifier.split("/")[0]
}

function resolveLocalImport(importerPath, specifier) {
    const basePath = path.resolve(path.dirname(importerPath), specifier)
    const candidates = [
        basePath,
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        path.join(basePath, "index.ts"),
        path.join(basePath, "index.tsx"),
        path.join(basePath, "index.js"),
        path.join(basePath, "index.mjs"),
    ]

    for (const candidate of candidates) {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }

    fail(`unable to resolve local import ${specifier} from ${path.relative(root, importerPath)}`)
}

function findPackageInfo(packageName, importerPath) {
    const cacheKey = `${packageName}::${path.dirname(importerPath)}`
    if (packageInfoCache.has(cacheKey)) {
        return packageInfoCache.get(cacheKey)
    }

    let entry
    try {
        entry = require.resolve(packageName, { paths: [path.dirname(importerPath)] })
    } catch {
        packageInfoCache.set(cacheKey, null)
        return null
    }

    let current = path.dirname(entry)
    while (true) {
        const manifest = path.join(current, "package.json")
        if (existsSync(manifest)) {
            const info = JSON.parse(readFileSync(manifest, "utf8"))
            packageInfoCache.set(cacheKey, info)
            return info
        }
        const parent = path.dirname(current)
        if (parent === current) {
            packageInfoCache.set(cacheKey, null)
            return null
        }
        current = parent
    }
}

function packageLooksCommonJs(pkg) {
    if (!pkg) return false
    if (pkg.type === "commonjs") return true

    // A package with an explicit ESM export condition is importable even when
    // its legacy `main` points at a CJS bundle (e.g. zod, @anthropic-ai/*).
    const rootExport = pkg.exports?.["."]
    if (typeof rootExport === "string") return rootExport.endsWith(".cjs")
    if (rootExport && typeof rootExport === "object" && rootExport.import) return false

    // A non-CJS `module` field points at an ESM build (e.g. jsonc-parser), so
    // named ESM imports resolve even when the legacy `main` is a UMD bundle.
    const moduleEntry = typeof pkg.module === "string" ? pkg.module : ""
    if (moduleEntry.endsWith(".mjs") || moduleEntry.endsWith(".js")) return false

    const main = typeof pkg.main === "string" ? pkg.main : ""
    return /(?:^|\/)(cjs|umd)(?:\/|$)/.test(main) || main.endsWith(".cjs")
}

function validateRuntimeImportGraph() {
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
    const declared = new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
    ])
    const devDeclared = new Set(Object.keys(pkg.devDependencies ?? {}))

    const pending = [path.join(root, "index.ts"), path.join(root, "tui.tsx")]
    const seen = new Set()

    while (pending.length > 0) {
        const filePath = pending.pop()
        if (!filePath || seen.has(filePath)) continue
        seen.add(filePath)

        const source = readFileSync(filePath, "utf8")
        for (const entry of getImportStatements(source)) {
            if (entry.specifier.startsWith(".")) {
                pending.push(resolveLocalImport(filePath, entry.specifier))
                continue
            }

            const packageName = getPackageName(entry.specifier)
            if (builtinNames.has(packageName)) continue

            const kind = getImportKind(entry.clause)
            if (kind === "type") continue

            // Every runtime import must be declared as a production dependency;
            // type-only imports may live in devDependencies.
            if (!declared.has(packageName)) {
                if (devDeclared.has(packageName) && kind !== "type") {
                    fail(
                        `${path.relative(root, filePath)} has a runtime ${kind} import from devDependency ${packageName}`,
                    )
                }
                fail(`${path.relative(root, filePath)} imports undeclared package ${packageName}`)
            }

            // Namespace/dynamic imports of CJS packages are safe (the namespace
            // object is the CJS exports); named/default imports are not.
            if (kind === "namespace" || kind === "dynamic" || kind === "side-effect") continue

            const importedPkg = findPackageInfo(packageName, filePath)
            if (packageLooksCommonJs(importedPkg)) {
                fail(
                    `${path.relative(root, filePath)} uses ${kind} import from CommonJS-style package ${packageName}`,
                )
            }
        }
    }
}

function validatePackedFiles() {
    const output = execFileSync("npm", ["pack", "--dry-run", "--json"], {
        cwd: root,
        encoding: "utf8",
    })

    // npm versions return either an array or an object keyed by package name.
    const [result] = Object.values(JSON.parse(output))
    if (!result || !Array.isArray(result.files)) {
        fail("npm pack --dry-run --json did not return file metadata")
    }

    const packedPaths = result.files.map((file) => file.path)
    for (const required of requiredTarballFiles) {
        if (!packedPaths.includes(required)) {
            fail(`packed tarball is missing ${required}`)
        }
    }

    const forbidden = packedPaths.find((file) =>
        forbiddenTarballPatterns.some((pattern) => pattern.test(file)),
    )
    if (forbidden) {
        fail(`packed tarball contains forbidden path ${forbidden}`)
    }

    // The TUI must be fully bundled: every relative import reachable from
    // dist/tui.js must exist in the tarball so no host-side transpilation of
    // raw source is required.
    const pendingTui = ["dist/tui.js"]
    const seenTui = new Set()
    while (pendingTui.length > 0) {
        const current = pendingTui.pop()
        if (seenTui.has(current)) continue
        seenTui.add(current)
        if (!packedPaths.includes(current)) {
            fail(`packed tarball is missing TUI bundle chunk ${current}`)
        }
        const source = readFileSync(path.join(root, current), "utf8")
        for (const entry of getImportStatements(source)) {
            if (!entry.specifier.startsWith(".")) continue
            const resolved = path
                .normalize(path.join(path.dirname(current), entry.specifier))
                .split(path.sep)
                .join("/")
            pendingTui.push(resolved)
        }
    }

    console.log(`package verification passed for ${result.name}@${result.version}`)
    console.log(`tarball entries: ${result.entryCount}`)
}

assertRepoFilesExist()
assertPackageJsonShape()
validateRuntimeImportGraph()
validatePackedFiles()
