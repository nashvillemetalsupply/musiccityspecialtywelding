import fs from 'node:fs'
import {webkit} from 'playwright'
const browser=await webkit.launch({headless:true})
try{
const page=await browser.newPage()
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local IDB probe</title>'}))
await page.goto('http://127.0.0.1:3047/__isolated-idb-probe')
const result=await page.evaluate(async()=>{
 const open=indexedDB.open('isolated-blob-probe',1)
 open.onupgradeneeded=()=>open.result.createObjectStore('notes',{keyPath:'id'})
 const db=await new Promise((resolve,reject)=>{open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error)})
 const writes=[]
 for(const [id,value] of [['text','synthetic'],['blob',new Blob(['synthetic'],{type:'audio/webm'})]]){
  writes.push(await new Promise(resolve=>{
   const tx=db.transaction('notes','readwrite'),request=tx.objectStore('notes').put({id,value})
   request.onerror=()=>resolve({id,error:request.error?.name,message:request.error?.message})
   tx.oncomplete=()=>resolve({id,stored:true})
   tx.onabort=()=>resolve({id,error:tx.error?.name,message:tx.error?.message})
  }))
 }
 db.close();return{origin:location.origin,userAgent:navigator.userAgent,secure:isSecureContext,writes}
})
fs.writeFileSync('.tmp/form-recovery-check/webkit-idb-probe.json',JSON.stringify(result,null,2));console.log(result)
}finally{await browser.close()}
