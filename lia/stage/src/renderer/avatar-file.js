export const maxAvatarBytes = 64 * 1024 * 1024

export function validateLocalAvatar(bytes) {
  if (!(bytes instanceof ArrayBuffer) || bytes.byteLength < 20 || bytes.byteLength > maxAvatarBytes)
    throw new Error('avatar-size')
  const header = new DataView(bytes)
  const jsonLength = header.getUint32(12, true)
  if (header.getUint32(0, true) !== 0x46546C67 || header.getUint32(4, true) !== 2
    || header.getUint32(8, true) !== bytes.byteLength || header.getUint32(16, true) !== 0x4E4F534A
    || jsonLength % 4 !== 0 || jsonLength > bytes.byteLength - 20)
    throw new Error('avatar-format')
  const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, 20, jsonLength)))
  if (!json?.extensions?.VRM && !json?.extensions?.VRMC_vrm)
    throw new Error('avatar-format')
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (Object.hasOwn(resource, 'uri'))
      throw new Error('avatar-resource')
  }
}
