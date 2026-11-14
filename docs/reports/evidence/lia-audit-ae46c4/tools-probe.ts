import assert from 'node:assert/strict'
import {createPinia,setActivePinia} from 'pinia'
import {useLlmToolsStore} from './airi/packages/stage-ui/src/stores/ai/chat-llm/tools.ts'
import {resolveLlmTools} from './airi/packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.ts'
import {executeToolCallRerun} from './airi/packages/stage-ui/src/stores/tool-call-rerun.ts'
setActivePinia(createPinia()); const store=useLlmToolsStore(); let calls=0;
const raw={id:'synthetic:tool', type:'function', function:{name:'synthetic_tool',parameters:{type:'object',properties:{}}},execute:()=>{calls++;return 'real-store-executor'}} as const;
store.addTools(raw as any); const captured=store.getToolsByNames('synthetic_tool')[0];
let release!:()=>void; const wait = new Promise<void>(r=>release=r);
const pending = resolveLlmTools({builtInTools:[],debugTools:[],sparkCommandTools:[],webSearchTools:[],customTools: async()=>{await wait;return []}});
await Promise.resolve(); store.setToolEnabled(raw.id,false); release();
const after=await pending; let rejected=false; try {await after[0]?.execute({},{} as any)} catch(e:any){rejected=e.name==='ToolDisabledError'}
let capturedRejected=false;try{await captured.execute({},{} as any)}catch(e:any){capturedRejected=e.name==='ToolDisabledError'}
let altCalls=0; const fallback={type:'function',function:{name:'synthetic_tool',parameters:{type:'object',properties:{}}},execute:()=>{altCalls++;return 'other-source'}} as any;
const collision=await resolveLlmTools({builtInTools:[fallback],debugTools:[],sparkCommandTools:[],webSearchTools:[],customTools:store.getToolsByNames('synthetic_tool')});
const messages=[{id:'a',role:'assistant',content:'',slices:[{type:'tool-call',toolCall:{toolCallId:'c',toolName:'synthetic_tool',args:'{}'}}],tool_results:[]}];
const rerun=await executeToolCallRerun({messages:messages as any,payload:{messageId:'a',toolCallId:'c',toolName:'synthetic_tool',args:'{}'},resolveTools:async()=>collision});
const observed = {disabled:!store.isToolEnabled(raw.id),byName:store.getToolsByNames('synthetic_tool').length,capturedRejected,raceSchema:after.map(x=>x.function.name),raceRejected:rejected,rawCalls:calls,collisionSchema:collision.map(x=>x.function.name),rerunResult:(rerun[0] as any).tool_results,altCalls};
console.log(JSON.stringify(observed));
assert.deepEqual(observed, {disabled:true,byName:0,capturedRejected:true,raceSchema:['synthetic_tool'],raceRejected:true,rawCalls:0,collisionSchema:['synthetic_tool'],rerunResult:[{id:'c',isError:undefined,result:'other-source'}],altCalls:1});
