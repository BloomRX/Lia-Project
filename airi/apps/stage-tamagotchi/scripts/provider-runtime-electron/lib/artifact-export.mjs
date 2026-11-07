/**
 * Artifact preservation for the Electron gate.
 *
 * Why
 * ---
 *
 * The gate writes into `Tests/artifacts/provider-runtime-electron/<ts>/`, which
 * `.gitignore` excludes (line 16). That is correct — a report does not belong in
 * history — but it also means the evidence lives only in the workspace, and the
 * workspace is disposable. The PROMPT-29 run is the proof: two artifact folders
 * were produced, the workspace was recreated, and the folders were gone. Nothing
 * could be re-inspected, so nothing could be verified.
 *
 * This module produces a **package** that can be copied out of the workspace:
 *
 *   <exportRoot>/<runId>/
 *     report.json          the gate's own report
 *     electron.log         the gate's own log, already redacted
 *     environment.json     PowerShell/Windows/Node/Electron/pnpm versions
 *     electron.png         the screenshot, when the gate produced one
 *     manifest.json        identity, versions, branch/commit, hashes
 *
 * `manifest.json` carries a SHA-256 per file, plus the branch and commit under
 * test, so a recipient can answer "is this the same evidence?" without trusting
 * the folder name. It carries no credential: only names, sizes, hashes and
 * version strings.
 *
 * It is a copy, never a move: the original folder stays where the gate wrote it,
 * so a re-run cannot destroy the evidence of the previous one.
 */

import { createHash } from 'node:crypto'

/** Files the gate may produce, in the order a reader wants them. */
export const ARTIFACT_FILES = ['report.json', 'electron.log', 'environment.json', 'electron.png']

/**
 * SHA-256 of a buffer, as lowercase hex.
 *
 * `node:crypto` rather than a shell tool: `Get-FileHash` exists on Windows but
 * the manifest is written on the Node side, and one implementation keeps the
 * value reproducible on any host that reads it back.
 */
export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * Build the manifest from files already read into memory.
 *
 * `files` is `[{ name, buffer }]`. The manifest is deliberately flat and
 * sorted: a reader diffing two manifests sees exactly which file changed.
 */
export function buildManifest({ runId, environment, git, startedAt, finishedAt, result, groups, files }) {
  const hashed = files
    .map(({ name, buffer }) => ({ name, bytes: buffer.length, sha256: sha256(buffer) }))
    .sort((left, right) => left.name.localeCompare(right.name))

  return {
    formatVersion: 1,
    runId,
    git,
    environment,
    startedAt,
    finishedAt,
    result,
    groups,
    files: hashed,
    // Stated in the artifact itself, so nobody has to guess how to check it.
    verification: 'sha256sum -c inside this folder, or: node -e "const c=require(\'node:crypto\'),f=require(\'node:fs\');for(const e of require(\'./manifest.json\').files)console.log(c.createHash(\'sha256\').update(f.readFileSync(e.name)).digest(\'hex\')===e.sha256?\'OK\':\'MISMATCH\',e.name)"',
  }
}

/**
 * Verify a manifest against the files next to it.
 *
 * Used by the export step (to prove the copy is intact before declaring success)
 * and by a future reader who wants to know whether a package is trustworthy.
 * Returns a per-file verdict rather than throwing, so a partial copy can be
 * diagnosed instead of merely rejected.
 */
export function verifyManifest(manifest, files) {
  const byName = new Map(files.map(({ name, buffer }) => [name, buffer]))
  return manifest.files.map((entry) => {
    const buffer = byName.get(entry.name)
    if (!buffer)
      return { name: entry.name, status: 'missing' }
    if (buffer.length !== entry.bytes)
      return { name: entry.name, status: 'size-mismatch', expected: entry.bytes, actual: buffer.length }
    const actual = sha256(buffer)
    return actual === entry.sha256
      ? { name: entry.name, status: 'ok' }
      : { name: entry.name, status: 'hash-mismatch', expected: entry.sha256, actual }
  })
}

/**
 * Everything gathered from the host, with `unknown` where a value genuinely
 * could not be read.
 *
 * The rule the mission states — do not invent — is enforced by shape: every
 * field is a string, and the absence of a probe produces `'unknown'`, not an
 * empty string that could be mistaken for a version.
 */
export function describeEnvironment({ powershell, windows, node, electron, pnpm, extra }) {
  const value = input => (typeof input === 'string' && input.trim().length > 0 ? input.trim() : 'unknown')
  return {
    powershell: {
      version: value(powershell?.version),
      edition: value(powershell?.edition),
      // The field that makes 5.1 vs 7 answerable without trusting a folder name.
      major: powershell?.major ?? 'unknown',
      host: value(powershell?.host),
    },
    windows: {
      version: value(windows?.version),
      build: value(windows?.build),
      caption: value(windows?.caption),
      arch: value(windows?.arch),
    },
    node: value(node),
    electron: value(electron),
    pnpm: value(pnpm),
    ...extra,
  }
}

/**
 * Whether the recorded environment identifies PowerShell beyond doubt.
 *
 * A report that cannot answer "5.1 or 7?" is not evidence of a run in either, so
 * the export step refuses to call such a package complete.
 */
export function isEnvironmentConclusive(environment) {
  const version = environment?.powershell?.version
  return typeof version === 'string' && version !== 'unknown' && /^\d+\.\d+/.test(version)
}

/**
 * Pick the artifact folder this run wrote.
 *
 * The gate names its folder `${Date.now()}`, so the newest folder that is not
 * older than the run start is this run's. `createdAt` is passed in (rather than
 * read from the filesystem here) so the rule is testable without a clock.
 */
export function selectRunFolder({ folders, runStartedAt }) {
  const eligible = folders
    .filter(folder => Number.isFinite(folder.createdAtMs))
    .filter(folder => folder.createdAtMs >= runStartedAt - 60_000)
    .sort((left, right) => right.createdAtMs - left.createdAtMs)

  if (eligible.length === 0)
    return { folder: undefined, reason: 'no artifact folder was created at or after this run started' }

  return { folder: eligible[0], reason: 'newest folder created at or after this run started' }
}
