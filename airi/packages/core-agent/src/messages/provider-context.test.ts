import type { ChatHistoryItem } from '../types/chat'

import { describe, expect, it } from 'vitest'

import {
  countImagePartsInMessage,
  countProviderContextImageParts,
  hasProviderContextImageInput,
  isProviderContextMessage,
  selectProviderContextMessages,
} from './provider-context'

/**
 * Phase 8.0D-M3: the single rule for "what reaches the provider".
 *
 * Everything else - the runtime's prompt projection, the Brain capability
 * facts, the artist-task history - is a consumer of these functions, so the
 * behaviour pinned here is the behaviour the whole product has.
 */

function imageTurn(count: number, extra?: Record<string, unknown>): ChatHistoryItem {
  return {
    role: 'user',
    content: [
      { type: 'text', text: 'look at this' },
      ...Array.from({ length: count }, (_, index) => ({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${index}` },
      })),
    ],
    ...extra,
  } as unknown as ChatHistoryItem
}

const TEXT_TURN = { role: 'user', content: 'plain text' } as unknown as ChatHistoryItem
const ASSISTANT_TURN = { role: 'assistant', content: 'a reply' } as unknown as ChatHistoryItem
const ERROR_ITEM = { role: 'error', content: 'Remote sent 400 response: Too many images' } as unknown as ChatHistoryItem

describe('provider-context participation', () => {
  it('absence means included - the historical default is unchanged', () => {
    expect(isProviderContextMessage(TEXT_TURN)).toBe(true)
    expect(isProviderContextMessage(ASSISTANT_TURN)).toBe(true)
    expect(isProviderContextMessage(imageTurn(1))).toBe(true)
    // An explicit false is the same as absent.
    expect(isProviderContextMessage({ ...TEXT_TURN, excludedFromProviderContext: false })).toBe(true)
  })

  it('only an explicit true withholds a message', () => {
    expect(isProviderContextMessage({ ...TEXT_TURN, excludedFromProviderContext: true })).toBe(false)
    expect(isProviderContextMessage({ ...imageTurn(3), excludedFromProviderContext: true })).toBe(false)
  })

  it('an error bubble never participates, marked or not', () => {
    expect(isProviderContextMessage(ERROR_ITEM)).toBe(false)
    expect(isProviderContextMessage({ ...ERROR_ITEM, excludedFromProviderContext: false })).toBe(false)
  })

  it('selection keeps order and content, and never mutates the input', () => {
    const input = [TEXT_TURN, { ...TEXT_TURN, excludedFromProviderContext: true }, ERROR_ITEM, ASSISTANT_TURN]
    const frozen = JSON.stringify(input)

    expect(selectProviderContextMessages(input)).toEqual([TEXT_TURN, ASSISTANT_TURN])
    expect(JSON.stringify(input)).toBe(frozen)
  })
})

describe('provider-context image facts', () => {
  it('counts only image parts, on any role that carries content parts', () => {
    expect(countImagePartsInMessage(TEXT_TURN)).toBe(0)
    expect(countImagePartsInMessage(imageTurn(0))).toBe(0)
    expect(countImagePartsInMessage(imageTurn(3))).toBe(3)
  })

  it('counts what the provider would really receive', () => {
    const history = [TEXT_TURN, imageTurn(2), ASSISTANT_TURN]

    expect(countProviderContextImageParts(history)).toBe(2)
    expect(hasProviderContextImageInput(history)).toBe(true)
  })

  it('excluded turns and error bubbles contribute zero images', () => {
    const history = [
      imageTurn(1, { excludedFromProviderContext: true }),
      imageTurn(1, { excludedFromProviderContext: true }),
      imageTurn(1, { excludedFromProviderContext: true }),
      ERROR_ITEM,
    ]

    expect(countProviderContextImageParts(history)).toBe(0)
    expect(hasProviderContextImageInput(history)).toBe(false)
  })

  it('a text-only conversation has no image input', () => {
    const history = [TEXT_TURN, ASSISTANT_TURN, { role: 'system', content: 'persona' } as unknown as ChatHistoryItem]

    expect(countProviderContextImageParts(history)).toBe(0)
    expect(hasProviderContextImageInput(history)).toBe(false)
  })

  it('one legitimate image among many excluded ones still counts as one', () => {
    const history = [
      imageTurn(1, { excludedFromProviderContext: true }),
      imageTurn(1, { excludedFromProviderContext: true }),
      imageTurn(1),
    ]

    expect(countProviderContextImageParts(history)).toBe(1)
  })

  it('never inspects or rewrites the image payload itself', () => {
    const turn = imageTurn(2)
    const before = JSON.stringify(turn)

    countProviderContextImageParts([turn])
    hasProviderContextImageInput([turn])
    selectProviderContextMessages([turn])

    // No flattening, no text conversion, no silent removal.
    expect(JSON.stringify(turn)).toBe(before)
    expect((turn.content as unknown[])[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,0' },
    })
  })
})
