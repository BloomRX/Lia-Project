import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const pidValid = value => Number.isSafeInteger(value) && value > 0
const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null
const roles = new Set(['renderer', 'utility', 'gpu-process', 'main_or_auxiliary'])
const fields = {
  workingSetBytes: p => p.workingSetBytes,
  privateWorkingSetBytes: p => p.privateWorkingSet?.status === 'available' ? p.privateWorkingSet.bytes : null,
  privateBytes: p => p.privateBytes,
  cpuPercentOfMachine: p => p.cpu?.status === 'available' ? p.cpu.percentOfMachine : null,
  cpuCores: p => p.cpu?.status === 'available' ? p.cpu.cpuCores : null,
  threadCount: p => p.threadCount,
}
function stats(values) {
  const valid = values.filter(finite)
  return {
    count: valid.length, missing: values.length - valid.length,
    mean: valid.length ? valid.reduce((sum, value) => sum + value / valid.length, 0) : null,
    peak: valid.length ? valid.reduce((peak, value) => Math.max(peak, value), 0) : null,
  }
}
function metrics(rows, get, lastStart) {
  return Object.fromEntries(Object.keys(fields).map((key) => {
    const all = stats(rows.map(row => get(row, key)))
    const first5Minutes = stats(rows.filter(row => row.time < 300).map(row => get(row, key)))
    const last5Minutes = stats(rows.filter(row => row.time >= lastStart).map(row => get(row, key)))
    return [key, { ...all, first5Minutes, last5Minutes,
      lastMinusFirst: first5Minutes.count && last5Minutes.count ? last5Minutes.mean - first5Minutes.mean : null }]
  }))
}

/** Pure aggregation. Does not mutate inputs, read files, launch processes or infer exclusive RAM. */
export function summarize(metadata, samples, summary) {
  if (!metadata || !Array.isArray(samples) || !Array.isArray(metadata.requestedProcessIds)
    || !metadata.requestedProcessIds.length || !metadata.requestedProcessIds.every(pidValid)
    || new Set(metadata.requestedProcessIds).size !== metadata.requestedProcessIds.length)
    throw new Error('Invalid requested process identities')
  const ids = [...metadata.requestedProcessIds]
  const initial = new Map()
  for (const p of metadata.initialProcesses ?? []) {
    if (initial.has(p.pid)) throw new Error('Duplicate initial process identity')
    initial.set(p.pid, p)
  }
  for (const id of ids) {
    if (initial.get(id)?.status !== 'available' || !timestamp(initial.get(id)?.startTimeUtc))
      throw new Error('Missing initial process identity')
  }
  const invalidTimingSamples = samples.filter(s => !finite(s?.startedAtSeconds) || !finite(s?.completedAtSeconds)
    || s.completedAtSeconds < s.startedAtSeconds).length
  const rows = samples.filter(s => finite(s?.startedAtSeconds) && finite(s?.completedAtSeconds)
    && s.completedAtSeconds >= s.startedAtSeconds).map(s => ({ sample: s, time: s.startedAtSeconds }))
    .sort((a, b) => a.time - b.time)
  const observedThroughSeconds = rows.reduce((end, row) => Math.max(end, row.sample.completedAtSeconds), 0)
  const durationFromSummary = finite(summary?.elapsedSeconds) && summary.elapsedSeconds >= observedThroughSeconds
  const end = durationFromSummary ? summary.elapsedSeconds : observedThroughSeconds
  const lastStart = Math.max(0, end - 300)
  const observations = rows.map((row) => {
    const grouped = new Map()
    for (const p of row.sample.processes ?? []) {
      if (!grouped.has(p.pid)) grouped.set(p.pid, [])
      grouped.get(p.pid).push(p)
    }
    return { ...row, processes: new Map(ids.map((id) => {
      const matches = grouped.get(id) ?? []
      const p = matches.length === 1 ? matches[0] : null
      const reason = !matches.length ? 'missing' : matches.length > 1 ? 'duplicate'
        : p.status !== 'available' ? 'unavailable'
          : p.startTimeUtc !== initial.get(id).startTimeUtc ? 'identity_mismatch' : null
      return [id, { value: reason ? null : p, reason }]
    })), unexpectedProcessCount: [...grouped.keys()].filter(id => !ids.includes(id)).length }
  })
  const value = (row, id, key) => {
    const p = row.processes.get(id).value
    const result = p ? fields[key](p) : null
    return finite(result) ? result : null
  }
  const processes = ids.map((pid) => {
    const identity = initial.get(pid)
    const role = metadata.processRoles?.[pid]
    return {
      pid, name: typeof identity.name === 'string' && /^[\w .-]{1,80}$/.test(identity.name) ? identity.name : null,
      role: roles.has(role?.role) ? role.role : null,
      parentPid: pidValid(role?.parentPid) ? role.parentPid : null,
      observations: Object.fromEntries(['missing', 'duplicate', 'unavailable', 'identity_mismatch']
        .map(reason => [reason, observations.filter(row => row.processes.get(pid).reason === reason).length])),
      metrics: metrics(observations, (row, key) => value(row, pid, key), lastStart),
    }
  })
  const totals = metrics(observations, (row, key) => {
    const values = ids.map(id => value(row, id, key))
    return values.every(finite) ? values.reduce((sum, x) => sum + x, 0) : null
  }, lastStart)
  const engineMap = new Map(), memoryMap = new Map()
  for (const row of observations) {
    for (const [source, target, keys] of [
      ['gpuEngine', engineMap, ['UtilizationPercentage']],
      ['gpuMemory', memoryMap, ['DedicatedUsage', 'SharedUsage']],
    ]) {
      const block = row.sample[source]
      if (block?.status !== 'available') continue
      const counters = Array.isArray(block.counters) ? block.counters : []
      const seen = new Set(), duplicate = new Set()
      for (const c of counters) {
        if (seen.has(c.instance)) duplicate.add(c.instance)
        seen.add(c.instance)
      }
      for (const c of counters) {
        // Accept only collector-shaped instances belonging to a verified process lifetime.
        const pattern = source === 'gpuEngine'
          ? /^pid_(\d+)_luid_0x[\da-f]+_0x[\da-f]+_phys_\d+_eng_\d+_engtype_[\w ]+$/i
          : /^pid_(\d+)_luid_0x[\da-f]+_0x[\da-f]+_phys_\d+$/i
        const match = typeof c.instance === 'string' ? pattern.exec(c.instance) : null
        if (!match || Number(match[1]) !== c.pid || !ids.includes(c.pid)
          || !row.processes.get(c.pid).value || duplicate.has(c.instance)) continue
        if (!target.has(c.instance)) target.set(c.instance, { pid: c.pid, instance: c.instance, rows: [] })
        target.get(c.instance).rows.push({ row, values: Object.fromEntries(keys.map(k => [k, c[k]])) })
      }
    }
  }
  function gpuRows(map, keys) {
    return [...map.values()].map(item => ({ pid: item.pid, instance: item.instance,
      metrics: Object.fromEntries(keys.map((key) => {
        const get = row => item.rows.find(x => x.row === row)?.values[key] ?? null
        const first5Minutes = stats(observations.filter(row => row.time < 300).map(get))
        const last5Minutes = stats(observations.filter(row => row.time >= lastStart).map(get))
        return [key, { ...stats(observations.map(get)), first5Minutes, last5Minutes,
          lastMinusFirst: first5Minutes.count && last5Minutes.count ? last5Minutes.mean - first5Minutes.mean : null }]
      })) }))
  }
  const memory = gpuRows(memoryMap, ['DedicatedUsage', 'SharedUsage'])
  return {
    schemaVersion: 1, sampleCount: samples.length, validTimingSampleCount: rows.length, invalidTimingSamples,
    startedAtUtc: timestamp(metadata.startedAtUtc), firstSampleUtc: timestamp(rows[0]?.sample.utc),
    lastSampleUtc: timestamp(rows.at(-1)?.sample.utc), durationSeconds: end, observedThroughSeconds,
    durationSource: durationFromSummary ? 'summary.elapsedSeconds' : 'observed_samples',
    collectionStatus: ['completed', 'failed', 'cancelled', 'running'].includes(summary?.status) ? summary.status : null,
    intervalSeconds: finite(metadata.intervalSeconds) ? metadata.intervalSeconds : null,
    logicalProcessors: pidValid(metadata.logicalProcessors) ? metadata.logicalProcessors : null,
    windows: { first: [0, 300], last: [lastStart, end], overlap: end < 600 },
    unexpectedProcessObservations: observations.reduce((sum, row) => sum + row.unexpectedProcessCount, 0),
    processes, totals,
    gpu: { engineAvailableSamples: rows.filter(row => row.sample.gpuEngine?.status === 'available').length,
      memoryAvailableSamples: rows.filter(row => row.sample.gpuMemory?.status === 'available').length,
      engines: gpuRows(engineMap, ['UtilizationPercentage']),
      memoryByPid: ids.map(pid => ({ pid, instances: memory.filter(x => x.pid === pid) })) },
    limits: ['Fixed requested PID cohort; process lifetime verified against initial startTimeUtc.',
      'Summed working sets include shared pages and are not exclusive physical RAM.',
      'GPU engine percentages are per instance and never summed; PID counter caches can lag lifetimes.',
      'Missing, unavailable and invalid numeric values excluded per field; zero remains valid.',
      'FPS, frame time, game impact and power are not measured by this collector.'],
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage')
    const directory = resolve(process.argv[2])
    const metadata = JSON.parse(await readFile(resolve(directory, 'metadata.json'), 'utf8'))
    const samples = (await readFile(resolve(directory, 'samples.jsonl'), 'utf8')).split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line))
    let summary
    try {
      summary = JSON.parse(await readFile(resolve(directory, 'summary.json'), 'utf8'))
    }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    process.stdout.write(`${JSON.stringify(summarize(metadata, samples, summary), null, 2)}\n`)
  }
  catch {
    process.stderr.write('Unable to summarize collector artifacts. Usage: node summarize.mjs <artifact-directory>\n')
    process.exitCode = 1
  }
}
