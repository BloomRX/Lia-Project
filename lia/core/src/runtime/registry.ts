/**
 * Publicação e leitura do registro de instância do Runtime.
 *
 * O arquivo é o único ponto de encontro entre processos que não se conhecem
 * ainda: o Runtime escreve, o Launcher lê. Duas propriedades importam mais que
 * a forma do JSON:
 *
 *  1. **escrita atômica** — um leitor concorrente nunca vê metade de um
 *     registro. Escreve-se num temporário e renomeia-se sobre o destino, que é
 *     atômico no mesmo volume.
 *  2. **remoção condicional** — uma instância só apaga o registro cuja
 *     `instanceId` é a sua. Sem isso, uma instância que está saindo apagaria o
 *     registro de uma instância nova que acabou de assumir, e o Launcher
 *     passaria a achar que não existe Runtime nenhum.
 */

import type { RuntimeInstanceRecord } from './instance.ts'

import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import process from 'node:process'

import { parseRuntimeRecord } from './instance.ts'

export const RUNTIME_RECORD_FILENAME = 'runtime.json'

export type RuntimeRegistryRead
  = | { ok: true, record: RuntimeInstanceRecord }
    | { ok: false, problem: 'invalid' | 'missing' | 'unreadable', detail?: string }

export interface RuntimeRegistry {
  /** Caminho absoluto do registro (diagnóstico; nunca é segredo). */
  filePath: string
  /** Diretório de estado desta instalação (endpoint, logs, registro). */
  stateDir: string
  /** Publica o registro de forma atômica. */
  publish: (record: RuntimeInstanceRecord) => Promise<void>
  /** Lê e valida. Nunca lança: ausência e corrupção são estados, não exceções. */
  read: () => Promise<RuntimeRegistryRead>
  /**
   * Remove o registro **somente** se ele ainda pertencer a `instanceId`.
   * Devolve `true` quando removeu, `false` quando o registro já era de outro.
   */
  remove: (instanceId: string) => Promise<boolean>
}

export function createRuntimeRegistry(stateDir: string): RuntimeRegistry {
  const filePath = join(stateDir, RUNTIME_RECORD_FILENAME)

  return {
    filePath,
    stateDir,

    async publish(record) {
      await mkdir(stateDir, { mode: 0o700, recursive: true })
      const temporary = `${filePath}.${process.pid}.${globalThis.crypto.randomUUID()}.tmp`
      // 0600 no arquivo temporário: a permissão viaja com o rename.
      await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      try {
        await rename(temporary, filePath)
      }
      catch (error) {
        await unlink(temporary).catch(() => {})
        throw error
      }
      // Windows ignora o modo; POSIX já nasceu 0600. Reforçar é barato.
      await chmod(filePath, 0o600).catch(() => {})
    },

    async read() {
      let raw: string
      try {
        raw = await readFile(filePath, 'utf8')
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          return { ok: false, problem: 'missing' }
        return { ok: false, detail: (error as Error).name, problem: 'unreadable' }
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      }
      catch {
        return { ok: false, problem: 'invalid', detail: 'not-json' }
      }
      const result = parseRuntimeRecord(parsed)
      if (!result.ok)
        return { ok: false, problem: 'invalid', detail: result.reason }
      return { ok: true, record: result.record }
    },

    async remove(instanceId) {
      const current = await this.read()
      if (!current.ok || current.record.instanceId !== instanceId)
        return false
      await unlink(filePath).catch(() => {})
      return true
    },
  }
}
