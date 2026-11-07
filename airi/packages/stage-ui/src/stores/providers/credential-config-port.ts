/** Host-owned credentials never become part of the renderer provider configuration. */
export interface ProviderCredentialConfigPort {
  owns: (providerId: string) => boolean
  has: (providerId: string) => Promise<boolean>
  save: (providerId: string, value: string) => Promise<boolean>
}

const ports: Array<{ port: ProviderCredentialConfigPort }> = []

export function registerProviderCredentialConfigPort(port: ProviderCredentialConfigPort): () => void {
  const registration = { port }
  ports.push(registration)
  return () => {
    const index = ports.indexOf(registration)
    if (index >= 0)
      ports.splice(index, 1)
  }
}

export function getProviderCredentialConfigPort(providerId: string): ProviderCredentialConfigPort | undefined {
  return [...ports].reverse().find(({ port }) => port.owns(providerId))?.port
}
