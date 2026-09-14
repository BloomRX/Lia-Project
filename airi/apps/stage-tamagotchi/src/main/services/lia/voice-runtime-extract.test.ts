import { Buffer } from 'node:buffer'
import { mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import JSZip from 'jszip'

import { beforeEach, describe, expect, it } from 'vitest'

import { createRuntimeExtract } from './voice-runtime-install-exec'

/**
 * The extractor against real archives.
 *
 * The pure validator is tested separately and in depth; what only an end-to-end
 * test can show is whether the two passes cooperate - whether the wrapper is
 * detected before anything is written, whether a refusal happens *before* a
 * partial extraction, and whether the files actually land where the validator said
 * they would.
 *
 * One thing this file deliberately does not claim: it runs on POSIX, so it cannot
 * reproduce the Windows separator mismatch that caused the original failure. That
 * case is covered in `archive-path.test.ts` by injecting `path.win32`, which is
 * the only way to exercise it without a Windows machine.
 */

let workDir: string
let rejects: Array<{ normalised: string, raw: string, reason: string, rootDir: string }>
let progress: Array<{ entries: number, stripRoot?: string }>

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'lia-extract-'))
  rejects = []
  progress = []
})

const WRAPPER = 'alltalk_tts-f16117e95b540e9bbbd8247b49ca6c6b1350b172'

/** Builds a real ZIP on disk and returns its path. */
async function makeZip(files: Record<string, string>): Promise<string> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files))
    zip.file(name, content)

  const path = join(workDir, 'archive.zip')
  await writeFile(path, await zip.generateAsync({ platform: 'UNIX', type: 'nodebuffer' }))
  return path
}

function extractor() {
  return createRuntimeExtract({
    onProgress: info => progress.push(info),
    onReject: report => rejects.push(report),
  })
}

/**
 * Builds a ZIP with arbitrary entry names, including hostile ones.
 *
 * JSZip refuses to create an entry containing `../` or an absolute path, which is
 * sensible behaviour from a writer but useless here: the whole point is to hand the
 * extractor a name it must reject. So the container is assembled by hand, with
 * stored (uncompressed) entries - enough structure for yauzl to read, and no
 * validation standing between the test and a genuinely malformed archive.
 */
async function makeRawZip(entries: Array<{ data: string, name: string }>): Promise<Buffer> {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8')
    const data = Buffer.from(entry.data, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x0403_4B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, data)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x0201_4B50, 0)
    dir.writeUInt16LE(20, 4)
    dir.writeUInt16LE(20, 6)
    dir.writeUInt16LE(0, 8)
    dir.writeUInt16LE(0, 10)
    dir.writeUInt16LE(0, 12)
    dir.writeUInt16LE(0, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(data.length, 20)
    dir.writeUInt32LE(data.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(0, 38)
    dir.writeUInt32LE(offset, 42)

    central.push(dir, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x0605_4B50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...chunks, centralBuf, end])
}

/** CRC-32 as the ZIP format requires it. */
function crc32(buf: Buffer): number {
  let crc = 0xFFFF_FFFF
  for (const byte of buf) {
    crc ^= byte
    for (let i = 0; i < 8; i++)
      crc = (crc >>> 1) ^ (0xEDB8_8320 & -(crc & 1))
  }
  return (crc ^ 0xFFFF_FFFF) >>> 0
}

describe('extracting the real archive shape', () => {
  it('strips the wrapper directory and lands the tree in the destination', async () => {
    const archive = await makeZip({
      [`${WRAPPER}/atsetup.bat`]: '@echo off',
      [`${WRAPPER}/script.py`]: 'print("hi")',
      [`${WRAPPER}/system/config/settings.json`]: '{}',
    })
    const dest = join(workDir, 'app')

    await extractor()(archive, dest)

    expect(progress[0]?.stripRoot).toBe(WRAPPER)

    const names = await readdir(dest)
    expect(names.sort()).toEqual(['atsetup.bat', 'script.py', 'system'])
    expect(await readFile(join(dest, 'script.py'), 'utf8')).toBe('print("hi")')
    expect(await readFile(join(dest, 'system/config/settings.json'), 'utf8')).toBe('{}')
  })

  it('keeps dot-directories, which the naive normalizer treated as suspicious', async () => {
    const archive = await makeZip({
      [`${WRAPPER}/.github/workflows/ci.yml`]: 'name: ci',
      [`${WRAPPER}/.gitignore`]: '*.pyc',
    })
    const dest = join(workDir, 'app')

    await extractor()(archive, dest)

    expect((await readdir(dest)).sort()).toEqual(['.github', '.gitignore'])
  })

  it('does not strip when the archive has no wrapper', async () => {
    const archive = await makeZip({ 'a.py': 'a', 'sub/b.py': 'b' })
    const dest = join(workDir, 'app')

    await extractor()(archive, dest)

    expect(progress[0]?.stripRoot).toBeUndefined()
    expect((await readdir(dest)).sort()).toEqual(['a.py', 'sub'])
  })

  it('reports how many entries it saw', async () => {
    const archive = await makeZip({ [`${WRAPPER}/a`]: 'a', [`${WRAPPER}/b`]: 'b' })

    await extractor()(archive, join(workDir, 'app'))

    expect(progress[0]?.entries).toBeGreaterThanOrEqual(2)
  })

  it('signals completion, so a long extraction is not indistinguishable from a hang', async () => {
    const completed: Array<{ elapsedMs: number, entries: number }> = []
    const archive = await makeZip({ [`${WRAPPER}/a`]: 'a', [`${WRAPPER}/b`]: 'b' })

    await createRuntimeExtract({ onComplete: info => completed.push(info) })(archive, join(workDir, 'app'))

    expect(completed).toHaveLength(1)
    expect(completed[0].entries).toBeGreaterThanOrEqual(2)
    expect(completed[0].elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it('does not signal completion when an entry is refused', async () => {
    const completed: unknown[] = []
    const archive = join(workDir, 'evil.zip')
    await writeFile(archive, await makeRawZip([
      { data: 'good', name: `${WRAPPER}/good.py` },
      { data: 'evil', name: `${WRAPPER}/../../evil.txt` },
    ]))

    await expect(
      createRuntimeExtract({ onComplete: info => completed.push(info) })(archive, join(workDir, 'app')),
    ).rejects.toThrow()

    // A completion signal after a failure would be worse than none: it is the line
    // QA reads to decide whether to move on.
    expect(completed).toHaveLength(0)
  })
})

/**
 * Two independent layers refuse a hostile entry, and that is deliberate.
 *
 * yauzl validates entry names while decoding (`validateFileName`, only when
 * `decodeStrings` is on, which is the default) and rejects `..`, absolute paths and
 * backslashes before this code ever sees them. The Lia's own
 * `resolveArchiveEntry` then checks the resolved target against the destination
 * root with a real separator boundary.
 *
 * So these tests assert the property that matters - the archive is refused and
 * nothing is written - without depending on which layer caught it. The detailed
 * per-reason behaviour of the Lia's own guard is covered in `archive-path.test.ts`,
 * where it can be exercised directly.
 */
describe('refusing a hostile archive', () => {
  it('rejects traversal and writes nothing', async () => {
    const archive = join(workDir, 'evil.zip')
    await writeFile(archive, await makeRawZip([
      { data: 'good', name: `${WRAPPER}/good.py` },
      { data: 'evil', name: `${WRAPPER}/../../evil.txt` },
    ]))
    const dest = join(workDir, 'app')

    await expect(extractor()(archive, dest)).rejects.toThrow()

    // Nothing landed - not even the benign entry that came first. Refusing before
    // writing is the property that matters; which layer refused is secondary.
    await expect(stat(dest)).rejects.toThrow()
  })

  it('rejects an absolute entry path', async () => {
    const archive = join(workDir, 'abs.zip')
    await writeFile(archive, await makeRawZip([{ data: 'evil', name: '/etc/evil' }]))

    await expect(extractor()(archive, join(workDir, 'app'))).rejects.toThrow()
    await expect(stat(join(workDir, 'app'))).rejects.toThrow()
  })

  it('rejects a symlink even though its name is innocent', async () => {
    // Filename validation cannot see where a link points, so the attribute check
    // is the only thing standing between the archive and an arbitrary target.
    const zip = new JSZip()
    zip.file(`${WRAPPER}/good.py`, 'good')
    zip.file(`${WRAPPER}/shortcut`, '/etc/passwd', { unixPermissions: 0o120_777 })
    const archive = join(workDir, 'link.zip')
    await writeFile(archive, await zip.generateAsync({ platform: 'UNIX', type: 'nodebuffer' }))
    const dest = join(workDir, 'app')

    await expect(extractor()(archive, dest)).rejects.toThrow(/symbolic link/)

    // Refused before any extraction, so the benign entry did not get written first.
    await expect(stat(dest)).rejects.toThrow()
  })

  it('reports only the first refusal, not one per entry', async () => {
    const archive = join(workDir, 'many.zip')
    await writeFile(archive, await makeRawZip(
      Array.from({ length: 5 }, (_, i) => ({ data: 'x', name: `${WRAPPER}/../bad${i}.txt` })),
    ))

    await expect(extractor()(archive, join(workDir, 'app'))).rejects.toThrow()

    // At most one diagnostic, never one per entry.
    expect(rejects.length).toBeLessThanOrEqual(1)
  })
})
