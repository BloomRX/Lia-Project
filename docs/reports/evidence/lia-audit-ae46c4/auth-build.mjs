import { build } from 'esbuild';
await build({entryPoints:['./auth-probe.ts'],outfile:'./auth-bundle.mjs',bundle:true,platform:'node',format:'esm',packages:'external',plugins:[{name:'controlled-fixtures',setup(b){b.onResolve({filter:/^(@moeru\/std|@proj-airi\/stage-shared|@vueuse\/core|\.\.\/composables\/(api|use-breakpoints)|\.\.\/libs\/(auth|auth-client|auth-oidc|server))$/},args=>({path:args.path,namespace:'stub'}));b.onLoad({filter:/.*/,namespace:'stub'},args=>{const s={
'@moeru/std':'export const errorMessageFrom=e=>e?.message;',
'@proj-airi/stage-shared':'export const isStageTamagotchi=()=>true;',
'@vueuse/core':'export const whenever=()=>{}; export const useTimeoutFn=()=>({start(){},stop(){}});',
'../composables/api':'export const client={api:{v1:{flux:{$get:async()=>({ok:false})}}}};',
'../composables/use-breakpoints':'import {ref} from "vue"; export const useBreakpoints=()=>({isMobile:ref(false)});',
'../libs/auth':'export const triggerSignIn=async()=>{};',
'../libs/auth-client':'export const authClient={listSessions:async()=>[]}; export const requestAuthSession=async()=>({user:{id:"synthetic"},session:{id:"synthetic"}});',
'../libs/auth-oidc':'export const refreshAccessToken=(...a)=>globalThis.refreshMock(...a);',
'../libs/server':'export const SERVER_URL="https://example.invalid";'};return {contents:s[args.path],loader:'js',resolveDir:process.cwd()}})}}]});
