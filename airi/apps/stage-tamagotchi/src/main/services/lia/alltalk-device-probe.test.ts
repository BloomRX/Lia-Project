import type { AddressInfo } from 'node:net'

import { createServer } from 'node:http'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { logAllTalkDeviceReport, probeAllTalkDevice } from './alltalk-device-probe'

/**
 * Phase 7.7, Part 2: the device audit must be MEASURED (torch wheel build +
 * server-reported settings + the GPU the OS shows the app), never inferred
 * from what hardware the machine happens to have.
 */

function makeServer(handler: (url: string) => { status: number, body: unknown } | undefined) {
  const server = createServer((req, res) => {
    const result = handler(req.url ?? '')
    if (!result) {
      res.writeHead(404)
      res.end()
      return
    }
    res.writeHead(result.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result.body))
  })
  return server
}

let server: ReturnType<typeof makeServer> | undefined

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = makeServer((url) => {
      if (url === '/api/currentsettings') {
        return {
          status: 200,
          body: {
            current_model_loaded: 'XTTSv2 Local',
            deepspeed_status: false,
            low_vram_status: false,
          },
        }
      }
      return undefined
    })
    server.listen(0, '127.0.0.1', () => resolve())
  })
})

afterAll(() => server?.close())

function baseUrl() {
  const address = server?.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

describe('probeAllTalkDevice', () => {
  it('reports a CPU device from a +cpu torch wheel, with the server model method', async () => {
    const report = await probeAllTalkDevice(
      { baseUrl: baseUrl(), installDir: 'C:/fake/install', timeoutMs: 2000 },
      {
        readFileImpl: async path => (path.includes('version.py')
          ? '__version__ = \'2.4.1+cpu\'\n'
          : ''),
        getGpuInfoImpl: async () => [{ deviceName: 'AMD Radeon RX 580', deviceVendor: '0x1002' }],
      },
    )

    expect(report.device).toBe('cpu')
    expect(report.torchBuild).toBe('2.4.1+cpu')
    expect(report.currentModelLoaded).toBe('XTTSv2 Local')
    expect(report.deepspeedStatus).toBe(false)
    expect(report.gpuName).toBe('AMD Radeon RX 580')
  })

  it('reports a CUDA device when the wheel says so', async () => {
    const report = await probeAllTalkDevice(
      { baseUrl: baseUrl(), installDir: 'C:/fake/install', timeoutMs: 2000 },
      { readFileImpl: async () => '__version__ = \'2.4.1+cu121\'\n' },
    )
    expect(report.device).toBe('cuda')
  })

  it('never crashes on an unreadable install or an offline server - unknown, not fabricated', async () => {
    const report = await probeAllTalkDevice(
      { baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 },
      { readFileImpl: async () => { throw new Error('ENOENT') } },
    )
    expect(report.device).toBe('unknown')
    expect(report.currentModelLoaded).toBeUndefined()
  })

  it('reports note, not a device guess, when no install directory is configured', async () => {
    const report = await probeAllTalkDevice(
      { baseUrl: baseUrl(), timeoutMs: 2000 },
      { readFileImpl: async () => '__version__ = \'2.4.1+cpu\'\n' },
    )
    expect(report.device).toBe('unknown')
    expect(report.torchBuild).toBeUndefined()
    expect(report.note).toMatch(/external server/i)
    // Server-only facts are still collected.
    expect(report.currentModelLoaded).toBe('XTTSv2 Local')
  })

  it('log line is metadata-only and carries the device key', () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
      if (typeof line === 'string')
        lines.push(line)
    })
    try {
      logAllTalkDeviceReport({ device: 'cpu', torchBuild: '2.4.1+cpu', gpuName: 'AMD Radeon RX 580' })
      expect(lines).toHaveLength(1)
      expect(lines[0]).toContain('event=lia.voice.device')
      expect(lines[0]).toContain('device=cpu')
      expect(lines[0]).toContain('torchBuild=2.4.1+cpu')
      expect(lines[0]).toContain('gpuName=AMD Radeon RX 580')
    }
    finally {
      spy.mockRestore()
    }
  })
})
