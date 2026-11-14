import assert from 'node:assert/strict'
import {createPinia,setActivePinia} from 'pinia'
import {useAuthStore} from './airi/packages/stage-ui/src/stores/auth.ts'
const values=new Map<string,string>(); (globalThis as any).localStorage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v),removeItem:(k:string)=>values.delete(k)};
(globalThis as any).fetch=async()=>{throw new Error('synthetic offline logout')};
let release!:(x:any)=>void; (globalThis as any).refreshMock=()=>new Promise(r=>release=r);
setActivePinia(createPinia()); const s=useAuthStore();
await s.completeSignIn({accessToken:'SYNTH_OLD',refreshToken:'SYNTH_REFRESH',idToken:'SYNTH_ID',clientId:'client',expiresIn:3600});
const refreshing=s.refreshTokenNow(); await s.signOut(); const cleared=values.size===0;
release({access_token:'SYNTH_NEW',refresh_token:'SYNTH_NEW_REFRESH',expires_in:3600}); await refreshing;
const observed = {clearedAfterLogout:cleared,restoredToken:values.has('auth/v1/token'),restoredRefresh:values.has('auth/v1/refresh-token'),clientIdAfterLogout:values.has('auth/v1/oidc-client-id'),authenticated:s.isAuthenticated};
console.log(JSON.stringify(observed));
assert.deepEqual(observed, {clearedAfterLogout:true,restoredToken:true,restoredRefresh:true,clientIdAfterLogout:false,authenticated:true});
