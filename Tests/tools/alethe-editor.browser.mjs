import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../lia/desktop/package.json', import.meta.url));
const { chromium } = require('playwright');
const root='.agents/skills/alethe/';
test('imported text stays inert in real Chromium; source links reject executable protocols', async () => {
 const browser=await chromium.launch({headless:true});
 try {
 const page=await browser.newPage(); let dialogs=0;page.on('dialog',async d=>{dialogs++;await d.dismiss()});
 const yaml=readFileSync(root+'playbooks.yaml','utf8').replaceAll('</script','<\\/script');
 await page.setContent(readFileSync(root+'assets/editor.html','utf8').replace('__PLAYBOOKS_YAML__',yaml));
 const result=await page.evaluate(async ()=>{
   window.__injected=0;const payloads=['<script>alert(1)</script>','<img src=x onerror="window.__injected++">',`'"<& broken <img onerror=alert(1)>`];
   const results=[];state.providers=[];
   for(const payload of payloads){
    const old=state.budget;state.budget='ok';
    const element=traceSection({sim:{reached:new Set(['qa']),bothLow:false},nodes:[{id:'qa',type:'role',title:payload,workers:1,resolved:{final:{provider:'codex',model:payload,effort:payload,via:payload},base:{provider:'codex'}}}]});
    document.body.append(element);await new Promise(r=>setTimeout(r,30));
    results.push({text:element.textContent,unsafe:element.querySelectorAll('script,img,[onerror]').length});if (results.length < payloads.length) element.remove();state.budget=old;
   }
   return {results,injected:window.__injected,urls:['javascript:alert(1)','data:text/html,<script>alert(1)</script>','https://example.com/docs'].map(v=>typeof safeSourceUrl === "function" ? safeSourceUrl(v) : v)};
 });
 const artifacts = resolve('Tests/artifacts');
 mkdirSync(artifacts, { recursive: true });
 const run = mkdtempSync(resolve(artifacts, 'alethe-editor-'));
 await page.screenshot({path:resolve(run, 'alethe-editor-inert.png'),fullPage:true});
 console.log('Evidencia do Chromium:', run);
 assert.equal(result.injected,0);assert.equal(dialogs,0);
 result.results.forEach((r,i)=>{assert.equal(r.unsafe,0);assert.ok(r.text.includes(['<script>alert(1)</script>','<img src=x onerror="window.__injected++">',`'"<& broken <img onerror=alert(1)>`][i]));});
 assert.deepEqual(result.urls,[null,null,'https://example.com/docs']);
 } finally {await browser.close();}
});
