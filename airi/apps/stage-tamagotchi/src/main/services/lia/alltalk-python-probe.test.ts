import { describe, expect, it } from 'vitest'

import {
  parseTorchFacts,
  probeTorchFactsWithManagedPython,
  torchInterpreterCandidates,
} from './alltalk-python-probe'

/**
 * Phase 7.7.2, item 6: the managed PYTHON INTERPRETER answers the device
 * question when the wheel's version file cannot (torchBuild=2.2.1, no
 * suffix). Facts are parsed from a single prefixed JSON line - nothing else
 * the interpreter prints is trusted.
 */
describe('probeTorchFactsWithManagedPython', () => {
  it('parses a CPU-bound AMD runtime from the interpreter line', async () => {
    const facts = await probeTorchFactsWithManagedPython('C:/install', {
      existsImpl: () => true,
      execFileImpl: async () => ({
        stdout: 'some boot banner\nLIA-TORCH-FACTS:{"torchVersion":"2.2.1","cudaAvailable":false,"cudaVersion":"12.1"}\n',
      }),
    })
    expect(facts?.torchVersion).toBe('2.2.1')
    expect(facts?.cudaAvailable).toBe(false)
    expect(facts?.cudaVersion).toBe('12.1')
    expect(facts?.deviceName).toBeUndefined()
  })

  it('never labels GPU acceleration without a true cudaAvailable', async () => {
    const facts = await probeTorchFactsWithManagedPython('C:/install', {
      existsImpl: () => true,
      execFileImpl: async () => ({
        stdout: 'LIA-TORCH-FACTS:{"torchVersion":"2.2.1","cudaAvailable":false,"cudaVersion":null}',
      }),
    })
    expect(facts?.cudaAvailable).toBe(false)
    expect(facts?.cudaVersion).toBeNull()
  })

  it('reports a true CUDA device when the interpreter proves one', async () => {
    const facts = await probeTorchFactsWithManagedPython('C:/install', {
      existsImpl: () => true,
      execFileImpl: async () => ({
        stdout: 'LIA-TORCH-FACTS:{"torchVersion":"2.2.1+cu121","cudaAvailable":true,"cudaVersion":"12.1","deviceName":"NVIDIA RTX 4070"}',
      }),
    })
    expect(facts?.cudaAvailable).toBe(true)
    expect(facts?.deviceName).toBe('NVIDIA RTX 4070')
  })

  it('degrades to undefined - never a crash, never fabrication', async () => {
    // No interpreter exists.
    expect(await probeTorchFactsWithManagedPython('C:/install', {
      existsImpl: () => false,
      execFileImpl: async () => ({ stdout: '' }),
    })).toBeUndefined()
    // Interpreter dies (timeout, antivirus block).
    expect(await probeTorchFactsWithManagedPython('C:/install', {
      existsImpl: () => true,
      execFileImpl: async () => { throw new Error('ETIMEDOUT') },
    })).toBeUndefined()
    // Garbage output.
    expect(await probeTorchFactsWithManagedPython('C:/install', {
      existsImpl: () => true,
      execFileImpl: async () => ({ stdout: 'totally unrelated output\n' }),
    })).toBeUndefined()
  })

  it('exposes the candidate layout on both platforms', () => {
    for (const candidate of torchInterpreterCandidates('C:/install')) {
      expect(candidate).toContain('alltalk_environment')
      expect(candidate).not.toContain('LIA-TORCH-FACTS')
    }
  })
})

describe('parseTorchFacts', () => {
  it('ignores everything but the prefixed line and tolerates junk JSON', () => {
    expect(parseTorchFacts('a\nb\n')).toBeUndefined()
    expect(parseTorchFacts('LIA-TORCH-FACTS:not-json')).toBeUndefined()
    expect(parseTorchFacts('LIA-TORCH-FACTS:{"error":"ImportError"}')?.error).toBe('ImportError')
  })
})
