import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import webpackPackage from 'next/dist/compiled/webpack/webpack.js'
const { webpack } = webpackPackage
const root = process.cwd(), dir = path.join(root, '.tmp/form-recovery-check')
fs.mkdirSync(dir,{recursive:true})
const sources = {
  intake: 'app/ops/intake/inline-job-intake.tsx',
  closeout: 'app/ops/leads/[id]/done-stamp.tsx',
  voice: 'app/ops/voice-capture-button.tsx',
}
const common = `import React, { useId, useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
const useRouter=()=>({refresh(){}});
const Link=({children,...props})=><a {...props}>{children}</a>;
import {VoiceCaptureButton} from './voice';
const LiveCallSketch=()=>null;
const CloseoutPhotoInput=()=>null;
const SafeSubmitButton=({children,pendingLabel,...props})=>{const {pending}=useFormStatus(); return <button {...props} type="submit" disabled={pending||props.disabled}>{pending?pendingLabel:children}</button>};
const SafeActionButton=({children,onAction,busyLabel,...props})=><button {...props} type="button" onClick={onAction}>{children}</button>;
const changeCallDraftDispositionAction=async()=>({status:'unchanged'});
const undoInlineJobAction=async()=>({status:'undone'});
const addLeadCompletionNote=async(data)=>{window.submissions.push(Object.fromEntries(data));await new Promise(r=>setTimeout(r,1000));if(window.actionMode==='failed')throw new Error('Synthetic addendum failure');};
const undoLeadComplete=async()=>{};
const saveInlineJobAction=async(_state,data)=>{window.submissions.push(Object.fromEntries(data)); await new Promise(r=>setTimeout(r,1000));return window.actionMode==='success'?{status:'saved',leadId:999,name:data.get('firstName'),phone:data.get('phone'),need:data.get('message'),source:'manual',intakeRef:data.get('intakeKey'),receiptKey:crypto.randomUUID()}:{status:'error',message:'Synthetic failure'};};
const markLeadCompleteState=async(_state,data)=>{window.submissions.push(Object.fromEntries(data));await new Promise(r=>setTimeout(r,1000)); return {status:'error',message:'Synthetic failure'};};
`
const hashes={}
for(const [name,file] of Object.entries(sources)) {
  const source=fs.readFileSync(path.join(root,file),'utf8')
  hashes[name]=crypto.createHash('sha256').update(source).digest('hex')
  const stripped=source.replace(/^import[^\n]*\n/gm,'')
  const domain=name==='closeout'?`import {deriveCloseoutDraft} from '../../lib/closeout-domain.ts'; import {swipeFinishDecision} from '../../lib/shop-brain-invariants.ts';\n`:''
  const prefix=name==='voice'?`import React, {useCallback,useEffect,useRef,useState} from 'react'; import {offlineRecordingScope,readCurrentVoiceScope,scopedVoiceStorageKey,voiceIntentMatchesScope} from '../../app/ops/voice-outbox-client.ts';\n`:common+domain
  fs.writeFileSync(path.join(dir,name+'.tsx'),prefix+stripped)
}
fs.writeFileSync(path.join(dir,'entry.tsx'),`import React from 'react'; import {createRoot} from 'react-dom/client'; import {InlineJobIntake} from './intake'; import {DoneStamp} from './closeout'; window.submissions=[]; window.actionMode='failed'; const root=createRoot(document.getElementById('root')); window.mount=(kind)=>root.render(kind==='intake'?<InlineJobIntake intakeKey="internal-test-manual" owner voiceReady={Boolean(window.voiceEnabled)}/>:<DoneStamp leadId={999} completed={kind==='addendum'} undoUntil={null} voiceReady={Boolean(window.voiceEnabled)} reviewedCloseout closeoutKey="internal-test"/>); window.mount('intake');`)
fs.writeFileSync(path.join(dir,'loader.cjs'),`const ts=require('typescript');module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText}`)
fs.writeFileSync(path.join(dir,'source-hashes.json'),JSON.stringify(hashes,null,2))
webpack({mode:'development',devtool:false,entry:path.join(dir,'entry.tsx'),output:{path:dir,filename:'bundle.js'},resolve:{extensions:['.tsx','.ts','.js']},module:{rules:[{test:/\.tsx?$/,use:path.join(dir,'loader.cjs')}]}},(error,stats)=>{if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1}else console.log('Built exact-source local form adapters',hashes)})
