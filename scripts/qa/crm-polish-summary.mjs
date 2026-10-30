import fs from 'node:fs'
import path from 'node:path'
const folder=path.resolve('.tmp/round2-matrix')
const files=['final-normal.json','final-stress.json','final-states.json','final-breakpoints.json','final-short.json']
const phases=[]
for(const file of files){
  if(!fs.existsSync(path.join(folder,file)))continue
  const run=JSON.parse(fs.readFileSync(path.join(folder,file),'utf8'))
  const retests=[]
  const merged=new Map(run.results.map(row=>[row.key,row]))
  const replacements=fs.readdirSync(folder).filter(name=>name.startsWith(`final-${run.phase}-`)&&name.endsWith('.json')).map(name=>({name,retest:JSON.parse(fs.readFileSync(path.join(folder,name),'utf8'))})).sort((left,right)=>left.retest.updated.localeCompare(right.retest.updated))
  for(const {name,retest} of replacements) {
    for(const row of retest.results)merged.set(row.key,row)
    retests.push({file:name,updated:retest.updated,cases:retest.results.length})
  }
  run.results=[...merged.values()]
  const rows=run.results.map(result=>({
    key:result.key,surface:result.surface,role:result.role,state:result.state,width:result.width,height:result.height||900,textTokenScale:result.scale,httpStatus:result.httpStatus,renderReady:Boolean(result.renderReady),failure:result.failure,applicationErrors:result.errors,serverMode:result.serverMode||'local-development-fixture',
    documentHeight:result.layout?.documentHeight,bodyOverflow:result.layout?.bodyOverflow,
    fontFaces:{golosLoaded:result.layout?.fonts.some(font=>font.family.includes('Golos')&&!font.family.includes('Fallback')&&font.status==='loaded'),chivoLoaded:result.layout?.fonts.some(font=>font.family.includes('Chivo')&&!font.family.includes('Fallback')&&font.status==='loaded')},
    typeSamples:result.layout?.samples.filter(sample=>['h1','h2','button','input'].includes(sample.tag)).slice(0,6).map(({selector,fontSize,height})=>({selector,fontSize,height})),
    clippedControls:result.layout?.clippedControls.map(({selector,text,width,height})=>({selector,text,width,height})),
    textOverflowControls:result.layout?.textOverflowControls.map(({selector,text,width,height})=>({selector,text,width,height})),
    menuKeyboard:result.menuKeyboard,tableKeyboard:result.tableKeyboard,priceReachability:result.priceReachability,lastControlReachability:result.lastControlReachability,
    intentionalScrollContainers:result.layout?.scrollContainers.map(({selector,width})=>({selector,width})),
    touchUnder44:result.width<=414?result.layout?.touchUnder44.map(({selector,text,width,height})=>({selector,text,width,height})):undefined,
    axe:result.axe?{violations:result.axe.violations.map(({id,impact,nodes})=>({id,impact,nodes:nodes.map(({target,failureSummary})=>({target,failureSummary}))})),incomplete:result.axe.incomplete}:undefined,
    screenshot:result.viewportScreenshot||result.screenshot,
  }))
  phases.push({phase:run.phase,browser:run.browser,updated:[run.updated,...retests.map(item=>item.updated)].sort().at(-1),originalRunUpdated:run.updated,retests,cases:rows.length,rendered:rows.filter(row=>row.renderReady&&!row.failure).length,failures:rows.filter(row=>row.failure).length,applicationErrorCases:rows.filter(row=>row.applicationErrors?.length).length,bodyOverflowCases:rows.filter(row=>row.bodyOverflow).length,clippedControlCases:rows.filter(row=>row.clippedControls?.length).length,axeViolationCases:rows.filter(row=>row.axe?.violations.length).length,rows})
}
const summary={generated:new Date().toISOString(),method:'Credential-free local synthetic fixtures; actual reusable components plus documented representative server markup. Product-token 200% is distinct from separately verified browser zoom. Axe excludes only development overlays.',phases}
fs.writeFileSync(path.join(folder,'final-compact.json'),JSON.stringify(summary,null,2))
console.log(JSON.stringify(phases.map(phase=>Object.fromEntries(Object.entries(phase).filter(([key])=>key!=='rows'))),null,2))
