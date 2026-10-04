import type { ChatHistoryItem } from '@proj-airi/core-agent'
import type { CommonContentPart } from '@xsai/shared-chat'

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { cloneRetryAttachments, retryContentFromUserMessage } from './retry-content'

// TEST-ONLY helper: keep source guards stable across CRLF/LF checkouts
function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function readHelperSource(): string {
  return normalizeLineEndings(readFileSync(resolve(__dirname, './retry-content.ts'), 'utf-8'))
}

/** TEST-ONLY: removes block and line comments so guards match code, not prose. */
function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Mirrors EXACTLY how the send path stores an image part
 * (core-agent chat-orchestrator-runtime): a base64 data URL built from the
 * attachment's own mimeType and data. This is the fixture's oracle, not a
 * reimplementation of the derivation under test.
 */
function storedImageUrl(mimeType: string, data: string): string {
  return `data:${mimeType};base64,${data}`
}

function textPart(text: string) {
  return { type: 'text' as const, text }
}

function imagePart(mimeType: string, data: string) {
  return { type: 'image_url' as const, image_url: { url: storedImageUrl(mimeType, data) } }
}

function userMessage(content: string | CommonContentPart[], id = 'u1'): ChatHistoryItem {
  return { role: 'user', content, id }
}

/** The stored shape of an image-only turn: the leading text part is empty. */
function imageOnlyUser(images: Array<[string, string]>, id = 'u1'): ChatHistoryItem {
  return userMessage([textPart(''), ...images.map(([mime, data]) => imagePart(mime, data))], id)
}

describe('retry content from a stored USER message (Phase 8.0D-10B-4D4C4-D2B11)', () => {
  it('case A: plain string USER text is trimmed and retryable', () => {
    expect(retryContentFromUserMessage(userMessage('  hello there  ')))
      .toEqual({ text: 'hello there', attachments: [] })
  })

  it('case A2: a whitespace-only string USER message is not retryable', () => {
    expect(retryContentFromUserMessage(userMessage('   \n\t '))).toBeNull()
  })

  it('case B: array content with a single text part', () => {
    expect(retryContentFromUserMessage(userMessage([textPart('only text')])))
      .toEqual({ text: 'only text', attachments: [] })
  })

  it('case C: multiple text parts are trimmed, empties omitted, joined with a blank line', () => {
    const content = retryContentFromUserMessage(userMessage([
      textPart('  first  '),
      textPart(''),
      textPart('   '),
      textPart('second'),
      textPart('  third'),
    ]))
    expect(content?.text).toBe('first\n\nsecond\n\nthird')
    expect(content?.attachments).toEqual([])
  })

  it('case D: text + one image yields both', () => {
    const content = retryContentFromUserMessage(userMessage([
      textPart('look at this'),
      imagePart('image/png', 'QUJD'),
    ]))
    expect(content).toEqual({
      text: 'look at this',
      attachments: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
    })
  })

  it('case E: text + multiple images yields all of them', () => {
    const content = retryContentFromUserMessage(userMessage([
      textPart('two pictures'),
      imagePart('image/png', 'QUJD'),
      imagePart('image/jpeg', 'REVG'),
    ]))
    expect(content?.text).toBe('two pictures')
    expect(content?.attachments).toHaveLength(2)
  })

  it('case F: an image-only USER turn is retryable with empty text', () => {
    const content = retryContentFromUserMessage(imageOnlyUser([['image/webp', 'R0hJ']]))
    expect(content).toEqual({
      text: '',
      attachments: [{ type: 'image', data: 'R0hJ', mimeType: 'image/webp' }],
    })
  })

  it('case G: image order is preserved exactly, including repeats', () => {
    const content = retryContentFromUserMessage(imageOnlyUser([
      ['image/png', 'T05F'],
      ['image/jpeg', 'VFdP'],
      ['image/png', 'T05F'],
      ['image/gif', 'VEhSRUU'],
    ]))
    expect(content?.attachments.map(attachment => attachment.data)).toEqual(['T05F', 'VFdP', 'T05F', 'VEhSRUU'])
    expect(content?.attachments.map(attachment => attachment.mimeType))
      .toEqual(['image/png', 'image/jpeg', 'image/png', 'image/gif'])
  })

  it('case H: image data is preserved exactly - no re-encoding, padding or trimming', () => {
    const data = 'aGVsbG8gd29ybGQ=/+/QUJDREVGR0hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5'
    const content = retryContentFromUserMessage(imageOnlyUser([['image/png', data]]))
    expect(content?.attachments[0]?.data).toBe(data)
  })

  it('case I: MIME type is preserved exactly - no inference, no normalization', () => {
    for (const mimeType of ['image/png', 'image/jpeg', 'image/svg+xml', 'IMAGE/PNG', 'image/x-custom']) {
      const content = retryContentFromUserMessage(imageOnlyUser([[mimeType, 'QUJD']]))
      expect(content?.attachments[0]?.mimeType).toBe(mimeType)
    }
  })

  it('case I2: interleaved text and image parts keep their own order', () => {
    const content = retryContentFromUserMessage(userMessage([
      textPart('before'),
      imagePart('image/png', 'QUJD'),
      textPart('between'),
      imagePart('image/jpeg', 'REVG'),
      textPart('after'),
    ]))
    expect(content?.text).toBe('before\n\nbetween\n\nafter')
    expect(content?.attachments.map(attachment => attachment.data)).toEqual(['QUJD', 'REVG'])
  })

  it('case J: the returned attachment array is a fresh array', () => {
    const message = imageOnlyUser([['image/png', 'QUJD']])
    const first = retryContentFromUserMessage(message)
    const second = retryContentFromUserMessage(message)
    expect(first?.attachments).not.toBe(second?.attachments)
    expect(first?.attachments).toEqual(second?.attachments)
  })

  it('case K: the returned attachment objects are fresh objects', () => {
    const message = imageOnlyUser([['image/png', 'QUJD'], ['image/jpeg', 'REVG']])
    const first = retryContentFromUserMessage(message)
    const second = retryContentFromUserMessage(message)
    expect(first?.attachments[0]).not.toBe(second?.attachments[0])
    expect(first?.attachments[1]).not.toBe(second?.attachments[1])
    expect(first?.attachments[0]).toEqual(second?.attachments[0])
  })

  it('case K2: mutating a returned attachment never reaches the stored message', () => {
    const message = imageOnlyUser([['image/png', 'QUJD']])
    const content = retryContentFromUserMessage(message)
    expect(content).not.toBeNull()
    const attachments = content!.attachments
    attachments.push({ type: 'image', data: 'SU5KRUNURUQ', mimeType: 'image/png' })
    attachments[0]!.data = 'T1ZFUldSSVRURU4'
    attachments[0]!.mimeType = 'image/gif'
    const reread = retryContentFromUserMessage(message)
    expect(reread?.attachments).toEqual([{ type: 'image', data: 'QUJD', mimeType: 'image/png' }])
  })

  it('case L: the input USER message is never mutated', () => {
    const message = userMessage([textPart('  spaced  '), imagePart('image/png', 'QUJD')])
    const before = JSON.stringify(message)
    retryContentFromUserMessage(message)
    expect(JSON.stringify(message)).toBe(before)
  })

  it('case M: a deeply frozen valid source works', () => {
    const frozenParts = Object.freeze([
      Object.freeze(textPart('frozen text')),
      Object.freeze({ type: 'image_url' as const, image_url: Object.freeze({ url: Object.freeze(storedImageUrl('image/png', 'QUJD')) }) }),
    ]) as unknown as CommonContentPart[]
    const message = userMessage(frozenParts)
    Object.freeze(message)
    expect(retryContentFromUserMessage(message)).toEqual({
      text: 'frozen text',
      attachments: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
    })
  })

  it('case N: a non-USER message is never accepted as retry source content', () => {
    expect(retryContentFromUserMessage(undefined)).toBeNull()
    expect(retryContentFromUserMessage({ role: 'assistant', content: 'hi', slices: [], tool_results: [], id: 'a1' })).toBeNull()
    expect(retryContentFromUserMessage({ role: 'system', content: 'hi' })).toBeNull()
    expect(retryContentFromUserMessage({ role: 'error', content: 'boom' })).toBeNull()
    // A non-user turn carrying the same text is still not a retry source.
    expect(retryContentFromUserMessage({
      role: 'assistant',
      content: [textPart('look at this')],
      slices: [],
      tool_results: [],
      id: 'a1',
    })).toBeNull()
  })

  it('case O: a USER turn with neither retryable text nor images is non-retryable', () => {
    expect(retryContentFromUserMessage(userMessage([]))).toBeNull()
    expect(retryContentFromUserMessage(userMessage([textPart(''), textPart('   ')]))).toBeNull()
    expect(retryContentFromUserMessage(userMessage(''))).toBeNull()
  })

  it('case P: a stored image part that cannot be losslessly reconstructed is a hard error, never a silent drop', () => {
    // A remote URL: not a base64 data URL, so data cannot be recovered.
    const remote = userMessage([textPart('caption'), { type: 'image_url' as const, image_url: { url: 'https://example.com/a.png' } }])
    expect(() => retryContentFromUserMessage(remote)).toThrow(/cannot be losslessly reconstructed/)

    // A data URL without the base64 marker.
    const noBase64 = userMessage([textPart('caption'), { type: 'image_url' as const, image_url: { url: 'data:image/png' } }])
    expect(() => retryContentFromUserMessage(noBase64)).toThrow(/cannot be losslessly reconstructed/)

    // A part that claims to be an image but has no usable url at all.
    const noUrl = userMessage([textPart('caption'), { type: 'image_url' as const } as never])
    expect(() => retryContentFromUserMessage(noUrl)).toThrow(/without a usable url/)

    // Critically: the image-only form must NOT degrade to a text-only result.
    const imageOnlyBroken = userMessage([{ type: 'image_url' as const, image_url: { url: 'https://example.com/a.png' } }])
    expect(() => retryContentFromUserMessage(imageOnlyBroken)).toThrow()
  })

  it('case P2: a malformed image part fails the WHOLE turn, not just that part', () => {
    const mixed = userMessage([
      textPart('caption'),
      imagePart('image/png', 'QUJD'),
      { type: 'image_url' as const, image_url: { url: 'https://example.com/b.png' } },
    ])
    expect(() => retryContentFromUserMessage(mixed)).toThrow()
  })

  it('case P3: non-image, non-text parts are ignored exactly as before', () => {
    const content = retryContentFromUserMessage(userMessage([
      textPart('caption'),
      { type: 'file' as const, file: { filename: 'a.txt', file_data: 'x' } } as never,
      imagePart('image/png', 'QUJD'),
    ]))
    expect(content).toEqual({
      text: 'caption',
      attachments: [{ type: 'image', data: 'QUJD', mimeType: 'image/png' }],
    })
  })

  it('case Q: repeated calls over equal input are deterministic', () => {
    const message = userMessage([textPart('a'), imagePart('image/png', 'QUJD'), imagePart('image/gif', 'REVG')])
    const runs = Array.from({ length: 5 }, () => retryContentFromUserMessage(message))
    for (const run of runs)
      expect(run).toEqual(runs[0])
  })

  it('case R: the helper is inert - no persistence, logging, Brain, provider or history effects', () => {
    // Scan CODE, not prose: the module's own doc comments legitimately name the
    // things it must never do, so comments are stripped before matching.
    const source = stripComments(readHelperSource())
    for (const forbidden of [
      /console\./,
      /useLogg|logger|telemetry/i,
      /localStorage|indexedDB|sessionStorage/,
      /requestDecision|Brain/i,
      /getChatProviderInstance|activeProvider|activeModel/,
      /setSessionMessages|appendSessionMessage|persistSession/,
      /\bfetch\(|XMLHttpRequest/,
      /setInterval|setTimeout|Date\.now|Math\.random/,
      /\bawait\b|\basync\b|Promise/,
    ]) {
      expect(source).not.toMatch(forbidden)
    }
    // And it exports only the intended surface.
    expect(source.match(/^export /gm)).toHaveLength(4)
  })
})

describe('cloneRetryAttachments (Phase 8.0D-10B-4D4C4-D2B11)', () => {
  const source = [
    { type: 'image' as const, data: 'QUJD', mimeType: 'image/png' },
    { type: 'image' as const, data: 'REVG', mimeType: 'image/jpeg' },
  ]

  it('returns a fresh array of fresh objects with identical values and order', () => {
    const cloned = cloneRetryAttachments(source)
    expect(cloned).not.toBe(source)
    expect(cloned[0]).not.toBe(source[0])
    expect(cloned[1]).not.toBe(source[1])
    expect(cloned).toEqual(source)
    expect(cloned.map(attachment => attachment.data)).toEqual(['QUJD', 'REVG'])
  })

  it('is immune to later caller mutation of the array and of the objects', () => {
    const caller = source.map(attachment => ({ ...attachment }))
    const snapshot = cloneRetryAttachments(caller)
    caller.push({ type: 'image', data: 'SU5KRUNURUQ', mimeType: 'image/png' })
    caller[0]!.data = 'T1ZFUldSSVRURU4'
    caller[0]!.mimeType = 'image/gif'
    expect(snapshot).toEqual(source)
  })

  it('preserves exact data and MIME without normalization', () => {
    const odd = [{ type: 'image' as const, data: 'aGVsbG8=/+/', mimeType: 'image/svg+xml' }]
    expect(cloneRetryAttachments(odd)).toEqual(odd)
  })

  it('handles an empty snapshot', () => {
    expect(cloneRetryAttachments([])).toEqual([])
  })
})
