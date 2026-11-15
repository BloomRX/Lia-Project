# Solicitação de parecer — Architecture/Security — `updateCredits()` em `auth.ts`

**Data:** 15/11/2026
**Solicitante:** agente principal de desenvolvimento
**Origem da alteração:** `arena/4ec8f22b-lia-project`, commit `be24b94f7b0127e1eb6d69adcb05a2e554555989`
**Base declarada:** `407300b8baa56b0ed8d14b7b2c0628222754e51f`
**Arquivo em questão:** `airi/packages/stage-ui/src/stores/auth.ts`
**Estado:** **NÃO INTEGRADO** à branch de desenvolvimento. A integração parcial da Onda 1 excluiu este arquivo de propósito e aguarda este parecer.

---

## 1. Por que este arquivo ficou de fora

A autorização de integração parcial da Onda 1 listou 7 arquivos de higiene + 1 relatório e proibiu expressamente integrar `airi/packages/stage-ui/src/stores/auth.ts` antes de parecer técnico do responsável por Architecture/Security. A alteração mexe em autenticação (superfície SEC-01/SEC-02/SEC-03) e convive com a decisão DP-4 (OIDC fora do caminho funcional do beta interno, sem remoção definitiva).

## 2. Alteração proposta (diff exato)

```diff
@@ -356,10 +356,17 @@ export const useAuthStore = defineStore('auth', () => {
   const updateCredits = async () => {
     if (!isAuthenticated.value)
       return
-    const res = await client.api.v1.flux.$get()
-    if (res.ok) {
-      const data = await res.json()
-      credits.value = data.flux
+    try {
+      const res = await client.api.v1.flux.$get()
+      if (res.ok) {
+        const data = await res.json()
+        credits.value = data.flux
+      }
+    }
+    catch (error) {
+      // Fire-and-forget credits refresh: a network/auth failure (e.g. the
+      // upstream API is unreachable) must not surface as an unhandled rejection.
+      console.error('Failed to fetch credits', errorMessageFrom(error))
     }
   }
```

Contexto de chamada (inalterado): `watch(isAuthenticated, ...)` executa `void updateCredits()` — fire-and-forget —, e é essa chamada sem manipulador que produzia a rejeição não tratada que derrubava a suíte de `stage-ui` com exit 1 (QA-02: 1.153 testes PASS, exit 1).

## 3. O que o solicitante já verificou

| Verificação | Resultado |
|---|---|
| `auth.ts` é o único arquivo não integrado do conjunto autorizado | confirmado |
| O diff não altera assinatura, armazenamento, refresh, logout nem escopo de token | confirmado por leitura |
| `errorMessageFrom` já é importado de `@moeru/std` no topo do arquivo | confirmado |
| `no-console` permite `console.error` na config do repositório | confirmado |
| A suíte `stage-ui` não foi reexecutada nesta rodada | não executado |

## 4. Perguntas específicas para o parecer

1. **Silenciamento de falha de autenticação.** O `catch` transforma qualquer falha de `client.api.v1.flux.$get()` (rede, 401, 403, 5xx, parse) em um `console.error` e mantém `credits` no valor anterior. Isso pode mascarar sessão inválida ou expirada de um jeito que o produto trate como "sem créditos"? Deveria distinguir status HTTP de falha de transporte?
2. **Dados sensíveis no log.** `errorMessageFrom(error)` pode carregar URL, corpo de resposta ou fragmento de token? O log vai para o arquivo de diagnóstico do Main/Renderer? Se sim, precisa de redaction antes de integrar.
3. **Interação com DP-4 (OIDC-OFF).** Com OIDC desabilitado, `isAuthenticated` deve permanecer `false` e `updateCredits` não deve disparar. A correção ainda é necessária no beta ou só serve para estabilizar a suíte de testes? Há risco de ela esconder uma chamada que deveria ter sido removida inteira?
4. **Interação com SEC-02.** O achado SEC-02 mostra refresh em voo repovoando tokens após logout. O `try/catch` em `updateCredits` interfere nesse caminho ou apenas cobre a chamada de créditos?
5. **Alternativa preferível.** Seria melhor (a) manter o `catch` local, (b) remover a chamada fire-and-forget do watcher e tratar no consumidor, (c) usar `void updateCredits().catch(...)` no chamador, ou (d) outra forma? Qual delas o responsável aceita?
6. **Critério de aceite.** O que precisa estar demonstrado para autorizar a integração (teste específico, ausência de log sensível, comportamento com 401, documentação da exceção)? Liste o mínimo.

## 5. Restrições que o parecer deve respeitar

- OIDC continua **sem aprovação** (DP-4): não é para corrigir SEC-01/SEC-02/SEC-03 nesta alteração.
- Nada de expor token ao Renderer ou a `localStorage`.
- Nada de silenciar erro de autenticação sem registro classificado.
- A correção precisa ser compatível com OIDC-OFF (nenhuma requisição de auth em uso normal).

## 6. Como responder

Parecer em documento próprio (`docs/reports/`) ou revisão na branch de origem. O arquivo só será integrado depois do parecer, e a integração será um commit isolado citando este documento.

**A integração parcial da Onda 1 não aprova os gates T-01, T-03 ou T-04.**
