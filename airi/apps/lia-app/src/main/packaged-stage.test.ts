import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { resolvePackagedStage } from './packaged-stage'

const fixtures: string[] = []
afterEach(() => {
  for (const directory of fixtures.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function installation() {
  const resources = mkdtempSync(join(tmpdir(), 'Lia installation & spaces '))
  fixtures.push(resources)
  const stage = join(resources, 'stage')
  mkdirSync(join(stage, 'resources'), { recursive: true })
  writeFileSync(join(stage, 'LiaStage.exe'), 'fixture')
  writeFileSync(join(stage, 'resources', 'app.asar'), 'fixture')
  writeFileSync(join(stage, 'icudtl.dat'), 'fixture')
  return { resources, stage }
}

describe('packaged Stage installation contract', () => {
  it('resolves a real installation outside the repository without Node, pnpm or a shell', () => {
    const { resources, stage } = installation()
    expect(resolvePackagedStage(resources)).toEqual({
      command: join(stage, 'LiaStage.exe'),
      args: [],
      cwd: stage,
    })
  })

  it.each(['LiaStage.exe', 'resources/app.asar', 'icudtl.dat'])('fails clearly when %s is missing', (file) => {
    const { resources, stage } = installation()
    rmSync(join(stage, file))
    expect(() => resolvePackagedStage(resources)).toThrow('instalação da personagem está incompleta')
  })

  it('rejects a relative resource root', () => {
    expect(() => resolvePackagedStage('../stage')).toThrow('localizar a instalação')
  })
})
