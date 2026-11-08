import { existsSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** Keep the original cipher profile when present, independent of package name. */
export function launcherProfilePath(appData: string, exists: (path: string) => boolean = existsSync) {
  const previous = join(appData, '@lia', 'lia-app')
  return exists(previous) ? previous : join(appData, 'Lia', 'launcher-profile')
}

export function sameProfileDirectory(left: string, right: string) {
  const canonical = (path: string) => {
    try {
      return realpathSync(path).toLowerCase()
    }
    catch {
      return resolve(path).toLowerCase()
    }
  }
  return canonical(left) === canonical(right)
}
