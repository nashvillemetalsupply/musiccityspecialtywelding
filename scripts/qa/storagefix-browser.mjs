// Local-only synthetic pixels. No provider, credential, customer data or deletion.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { chromium } from '@playwright/test'
const root = fileURLToPath(new URL('../../', import.meta.url))
const modules = ['photo-outbox-client', 'photo-media-client'].map(name => {
  const source = readFileSync(path.join(root, `app/ops/${name}.ts`), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  return `;(()=>{const exports={};${code};Object.assign(window.storagefix,exports)})();`
}).join('\n')
const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Synthetic storage recovery test</title>') })
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${server.address().port}`
let browser
try {
  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage()
  await page.goto(origin)
  const install = () => page.evaluate(code => { window.storagefix = {}; (0,eval)(code) }, modules)
  await install()
  const first = await page.evaluate(async () => {
    const api = window.storagefix
    const canvas = document.createElement('canvas'); canvas.width=3200; canvas.height=2400
    const ctx = canvas.getContext('2d'); const pixels = ctx.createImageData(canvas.width, canvas.height)
    let seed=19
    for(let i=0;i<pixels.data.length;i+=4){ seed=(seed*1664525+1013904223)>>>0; pixels.data[i]=seed&255; pixels.data[i+1]=(seed>>>8)&255; pixels.data[i+2]=(seed>>>16)&255; pixels.data[i+3]=255 }
    ctx.putImageData(pixels,0,0)
    const original = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg',.96))
    const file = new File([original], 'synthetic.jpg', { type:'image/jpeg' })
    const [one,two] = await Promise.all([api.queuePhotoCapture(file,'operator:2:owner',7,'completion'),api.queuePhotoCapture(file,'operator:2:owner',7,'completion')])
    const prepared = await api.prepareCloseoutImage(one.original,one.originalName)
    const bitmap=await createImageBitmap(prepared.file); const dimensions={width:bitmap.width,height:bitmap.height}; bitmap.close()
    const owner=await api.readPhotoIntents('operator:2:owner',7,'completion')
    const crew=await api.readPhotoIntents('operator:3:crew',7,'completion')
    const otherJob=await api.readPhotoIntents('operator:2:owner',8,'completion')
    await api.savePhotoIntent({...one,...prepared,prepared:true,state:'archived'})
    return {id:one.id,sameId:one.id===two.id,originalBytes:one.original.size,compressedBytes:prepared.file.size,dimensions,pending:owner.length,crew:crew.length,otherJob:otherJob.length}
  })
  assert.equal(first.sameId,true); assert.equal(first.pending,1); assert.equal(first.crew,0); assert.equal(first.otherJob,0)
  assert.ok(first.compressedBytes<first.originalBytes); assert.ok(Math.max(first.dimensions.width,first.dimensions.height)<=1600)
  await page.reload(); await install()
  const second=await page.evaluate(async () => {
    const active=await window.storagefix.readPhotoIntents('operator:2:owner',7,'completion')
    const archive=await window.storagefix.readPhotoIntents('operator:2:owner',7,'completion',true)
    const row=archive[0]; const digest=await crypto.subtle.digest('SHA-256',await row.original.arrayBuffer())
    const hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
    return {pending:active.length,archived:archive.length,bytes:row.original.size,preparedBytes:row.file.size,state:row.state,hashMatches:hash===row.contentHash}
  })
  assert.equal(second.pending,0); assert.equal(second.archived,1); assert.equal(second.state,'archived'); assert.equal(second.hashMatches,true)
  assert.equal(second.bytes,first.originalBytes); assert.equal(second.preparedBytes,first.compressedBytes)
  const result={browser:'Chromium',syntheticOnly:true,externalRequestsAllowed:false,checks:9,compression:{originalBytes:first.originalBytes,preparedBytes:first.compressedBytes,...first.dimensions},reloadArchivePreserved:true,concurrentDedupe:true,identityAndJobIsolation:true}
  mkdirSync(path.join(root, '.tmp'), { recursive: true })
  writeFileSync(path.join(root, '.tmp/storagefix-browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
} finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)) }
