import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { setupFileLogger } from './file-logger'

const host = vi.hoisted(() => ({ directory: '' }))
vi.mock('electron', () => ({ app: { getPath: () => host.directory } }))

describe('main file log credential redaction', () => {
  it('redacts structured credentials before disk while preserving technical context', async () => {
    host.directory = await mkdtemp(join(tmpdir(), 'lia-log-credentials-'))
    const logger = await setupFileLogger()
    try {
      expect(logger.logFilePath).not.toBeNull()
      await logger.appendLog('request https://example.invalid/generate?key=SYNTHETIC_QUERY_SECRET&mode=test')
      await logger.appendLog(JSON.stringify({ apiKey: 'SYNTHETIC_JSON_SECRET', accessKeySecret: 'SYNTHETIC_ACCESS_SECRET', error: 'connection rejected' }))
      await logger.appendLog('Authorization: Bearer SYNTHETIC_BEARER_SECRET')
      await logger.close()
      const bytes = await readFile(logger.logFilePath!, 'utf8')
      expect(bytes).not.toContain('SYNTHETIC_')
      expect(bytes).toContain('https://example.invalid/generate?key=***&mode=test')
      expect(bytes).toContain('connection rejected')
    }
    finally {
      await logger.close()
      await rm(host.directory, { recursive: true, force: true })
    }
  })
})
