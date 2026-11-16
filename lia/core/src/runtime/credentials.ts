/**
 * Credenciais servidas PELO Runtime.
 *
 * O bloqueador D04-B2: o cofre vivia no processo do Launcher. Quando o
 * Launcher fechava, o pipe caía e `resolveMainCredential` virava
 * `ProviderError('credentials')` — o Runtime continuava aberto e perdia todos
 * os providers. A correção não é "reconectar": é mudar a propriedade. Quem
 * fica vivo é dono do cofre.
 *
 * Este módulo é a metade do Runtime: recebe `credentials.get/set/delete` pelo
 * canal de controle autenticado e executa contra o cofre local. O Launcher
 * deixa de escrever direto no arquivo enquanto houver Runtime — assim existem
 * um dono e um caminho de escrita por vez, em vez de dois processos compondo
 * o mesmo arquivo.
 *
 * O que NÃO muda: valor de credencial nunca atravessa um Renderer. O canal é
 * Main↔Main; a resposta de `get` existe só para o Main do Launcher (que já
 * conseguiria decifrar o arquivo de qualquer forma).
 */

import type { ControlHandler } from './control.ts'

import { ControlError } from './control.ts'

/**
 * O subconjunto do cofre que o Runtime precisa. Estrutural de propósito: o
 * `LiaSecretVault` de `@lia/core` satisfaz este contrato sem que `@lia/contracts`
 * passe a depender dele.
 */
export interface RuntimeSecretStore {
  getSecret: (scope: string, key: string) => string | undefined
  hasSecret: (scope: string, key: string) => boolean
  deleteSecret: (scope: string, key: string) => Promise<boolean>
  secretRevision?: (scope: string, key: string) => string
  changeSecret?: (
    scope: string,
    key: string,
    value: string | undefined,
    options: { expectedRevision: string, signal?: AbortSignal },
  ) => Promise<{ revision: string } | undefined>
  setSecret: (scope: string, key: string, value: string, signal?: AbortSignal, revision?: string) => Promise<boolean>
}

export interface CredentialHandlerOptions {
  /** Gravações serializadas no processo do Runtime. */
  serialize?: <T>(action: () => Promise<T>) => Promise<T>
  /** Permite negar um escopo antes de qualquer leitura. Padrão: tudo permitido. */
  isAllowed?: (scope: string, operation: 'delete' | 'get' | 'set') => boolean
}

/**
 * Handler do canal de controle para o domínio de credenciais.
 *
 * Erros viram `ControlError` com código fechado — nunca a mensagem crua de uma
 * exceção de criptografia, que pode conter fragmento de caminho ou de payload.
 */
export function createCredentialHandler(store: RuntimeSecretStore, options: CredentialHandlerOptions = {}): ControlHandler {
  const serialize = options.serialize ?? (<T>(action: () => Promise<T>) => action())
  const isAllowed = options.isAllowed ?? (() => true)

  const ensureAllowed = (scope: string, operation: 'delete' | 'get' | 'set') => {
    if (!isAllowed(scope, operation))
      throw new ControlError('denied', 'credential scope is not served by this runtime')
  }

  const revisionOf = (scope: string): string => {
    const revision = store.secretRevision?.(scope, 'apiKey')
    if (!revision)
      throw new ControlError('unavailable', 'credential revision is not available')
    return revision
  }

  return async (request, signal) => {
    if (signal.aborted)
      throw new ControlError('timeout', 'request cancelled')
    const payload = request.payload ?? {}
    const scope = payload.scope as string
    const key = payload.key as string

    switch (request.command) {
      case 'credentials.get': {
        ensureAllowed(scope, 'get')
        try {
          return store.hasSecret(scope, key) ? store.getSecret(scope, key) : undefined
        }
        catch {
          // Entrada ilegível é preservada, nunca reescrita nem descartada.
          throw new ControlError('unavailable', 'credential is unreadable')
        }
      }

      case 'credentials.set': {
        ensureAllowed(scope, 'set')
        const value = payload.value as string
        const expectedRevision = (payload.expectedRevision as string | undefined) ?? revisionOf(scope)
        return await serialize(async () => {
          if (signal.aborted)
            throw new ControlError('timeout', 'request cancelled')
          if (store.changeSecret) {
            const change = await store.changeSecret(scope, key, value, { expectedRevision, signal })
            if (!change)
              throw new ControlError('denied', 'credential write was rejected')
            return change.revision
          }
          const ok = await store.setSecret(scope, key, value, signal, expectedRevision)
          return ok ? store.secretRevision?.(scope, key) : false
        })
      }

      case 'credentials.delete': {
        ensureAllowed(scope, 'delete')
        return await serialize(async () => await store.deleteSecret(scope, key))
      }

      default:
        throw new ControlError('unsupported', request.command)
    }
  }
}
