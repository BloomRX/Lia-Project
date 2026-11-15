import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inventoryEntries, defaultArchives } from '../../tools/release/inventory-packaged-licenses.mjs'

test('reports package declarations and adjacent notices without approving redistribution', () => {
  const manifests = {
    'package.json': { name: 'private-app', version: '1', license: 'UNLICENSED' },
    'node_modules/a/package.json': { name: 'a', version: '2', license: { type: 'MIT' } },
    'node_modules/a/node_modules/b/package.json': { name: 'b', licenses: [{ type: 'BSD' }] },
  }
  const reads = []
  const report = inventoryEntries([
    ...Object.keys(manifests), '/LICENSE', '/node_modules/a/LICENSE.txt',
    '/node_modules/a/COPYING', '/node_modules/a/node_modules/b/README.md',
    '/node_modules/a/not-a-license.txt', '/node_modules/a/LICENSE.txt',
  ], path => { reads.push(path); return JSON.stringify(manifests[path]) })
  assert.equal(report.classification, 'unverified')
  assert.deepEqual(reads.sort(), Object.keys(manifests).sort())
  assert.deepEqual(report.counts, { files: 8, packages: 3, packagesWithNotices: 2, notices: 3 })
  const b = report.packages.find(pkg => pkg.name === 'b')
  assert.equal(b.version, null)
  assert.deepEqual(b.declaredLicense, [{ type: 'BSD' }])
  assert.deepEqual(b.noticeFiles, [])
  assert.equal(b.noticeReview, 'notice-not-found-at-package-root')
  assert.ok(report.packages.every(pkg => pkg.classification === 'unverified'))
})

test('counts path evidence for fonts and avatar formats without reading assets', () => {
  const report = inventoryEntries([
    '\\assets\\font.WOFF2', '/avatar.vrm', '/live2d/model.moc3',
    '/assets/CubismCore.js', '/spine/hero.skel', '/normal.png',
  ], () => { throw new Error('Assets must not be read') })
  assert.deepEqual(Object.fromEntries(Object.entries(report.assets).map(([key, value]) => [key, value.count])),
    { fonts: 1, vrm: 1, cubism: 2, spine: 1 })
  assert.deepEqual(report.packages, [])
  assert.equal(defaultArchives.length, 2)
  assert.ok(defaultArchives.every(path => path.endsWith('app.asar')))
})

test('invalid package metadata fails visibly rather than silently omitting a package', () => {
  assert.throws(() => inventoryEntries(['package.json'], () => '{bad'), SyntaxError)
})
