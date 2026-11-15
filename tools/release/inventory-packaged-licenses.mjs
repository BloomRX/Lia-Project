import { createHash } from 'node:crypto'
import { createReadStream, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve, posix, normalize } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const defaultArchives = [
  'airi/apps/lia-app/dist/windows/win-unpacked/resources/app.asar',
  'airi/apps/lia-app/dist/windows/win-unpacked/resources/stage/resources/app.asar',
].map(path => resolve(repoRoot, path))

// Only metadata is read. Declared licenses never constitute redistribution approval.
export function inventoryEntries(entries, readManifest) {
  const paths = [...new Set(entries.map(path => path.replaceAll('\\', '/').replace(/^\/+/, '')))].sort()
  const notices = paths.filter(path => /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i.test(posix.basename(path)))
  const packages = paths.filter(path => posix.basename(path) === 'package.json').map(path => {
    const manifest = JSON.parse(readManifest(path))
    const root = posix.dirname(path)
    const noticeFiles = notices.filter(notice => posix.dirname(notice) === root)
    return {
      path, name: manifest.name ?? null, version: manifest.version ?? null,
      declaredLicense: manifest.license ?? manifest.licenses ?? null,
      noticeFiles, classification: 'unverified',
      noticeReview: noticeFiles.length ? 'review-existing-notices' : 'notice-not-found-at-package-root',
    }
  })
  const assetPaths = {
    fonts: paths.filter(path => /\.(?:woff2?|ttf|otf|eot)$/i.test(path)),
    vrm: paths.filter(path => /\.vrm$/i.test(path)),
    cubism: paths.filter(path => /(?:cubism|live2d)|\.(?:moc3|model3\.json|motion3\.json|exp3\.json|physics3\.json)$/i.test(path)),
    spine: paths.filter(path => /spine|\.skel$/i.test(path)),
  }
  return {
    classification: 'unverified', packages, noticeFiles: notices,
    assets: Object.fromEntries(Object.entries(assetPaths).map(([kind, files]) => [kind, { count: files.length, paths: files }])),
    counts: { files: paths.length, packages: packages.length, packagesWithNotices: packages.filter(pkg => pkg.noticeFiles.length).length, notices: notices.length },
  }
}

export async function inventoryArchives(archives = defaultArchives) {
  // Resolve installed tooling lazily; importing the pure inventory requires no workspace dependencies.
  const builder = realpathSync(resolve(repoRoot, 'airi/apps/stage-tamagotchi/node_modules/electron-builder/package.json'))
  const builderLib = createRequire(builder).resolve('app-builder-lib/package.json')
  const asar = createRequire(builderLib)('@electron/asar')
  return {
    schemaVersion: 1,
    redistributionApproved: false,
    limits: [
      'Package metadata is a declaration, not legal approval; all entries remain unverified.',
      'Notice presence is checked at package root only; notice contents are not read.',
      'Assets are counted by path only; categories may overlap and bundled code may hide dependencies.',
      'Only the two ASAR archives are covered; unpacked files, runtime and installer require separate review.',
    ],
    archives: await Promise.all(archives.map(async (archive) => {
      const entries = asar.listPackage(archive).map(path => path.slice(1)).filter(path => {
        const stat = asar.statFile(archive, path, false)
        return !stat.files && !stat.link
      })
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(archive))
        hash.update(chunk)
      return {
        path: archive, sha256: hash.digest('hex'),
        ...inventoryEntries(entries, path => asar.extractFile(archive, normalize(path)).toString('utf8')),
      }
    })),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 2)
    throw new Error('This command accepts no arguments; archive paths are fixed to the repository.')
  console.log(JSON.stringify(await inventoryArchives(), null, 2))
}
