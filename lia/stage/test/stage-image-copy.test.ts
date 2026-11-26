import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createStageImageCopy } from '../src/main/stage-image-copy.ts'
import { maxStageImageBytes } from '../src/shared/chat-image.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB9sAAAAASUVORK5CYII=', 'base64')
const jpegHeader = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0, 2,
  0xFF, 0xC0, 0, 11, 8, 0, 3, 0, 2, 1, 1, 0x11, 0,
])

test('reads bounded PNG and JPEG dimensions and rejects malformed headers', () => {
  const images = createStageImageCopy()
  assert.deepEqual(images.inspect(png), { format: 'png', width: 1, height: 1, bytes: png.length })
  assert.deepEqual(images.inspect(jpegHeader), { format: 'jpeg', width: 2, height: 3, bytes: jpegHeader.length })
  const zeroWidth = Buffer.from(png)
  zeroWidth.writeUInt32BE(0, 16)
  for (const invalid of [png.subarray(0, 24), zeroWidth, jpegHeader.subarray(0, -1), Buffer.alloc(maxStageImageBytes + 1), {}])
    assert.equal(images.inspect(invalid), undefined)
})

test('publishes only captured verified bytes and never replaces existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lia-image-copy-'))
  try {
    const images = createStageImageCopy()
    const selected = Buffer.from(png)
    const destination = join(root, 'chosen.png')
    const signal = new AbortController().signal
    const saved = await images.save(selected, signal, async (image) => {
      assert.equal(image.width, 1)
      selected.fill(0)
      return destination
    })
    assert.deepEqual(saved, { ok: true, image: images.inspect(png) })
    assert.deepEqual(await readFile(destination), png)
    await writeFile(destination, 'existing')
    assert.deepEqual(await images.save(png, signal, async () => destination), { ok: false, code: 'exists' })
    assert.equal(await readFile(destination, 'utf8'), 'existing')
    assert.deepEqual(await readdir(root), ['chosen.png'])
    assert.deepEqual(images.audit().map(entry => entry.outcome), ['saved', 'exists'])
    assert.equal(JSON.stringify(images.audit()).includes('chosen'), false)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancels before publication and limits the metadata-only audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lia-image-cancel-'))
  try {
    const images = createStageImageCopy()
    const controller = new AbortController()
    const interrupted = await images.save(png, controller.signal, async () => {
      controller.abort()
      return join(root, 'cancelled.png')
    })
    assert.deepEqual(interrupted, { ok: false, code: 'cancelled' })
    assert.deepEqual(await images.save(png, new AbortController().signal, async () => undefined), { ok: false, code: 'cancelled' })
    assert.deepEqual(await images.save(png, new AbortController().signal, async () => join(root, 'mismatch.jpg')), { ok: false, code: 'invalid' })
    assert.deepEqual(await readdir(root), [])
    for (let index = 0; index < 40; index++)
      await images.save(null, controller.signal, async () => assert.fail('must not open a destination picker'))
    assert.equal(images.audit().length, 32)
    assert.equal(images.audit().every(entry => entry.outcome === 'cancelled'), true)
  }
  finally {
    await rm(root, { recursive: true, force: true })
  }
})
