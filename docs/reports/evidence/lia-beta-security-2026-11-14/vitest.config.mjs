import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
const stubs={
  '../../../tools': 'export const createSparkCommandTool=async()=>[];export const createWebSearchTools=async()=>[];export const debug=async()=>[];export const mcp=async()=>[]',
  '../../mods/api/channel-server':'export const useModsServerChannelStore=()=>({send(){}})',
  '../../modules/web-search':'export const useWebSearchStore=()=>({configured:false})',
  '@proj-airi/stage-shared':'export const isStageTamagotchi=()=>false',
  '@vueuse/core':'import { watch } from "vue"; export const whenever=(x,f)=>watch(x,v=>{if(v)f(v)}); export const useTimeoutFn=()=>({start(){},stop(){}})',
  '../composables/api':'export const client={api:{v1:{flux:{$get:async()=>({ok:false})}}}}',
  '../composables/use-breakpoints':'import {ref} from "vue";export const useBreakpoints=()=>({isMobile:ref(false)})',
  '../libs/auth':'export const triggerSignIn=async()=>{}',
  '../libs/auth-client':'export const authClient={listSessions:async()=>[]};export const requestAuthSession=async()=>null',
  '../libs/auth-oidc':'export const refreshAccessToken=async()=>({})',
  '../libs/server':'export const SERVER_URL="https://example.invalid"',
  '@moeru/std':'export const errorMessageFrom=e=>e?.message',
  '@proj-airi/core-agent': `export * from ${JSON.stringify(resolve('core/runtime/llm-service.ts'))}`,
  '@xsai/model':'export const listModels=async()=>({data:[]})',
  '@xsai/shared-chat':'export const stepCountAtLeast=()=>undefined',
  '@xsai/stream-text':'export const streamText=()=>({})',
}
export default defineConfig({plugins:[{name:'audit-fixture-stubs',enforce:'pre',resolveId(id){if(Object.hasOwn(stubs,id))return '\0audit:'+id},load(id){if(id.startsWith('\0audit:'))return stubs[id.slice(7)]}}],test:{environment:'node'}})
