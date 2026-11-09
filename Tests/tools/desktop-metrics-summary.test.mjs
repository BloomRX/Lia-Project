import assert from 'node:assert/strict'
import test from 'node:test'

import { summarize } from '../../tools/desktop-benchmark/summarize.mjs'

const epoch = '2026-11-08T22:00:00.000Z'
const instance = 'pid_7_luid_0x00000000_0x0000D987_phys_0_eng_0_engtype_3D'
function fixture() {
  const metadata = { startedAtUtc: epoch, intervalSeconds: 5, logicalProcessors: 12,
    requestedProcessIds: [7], initialProcesses: [{ pid: 7, status: 'available', startTimeUtc: epoch, name: 'LiaStage' }],
    processRoles: { 7: { role: 'gpu-process', parentPid: 3 } }, commandLine: 'NEVER_EXPORT', environment: 'NEVER_EXPORT' }
  const samples = [0, 5, 605].map((time, index) => ({
    utc: new Date(Date.parse(epoch) + time * 1000).toISOString(), startedAtSeconds: time, completedAtSeconds: time + 1,
    processes: [{ pid: 7, status: 'available', startTimeUtc: epoch, workingSetBytes: 100 + index * 10,
      privateBytes: 1000 + index * 100, threadCount: 2, privateWorkingSet: { status: 'available', bytes: 40 },
      cpu: { status: 'available', percentOfMachine: 0, cpuCores: 0 } }],
    gpuEngine: { status: 'available', counters: [{ pid: 7, instance, UtilizationPercentage: 0 }] },
    gpuMemory: { status: 'available', counters: [{ pid: 7,
      instance: instance.split('_eng_')[0], DedicatedUsage: 20, SharedUsage: 5 }] },
  }))
  return { metadata, samples }
}
test('excludes missing fields but retains zero CPU/GPU and input immutability', () => {
  const { metadata, samples } = fixture()
  samples[1].processes[0].privateWorkingSet = { status: 'unavailable' }
  const before = JSON.stringify({ metadata, samples })
  const result = summarize(metadata, samples)
  assert.equal(result.totals.privateWorkingSetBytes.count, 2)
  assert.equal(result.totals.privateWorkingSetBytes.mean, 40)
  assert.equal(result.totals.cpuPercentOfMachine.count, 3)
  assert.equal(result.totals.cpuPercentOfMachine.mean, 0)
  assert.equal(result.gpu.engines[0].metrics.UtilizationPercentage.count, 3)
  assert.equal(result.gpu.engines[0].metrics.UtilizationPercentage.mean, 0)
  assert.equal(result.gpu.memoryByPid[0].instances[0].metrics.DedicatedUsage.mean, 20)
  assert.equal(result.gpu.memoryByPid[0].instances[0].metrics.SharedUsage.mean, 5)
  assert.equal(JSON.stringify({ metadata, samples }), before)
  assert.ok(!JSON.stringify(result).includes('NEVER_EXPORT'))
})
test('reports process loss and identity mismatch without contaminating totals or GPU', () => {
  const { metadata, samples } = fixture()
  samples[1].processes[0].status = 'unavailable'
  samples[2].processes[0].startTimeUtc = '2026-11-08T22:00:01.000Z'
  const result = summarize(metadata, samples)
  assert.equal(result.processes[0].observations.unavailable, 1)
  assert.equal(result.processes[0].observations.identity_mismatch, 1)
  assert.equal(result.totals.privateBytes.count, 1)
  assert.equal(result.gpu.engines[0].metrics.UtilizationPercentage.count, 1)
})
test('keeps committed memory separate from shared working sets and compares windows', () => {
  const { metadata, samples } = fixture()
  const result = summarize(metadata, samples)
  assert.equal(result.totals.privateBytes.mean, 1100)
  assert.equal(result.totals.workingSetBytes.mean, 110)
  assert.equal(result.totals.workingSetBytes.lastMinusFirst, 15)
  assert.equal(result.windows.overlap, false)
  assert.equal(result.durationSeconds, 606)
  assert.equal(result.observedThroughSeconds, 606)
  assert.equal(result.durationSource, 'observed_samples')
  assert.equal(result.collectionStatus, null)
  assert.ok(result.limits.some(text => text.includes('not exclusive')))
})
test('rejects invalid numeric values and excludes missing and duplicate processes', () => {
  const { metadata, samples } = fixture()
  samples[0].processes[0].privateBytes = Number.NaN
  samples[0].gpuEngine.counters[0].UtilizationPercentage = Number.POSITIVE_INFINITY
  samples[1].processes = []
  samples[2].processes.push({ ...samples[2].processes[0] })
  const result = summarize(metadata, samples)
  assert.equal(result.totals.privateBytes.count, 0)
  assert.equal(result.totals.privateBytes.mean, null)
  assert.equal(result.processes[0].observations.missing, 1)
  assert.equal(result.processes[0].observations.duplicate, 1)
  assert.equal(result.gpu.engines[0].metrics.UtilizationPercentage.count, 0)
  assert.throws(() => summarize({ ...metadata, requestedProcessIds: [7, 7] }, samples))
})
test('uses collection elapsed time for duration/windows without inventing completion', () => {
  const { metadata, samples } = fixture()
  const result = summarize(metadata, samples, { elapsedSeconds: 610, status: 'completed' })
  assert.equal(result.durationSeconds, 610)
  assert.equal(result.observedThroughSeconds, 606)
  assert.equal(result.durationSource, 'summary.elapsedSeconds')
  assert.equal(result.collectionStatus, 'completed')
  assert.deepEqual(result.windows.last, [310, 610])
  const partial = summarize(metadata, samples, { elapsedSeconds: 100, status: 'running' })
  assert.equal(partial.durationSeconds, 606)
  assert.equal(partial.durationSource, 'observed_samples')
  assert.equal(partial.collectionStatus, 'running')
})
