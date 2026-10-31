import type { JSONValue, TransportRecord } from './contracts.ts'

const secretKeys = new Set(['apikey', 'token', 'accesstoken', 'refreshtoken', 'authtoken', 'password', 'passwd', 'secret', 'clientsecret', 'authorization', 'cookie', 'headers', 'proto', 'constructor', 'prototype', 'privatekey', 'signingkey', 'credential', 'credentials', 'auth', 'authentication', 'bearer', 'sessiontoken'])
const recordKeys = new Set(['id', 'providerId', 'definitionId', 'type', 'protocol', 'baseUrl', 'adapterOptions', 'modelIds', 'enabled', 'metadata', 'credentialRef'])

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && value.trim() === value && !/[\u0000-\u001F\u007F]/.test(value)
}

function endpoint(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096 || value.trim() !== value)
    return false
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash
  }
  catch {
    return false
  }
}

function safeJson(value: unknown, depth = 0): value is JSONValue {
  if (depth > 12)
    return false
  if (value === null || typeof value === 'boolean')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (typeof value === 'string') {
    if (value.length > 16384)
      return false
    if (/^https?:\/\//i.test(value)) {
      try {
        const url = new URL(value)
        return !url.username && !url.password && ![...url.searchParams.keys()].some(key => secretKeys.has(key.toLowerCase().replaceAll(/[-_]/g, '')))
      }
      catch {
        return false
      }
    }
    return true
  }
  if (Array.isArray(value))
    return value.length <= 1000 && value.every(item => safeJson(item, depth + 1))
  return object(value) && Object.keys(value).length <= 1000 && Object.entries(value).every(([key, item]) =>
    !secretKeys.has(key.toLowerCase().replaceAll(/[-_]/g, '')) && safeJson(item, depth + 1))
}

/** Also used at IPC/import boundaries; does not return rejected private content. */
export function isTransportRecord(value: unknown): value is TransportRecord {
  if (!object(value) || !Object.keys(value).every(key => recordKeys.has(key)))
    return false
  return identifier(value.id) && identifier(value.providerId) && identifier(value.definitionId)
    && value.type === 'http' && value.protocol === 'chat-completions' && endpoint(value.baseUrl)
    && typeof value.enabled === 'boolean' && object(value.adapterOptions) && safeJson(value.adapterOptions)
    && JSON.stringify(value.adapterOptions).length <= 65536
    && Array.isArray(value.modelIds) && value.modelIds.length <= 1000 && value.modelIds.every(identifier)
    && new Set(value.modelIds).size === value.modelIds.length
    && object(value.metadata) && Object.keys(value.metadata).every(key => key === 'label')
    && (value.metadata.label === undefined || identifier(value.metadata.label))
    && object(value.credentialRef) && Object.keys(value.credentialRef).every(key => key === 'scope' || key === 'key')
    && value.credentialRef.scope === value.providerId && value.credentialRef.key === 'apiKey'
}
