import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'
import sharp from 'sharp'
const require = createRequire(import.meta.url)
const output = path.resolve('.tmp/round2-matrix')
fs.mkdirSync(output, { recursive: true })
const phase = process.argv.find(arg => arg.startsWith('--phase='))?.split('=')[1] || 'normal'
const only = process.argv.find(arg => arg.startsWith('--surface='))?.split('=')[1]
const tag = process.argv.find(arg => arg.startsWith('--tag='))?.split('=')[1]
const onlyState = process.argv.find(arg => arg.startsWith('--state='))?.split('=')[1]
const base = process.env.QA_BASE_URL || 'http://127.0.0.1:3047'
if(!['http://127.0.0.1:3047','http://127.0.0.1:3048'].includes(base))throw new Error('Use only the isolated localhost fixture server.')
const surfaces = ['board','calls','updates','customers','job','account','forms','shop','analytics','install','builds','sketch','login','customer'].filter(surface => !only || surface === only)
const variants = [
  ['board','crew',''],['board','owner','empty'],['board','owner','large'],['calls','crew','empty'],['updates','owner','history'],['updates','crew','empty'],['customers','owner','empty'],
  ['job','crew',''],['job','owner','pending'],['job','owner','failed'],['job','owner','completed'],['forms','crew','empty'],['shop','crew',''],['analytics','owner','empty'],['install','owner','pending'],['install','owner','failed'],['builds','owner','empty'],['builds','owner','failed'],['sketch','crew',''],['login','owner','failed'],['login','owner','pending'],['customer','owner','empty'],
].filter(([surface,,state]) => (!only || surface === only)&&(!onlyState||state===onlyState))
const cases = phase === 'breakpoints' ? ['board','menu','updates'].filter(surface=>!only||surface===only).flatMap(surface=>[375,414,420,421,479,480,481,767,768,769,899,900,901].map(width=>({surface,role:'owner',state:'',width,scale:1}))) : phase === 'states' ? variants.flatMap(([surface,role,state]) => [320,768].map(width => ({surface,role,state,width,scale:1}))) : surfaces.flatMap(surface => (phase === 'stress' ? [390,768] : [320,390,768,1440,1920]).map(width => ({surface,role:'owner',state:'',width,scale:phase === 'stress' ? 2 : 1})))
if(phase==='stress')for(const [surface,role,state] of [['board','owner','large'],['job','owner','failed'],['updates','owner','history'],['forms','crew','empty']])if(!only||only===surface)for(const width of [390,768])cases.push({surface,role,state,width,scale:2})
if(phase==='stress'&&(!only||only==='menu'))for(const width of [390,768])cases.push({surface:'menu',role:'owner',state:'',width,scale:2})
if(phase==='normal'&&only==='menu')for(const width of [320,390,768,1440,1920])cases.push({surface:'menu',role:'owner',state:'',width,scale:1})
if(phase==='short')cases.splice(0,cases.length,...['menu','job','forms'].flatMap(surface=>[{width:320,height:568},{width:844,height:390}].map(viewport=>({surface,role:'owner',state:'',scale:1,...viewport}))))
const browser = await chromium.launch({headless:true})
const results = []
const outputName = `${tag ? `${tag}-` : ''}${phase}${only ? `-${only}` : ''}${onlyState?`-${onlyState}`:''}`
const started = new Date().toISOString()
let context, page, previousGroup = '', errors=[]
try {
  for (const item of cases) {
    const key = `${item.surface}-${item.role}-${item.state || 'populated'}-${item.width}${item.height?`h${item.height}`:''}-${item.scale}x`
    const group=[item.surface,item.role,item.state].join(':')
    const navigate=group!==previousGroup
    errors=[]
    if(navigate) {
      await context?.close()
      context = await browser.newContext({viewport:{width:item.width,height:item.height||900},deviceScaleFactor:1,reducedMotion:'reduce',serviceWorkers:'block'})
      page = await context.newPage()
      page.on('pageerror', error => errors.push({message:error.message,stack:error.stack}))
      await context.route('**/*', route => {
      const request=route.request(), url=new URL(request.url())
      if (url.origin !== base || !['GET','HEAD'].includes(request.method())) return route.abort('blockedbyclient')
      return route.continue()
      })
      previousGroup=group
    } else await page.setViewportSize({width:item.width,height:item.height||900})
    const query = new URLSearchParams({surface:item.surface,role:item.role,state:item.state})
    const result={...item,key,url:`${base}/board/qa-polish?${query}`,serverMode:base.endsWith(':3048')?'local-production-fixture':'local-development-fixture',errors}
    try {
      if(navigate) {
        const response=await page.goto(result.url,{waitUntil:'domcontentloaded',timeout:60000})
        result.httpStatus=response?.status()
      } else result.httpStatus=results.at(-1)?.httpStatus
      await page.locator('[data-qa-boundary-hydrated="true"]').waitFor({state:'attached',timeout:30000})
      await page.locator('main').first().waitFor({state:'visible',timeout:30000})
      if(item.surface==='login') await page.locator('button[aria-label^="Sign in as"]').first().waitFor({state:'visible',timeout:30000})
      if(['forms','sketch'].includes(item.surface)) await page.waitForFunction(()=>!document.body.innerText.includes('Loading call sketch')&&!document.body.innerText.includes('Preparing drawing surface')&&!document.body.innerText.includes('Preparing isolated intake'),null,{timeout:30000})
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('main')||document.body).getPropertyValue('--font-golos').includes('Golos'),null,{timeout:30000})
      await page.evaluate(async()=>{
        const css=getComputedStyle(document.querySelector('main')||document.body)
        for(const name of ['--font-golos','--font-chivo']) {
          const family=css.getPropertyValue(name).trim()
          if(family)await document.fonts.load(`16px ${family}`)
        }
        await document.fonts.ready
      })
      await page.waitForFunction(()=>['Golos','Chivo'].every(name=>[...document.fonts].some(font=>font.family.includes(name)&&!font.family.includes('Fallback')&&font.status==='loaded')),null,{timeout:30000})
      result.renderReady=true
      await page.waitForTimeout(navigate ? 650 : 150)
      if(navigate&&item.surface==='menu') {
        await page.getByRole('button',{name:'Open menu',exact:true}).click()
        await page.getByRole('dialog',{name:'Menu',exact:true}).waitFor({state:'visible'})
      }
      if(navigate && item.surface==='login' && ['pending','failed'].includes(item.state)) {
        await page.locator('button[aria-label^="Sign in as"]').first().click({timeout:10000})
        await page.getByRole('button',{name:'Text my code',exact:true}).click({timeout:10000})
        await page.waitForTimeout(250)
      }
      if(navigate && item.surface==='sketch' && item.role==='owner') {
        const freeze=page.getByRole('button',{name:'Freeze',exact:true})
        if(await freeze.count()) {
          await freeze.click({timeout:5000})
          await page.getByRole('button',{name:'Resume',exact:true}).waitFor({state:'visible',timeout:10000})
          for(let index=0;index<2;index++) await page.getByRole('button',{name:'Advance demo',exact:true}).click()
          result.sketchState='Frozen after two local demo advances; populated width/height/stock/rails'
        }
      }
      if(item.scale===2) await page.evaluate(()=>{
        const root=document.documentElement
        for(const name of ['display','lede','title','name','sub','body','data','label','caption'])root.style.removeProperty(`--t-${name}`)
        const baseline=['display','lede','title','name','sub','body','data','label','caption'].map(name=>[`--t-${name}`,getComputedStyle(root).getPropertyValue(`--t-${name}`).trim()])
        for(const [key,value] of baseline)root.style.setProperty(key,`calc(${value} * 2)`,'important')
      })
      await page.waitForTimeout(100)
      if(item.surface==='menu') {
        result.menuKeyboard=await page.evaluate(()=>{
          const panel=document.querySelector('[role=dialog][aria-modal=true]')
          const elements=[...panel.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]')].filter(el=>!el.disabled&&el.tabIndex>=0&&el.getClientRects().length&&el.checkVisibility({checkVisibilityCSS:true}))
          return {count:elements.length,controls:elements.map(el=>({text:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,80),tag:el.tagName})),panelHeight:panel.clientHeight,scrollHeight:panel.scrollHeight}
        })
        const visited=[]
        await page.getByRole('button',{name:'Close menu',exact:true}).focus()
        for(let index=0;index<result.menuKeyboard.count+1;index++) {
          visited.push(await page.evaluate(()=>{const el=document.activeElement,rect=el.getBoundingClientRect();return {text:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,80),inside:Boolean(el.closest('[role=dialog]')),visibleVertically:rect.top>=-1&&rect.bottom<=innerHeight+1}}))
          await page.keyboard.press('Tab')
        }
        result.menuKeyboard.visited=visited
        await page.getByRole('button',{name:'Close menu',exact:true}).focus()
        await page.locator('[role=dialog][aria-modal=true]').evaluate(el=>el.scrollTop=0)
      }
      if(item.surface==='analytics'&&item.scale===2&&item.width===768) {
        const region=page.getByRole('region',{name:'Lead sources table',exact:true})
        await region.focus()
        const before=await region.evaluate(el=>({left:el.scrollLeft,width:el.clientWidth,scrollWidth:el.scrollWidth,outline:getComputedStyle(el).outlineStyle}))
        await page.keyboard.press('ArrowRight')
        await page.waitForTimeout(300)
        const after=await region.evaluate(el=>({left:el.scrollLeft,focused:el===document.activeElement}))
        result.tableKeyboard={before,after,passed:before.scrollWidth>before.width&&after.left>before.left&&after.focused&&before.outline!=='none'}
        await region.evaluate(el=>el.scrollLeft=0)
        await page.evaluate(()=>window.scrollTo(0,0))
      }
      if(phase==='short'&&item.surface==='job') {
        await page.locator('.job-action-price').click()
        await page.waitForTimeout(300)
        result.priceReachability=await page.evaluate(()=>{
          const active=document.activeElement,rect=active.getBoundingClientRect(),dock=document.querySelector('.job-action-spine')?.getBoundingClientRect()
          return {tag:active.tagName,name:active.getAttribute('name'),top:rect.top,bottom:rect.bottom,dockTop:dock?.top,visible:rect.top>=0&&rect.bottom<=(dock?.top||innerHeight)}
        })
      }
      if(phase==='short'&&item.surface==='forms') {
        const last=page.locator('main button,main input,main select,main textarea').filter({visible:true}).last()
        await last.focus()
        result.lastControlReachability=await last.evaluate(el=>{const r=el.getBoundingClientRect();return{text:el.textContent,top:r.top,bottom:r.bottom,visible:r.top>=0&&r.bottom<=innerHeight}})
      }
      result.layout=await page.evaluate(()=>{
        const ignored=el=>el.closest('[data-qa-tools],nextjs-portal,[data-nextjs-dialog]')
        const visible=el=>!ignored(el)&&el.getClientRects().length>0&&el.checkVisibility({checkVisibilityCSS:true})
        const selector=el=>{
          if(el.id)return `#${CSS.escape(el.id)}`
          const bits=[]
          for(let node=el;node&&node!==document.body&&bits.length<5;node=node.parentElement){
            let bit=node.localName
            if(node.classList.length)bit+='.'+[...node.classList].slice(0,3).map(value=>CSS.escape(value)).join('.')
            const siblings=node.parentElement?[...node.parentElement.children].filter(item=>item.localName===node.localName):[]
            if(siblings.length>1)bit+=`:nth-of-type(${siblings.indexOf(node)+1})`
            bits.unshift(bit)
          }
          return bits.join(' > ')
        }
        const all=[...document.body.querySelectorAll('*')].filter(el=>el instanceof HTMLElement&&visible(el))
        const scroller=el=>{
          for(let parent=el.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
            const css=getComputedStyle(parent)
            if(['auto','scroll'].includes(css.overflowX)&&parent.scrollWidth>parent.clientWidth+2)return selector(parent)
          }
          return null
        }
        const describe=el=>{const rect=el.getBoundingClientRect(),css=getComputedStyle(el);return{selector:selector(el),tag:el.localName,text:el.textContent?.trim().slice(0,100),left:+rect.left.toFixed(1),right:+rect.right.toFixed(1),width:+rect.width.toFixed(1),height:+rect.height.toFixed(1),fontSize:css.fontSize,lineHeight:css.lineHeight,fontFamily:css.fontFamily,overflowX:css.overflowX,overflowY:css.overflowY,scrollContainer:scroller(el)}}
        const outOfViewport=all.filter(el=>{const rect=el.getBoundingClientRect();return rect.width>0&&(rect.left < -1||rect.right>innerWidth+1)}).map(describe)
        const clippedControls=all.filter(el=>{
          if(!el.matches('button,a,input,select,textarea'))return false
          const css=getComputedStyle(el),rect=el.getBoundingClientRect()
          // A bounded single-line input intentionally scrolls a long value.
          const nativeInput=el.matches('input:not([type=checkbox]):not([type=radio])')&&rect.left>=-1&&rect.right<=innerWidth+1&&el.clientHeight>=parseFloat(css.lineHeight)+parseFloat(css.paddingTop)+parseFloat(css.paddingBottom)-1
          return (el.scrollWidth>el.clientWidth+2&&['hidden','clip'].includes(css.overflowX)&&!nativeInput)||(el.scrollHeight>el.clientHeight+2&&['hidden','clip'].includes(css.overflowY))
        }).map(describe)
        const textOverflowControls=all.filter(el=>{
          if(!el.matches('button,summary,a')||!el.textContent?.trim()||el.closest('[inert]'))return false
          const box=el.getBoundingClientRect(),range=document.createRange()
          range.selectNodeContents(el)
          const text=range.getBoundingClientRect()
          return text.width>0&&(text.left<box.left-2||text.right>box.right+2||text.top<box.top-2||text.bottom>box.bottom+2)
        }).map(describe)
        const touchTargets=all.filter(el=>{
          if(el.closest('[inert]'))return false
          if(el.matches('button,summary'))return true
          if(!el.matches('a'))return false
          return !['inline','contents'].includes(getComputedStyle(el).display)||el.matches('.btn,.ops-update-open')||Boolean(el.closest('nav'))
        }).map(describe)
        return {width:innerWidth,height:innerHeight,bodyScrollWidth:document.body.scrollWidth,documentScrollWidth:document.documentElement.scrollWidth,bodyOverflow:document.documentElement.scrollWidth>innerWidth+1,documentHeight:document.documentElement.scrollHeight,rootFontSize:getComputedStyle(document.documentElement).fontSize,fonts:[...document.fonts].map(font=>({family:font.family,status:font.status})),samples:all.filter(el=>el.matches('h1,h2,button,input,select,textarea,.t-data,.t-name')).slice(0,32).map(describe),outOfViewport:outOfViewport.slice(0,35),clippedControls:clippedControls.slice(0,25),textOverflowControls:textOverflowControls.slice(0,25),touchUnder44:touchTargets.filter(item=>item.width<43.5||item.height<43.5).slice(0,45),scrollContainers:all.filter(el=>['auto','scroll'].includes(getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+2).map(describe)}
      })
      if(item.surface==='board'&&item.width>=1280&&result.layout.documentHeight>900) result.tailDiagnostic=await page.evaluate(()=>{
        const box=element=>{const rect=element.getBoundingClientRect(),css=getComputedStyle(element);return{tag:element.tagName,id:element.id,className:String(element.className),top:rect.top,bottom:rect.bottom,height:rect.height,scrollHeight:element.scrollHeight,display:css.display,position:css.position,margin:css.margin,padding:css.padding}}
        return {body:box(document.body),html:box(document.documentElement),bodyChildren:[...document.body.children].map(box),htmlChildren:[...document.documentElement.children].map(box)}
      })
      if(phase!=='breakpoints') {
        if(navigate) await page.addScriptTag({path:require.resolve('axe-core/axe.min.js')})
        result.axe=await page.evaluate(async()=>{
        const audit=await window.axe.run({exclude:[['[data-qa-tools]'],['nextjs-portal'],['[data-nextjs-dialog]']]})
        return {violations:audit.violations.map(({id,impact,help,nodes})=>({id,impact,help,nodes:nodes.map(({target,failureSummary,html})=>({target,failureSummary,html}))})),incomplete:audit.incomplete.map(({id,nodes})=>({id,targets:nodes.map(({target})=>target)})),passed:audit.passes.length}
        })
      }
      if (phase==='short' || (phase==='states'&&onlyState) || (phase==='normal'&&[320,1440].includes(item.width)) || (phase==='stress'&&item.width===390) || (phase==='breakpoints'&&[375,414].includes(item.width)) || result.layout.bodyOverflow || (result.axe?.violations.length||0)) {
        result.screenshot=`${key}.jpg`
        await page.screenshot({path:path.join(output,result.screenshot),type:'jpeg',quality:72,fullPage:true,animations:'disabled',style:'nextjs-portal{visibility:hidden!important}'})
        result.viewportScreenshot=`${key}-viewport.jpg`
        await page.screenshot({path:path.join(output,result.viewportScreenshot),type:'jpeg',quality:80,fullPage:false,animations:'disabled',style:'nextjs-portal{visibility:hidden!important}'})
        const fullImage=await sharp(path.join(output,result.screenshot)).metadata(),viewportImage=await sharp(path.join(output,result.viewportScreenshot)).metadata()
        result.imageDimensions={full:{width:fullImage.width,height:fullImage.height},viewport:{width:viewportImage.width,height:viewportImage.height}}
        if(item.surface==='board'&&((item.width===390&&item.scale===2)||(item.width===320&&item.scale===1))) {
          result.calendarScreenshot=`${key}-calendar.jpg`
          await page.locator('section[class*="job-calendar_calendar"]').screenshot({path:path.join(output,result.calendarScreenshot),type:'jpeg',quality:85,animations:'disabled'})
          await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('main')?.scrollTo(0,0)})
        }
      }
    } catch(error) { result.failure=String(error) }
    results.push(result)
    fs.writeFileSync(path.join(output,`${outputName}.json`),JSON.stringify({started,updated:new Date().toISOString(),browser:browser.version(),phase,results},null,2))
    console.log(JSON.stringify({key,status:result.httpStatus,overflow:result.layout?.bodyOverflow,clipped:result.layout?.clippedControls.length,axe:result.axe?.violations.map(item=>`${item.id}:${item.nodes.length}`),incomplete:result.axe?.incomplete.length,failure:result.failure}))
  }
} finally { await context?.close(); await browser.close() }
const failed=results.filter(result=>result.failure||result.errors?.length||result.layout?.bodyOverflow||result.layout?.clippedControls.length||result.layout?.textOverflowControls.length||result.menuKeyboard?.visited.some(item=>!item.inside||!item.visibleVertically)||result.tableKeyboard?.passed===false||result.priceReachability?.visible===false||result.lastControlReachability?.visible===false||result.axe?.violations.some(item=>!(item.id==='region'&&item.nodes.every(node=>node.target.length===1&&node.target[0]==='.skip'))))
console.log(JSON.stringify({phase,cases:results.length,failed:failed.map(result=>result.key),manualAxeException:'The first skip link intentionally precedes landmark content; raw region findings remain recorded.'}))
if(failed.length)process.exitCode=1
