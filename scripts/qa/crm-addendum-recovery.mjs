import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {webkit} from 'playwright'
const dir=path.resolve('.tmp/form-recovery-check'),tag=process.argv[2]||'before'
const browser=await webkit.launch({headless:true}),report={checks:[],errors:[]}
try{
const page=await browser.newPage()
page.on('pageerror',e=>report.errors.push(String(e)))
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div class="job-page"><a href="#done-photo">Photo</a><div id="root"></div></div>'}))
await page.goto('http://127.0.0.1:3047/__isolated-form-check')
await page.addScriptTag({content:fs.readFileSync(path.join(dir,'bundle.js'),'utf8')})
await page.evaluate(()=>window.mount('addendum'))
await page.getByRole('link',{name:'Photo',exact:true}).click()
await page.locator('[name=note]').fill('Additional hinge adjustment')
await page.locator('.ops-done-note').evaluate(form=>{const input=document.createElement('input');input.type='hidden';input.name='photoUploadId';input.defaultValue='';input.value='internal-test-upload-receipt';form.append(input)})
await page.getByRole('button',{name:'File closeout note',exact:true}).click()
await page.waitForFunction(()=>window.submissions.length===1)
report.checks.push({name:'addendum-pending-mounted',forms:await page.locator('.ops-done-note').count()})
await page.waitForTimeout(1300)
report.checks.push({name:'addendum-failure-preserves-draft',forms:await page.locator('.ops-done-note').count(),note:await page.locator('[name=note]').count()?await page.locator('[name=note]').inputValue():null})
if(tag!=='before'){
assert.equal(report.checks[0].forms,1)
assert.equal(report.checks[1].note,'Additional hinge adjustment')
assert.equal(await page.locator('[name=photoUploadId]').inputValue(),'internal-test-upload-receipt')
assert.equal(await page.getByRole('alert').innerText(),'Synthetic addendum failure')
await page.evaluate(()=>window.actionMode='success')
await page.getByRole('button',{name:'File closeout note',exact:true}).click()
await page.getByRole('button',{name:'Add closeout note or photo',exact:true}).waitFor()
await page.getByRole('link',{name:'Photo',exact:true}).click()
assert.equal(await page.locator('[name=note]').inputValue(),'')
assert.deepEqual(report.errors,[])
report.checks.push({name:'addendum-retry-success-clears-note',passed:true})
report.checks.push({name:'repeated-photo-same-hash-reopens-after-success',passed:true})
}
console.log(JSON.stringify(report,null,2))
}finally{await browser.close();fs.writeFileSync(path.join(dir,`addendum-${tag}.json`),JSON.stringify(report,null,2))}
