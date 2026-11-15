import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useFitModel } from './fit-model'

vi.mock('@proj-airi/stage-shared', () => ({ isStageWeb: () => false }))

describe('live2D presence framing', () => {
  it('fits the entire model with margin, preserves aspect ratio and restores the portrait framing', () => {
    const fullBody = ref(false)
    const canvas = ref({ width: 240, height: 360 })
    const model = { width: 800, height: 1600 }
    const fit = useFitModel(canvas, model, fullBody)
    expect(fit.value).toEqual({ scale: 0.45, x: 120, y: 360 })
    fullBody.value = true
    expect(fit.value).toEqual({ scale: 0.2025, x: 120, y: 180 })
    for (const viewport of [{ width: 240, height: 360 }, { width: 360, height: 540 }, { width: 120, height: 180 }]) {
      canvas.value = viewport
      expect(model.width * fit.value.scale).toBeLessThanOrEqual(viewport.width)
      expect(model.height * fit.value.scale).toBeLessThanOrEqual(viewport.height)
      expect(fit.value.y).toBe(viewport.height / 2)
    }
    canvas.value = { width: 240, height: 360 }
    fullBody.value = false
    expect(fit.value).toEqual({ scale: 0.45, x: 120, y: 360 })
  })
})
