import fs from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'
import sharp from 'sharp'
const output=path.resolve('.tmp/round2-matrix')
const profile=path.resolve(`.tmp/round2-zoom-profile-${Date.now()}`)
fs.mkdirSync(output,{recursive:true})
const report={method:'Page zoom 200% selected through chrome://settings/appearance in isolated Playwright Chromium profile',profile,started:new Date().toISOString(),results:[]}
const context=await chromium.launchPersistentContext(profile,{headless:false,viewport:null,args:['--window-size=1280,1000'],serviceWorkers:'block'})
try {
  await context.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url())
    if(['http:','https:'].includes(url.protocol)&&(url.origin!=='http://127.0.0.1:3047'||!['GET','HEAD'].includes(request.method())))return route.abort('blockedbyclient')
    return route.continue()
  })
  const page=context.pages()[0]||await context.newPage()
  const measure=()=>page.evaluate(()=>({innerWidth,innerHeight,outerWidth,outerHeight,dpr:devicePixelRatio,visualViewportScale:visualViewport?.scale,rootFontSize:getComputedStyle(document.documentElement).fontSize,documentScrollWidth:document.documentElement.scrollWidth,bodyScrollWidth:document.body.scrollWidth}))
  await page.goto('http://127.0.0.1:3047/board/qa-polish',{waitUntil:'domcontentloaded',timeout:60000})
  await page.locator('[data-qa-boundary-hydrated="true"]').waitFor({state:'attached',timeout:30000})
  await page.locator('main').first().waitFor({state:'visible',timeout:30000})
  report.before=await measure()
  await page.goto('chrome://settings/appearance',{waitUntil:'domcontentloaded',timeout:30000})
  await page.waitForTimeout(500)
  const selects=page.locator('select')
  const matching=[]
  for(let index=0;index<await selects.count();index++){
    const detail=await selects.nth(index).evaluate(element=>({id:element.id,ariaLabel:element.getAttribute('aria-label'),value:element.value,options:[...element.options].map(option=>({label:option.label,value:option.value}))}))
    if(detail.options.filter(option=>option.label.trim()==='200%').length===1)matching.push({index,detail})
  }
  if(matching.length!==1)throw new Error(`Expected exactly one discovered 200% zoom select; found ${matching.length}`)
  report.zoomSelect={id:matching[0].detail.id,ariaLabel:matching[0].detail.ariaLabel,initialValue:matching[0].detail.value}
  await selects.nth(matching[0].index).selectOption({label:'200%'})
  report.selected=await selects.nth(matching[0].index).evaluate(element=>({value:element.value,label:element.selectedOptions[0]?.label}))
  for(const surface of ['board','job','forms','customers']){
    await page.goto(`http://127.0.0.1:3047/board/qa-polish?surface=${surface}`,{waitUntil:'domcontentloaded',timeout:60000})
    await page.locator('[data-qa-boundary-hydrated="true"]').waitFor({state:'attached',timeout:30000})
    await page.locator('main').first().waitFor({state:'visible',timeout:30000})
    if(surface==='forms')await page.waitForFunction(()=>!document.body.innerText.includes('Preparing isolated intake')&&!document.body.innerText.includes('Loading call sketch')&&!document.body.innerText.includes('Preparing drawing surface'),null,{timeout:30000})
    await page.evaluate(async()=>{
      const style=getComputedStyle(document.querySelector('main')||document.body)
      for(const key of ['--font-golos','--font-chivo'])if(style.getPropertyValue(key).trim())await document.fonts.load(`16px ${style.getPropertyValue(key).trim()}`)
      await document.fonts.ready
    })
    await page.waitForFunction(()=>['Golos','Chivo'].every(name=>[...document.fonts].some(font=>font.family.includes(name)&&!font.family.includes('Fallback')&&font.status==='loaded')),null,{timeout:30000})
    const geometry=await measure()
    const ratio=geometry.dpr/report.before.dpr
    const widthRatio=geometry.innerWidth/report.before.innerWidth
    const verified=Math.abs(ratio-2)<0.06&&Math.abs(widthRatio-.5)<0.06&&geometry.outerWidth===report.before.outerWidth
    const entry={surface,geometry,ratio,widthRatio,verified,screenshot:`zoom200-${surface}-viewport.jpg`,bodyOverflow:geometry.documentScrollWidth>geometry.innerWidth+1}
    report.results.push(entry)
    entry.samples=await page.locator('h1,.business-switcher a,.job-action-spine a,.job-action-spine button').evaluateAll(elements=>elements.slice(0,12).map(element=>{const css=getComputedStyle(element),rect=element.getBoundingClientRect();return{text:element.textContent.trim(),fontSize:css.fontSize,fontFamily:css.fontFamily,rect:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}}}))
    const cdp=await context.newCDPSession(page)
    const metrics=await cdp.send('Page.getLayoutMetrics')
    entry.layoutMetrics={cssLayoutViewport:metrics.cssLayoutViewport,layoutViewport:metrics.layoutViewport,cssVisualViewport:metrics.cssVisualViewport}
    await page.addStyleTag({content:'nextjs-portal{visibility:hidden!important}'})
    const captured=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:85,fromSurface:false,captureBeyondViewport:false})
    const buffer=Buffer.from(captured.data,'base64')
    fs.writeFileSync(path.join(output,entry.screenshot),buffer)
    const image=await sharp(buffer).metadata()
    entry.image={width:image.width,height:image.height,method:'CDP viewport capture without CSS clip'}
    if(surface==='board'){
      await page.locator('main button').first().scrollIntoViewIfNeeded()
      const actions=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:85,fromSurface:false,captureBeyondViewport:false})
      entry.actionsScreenshot='zoom200-board-actions.jpg'
      fs.writeFileSync(path.join(output,entry.actionsScreenshot),Buffer.from(actions.data,'base64'))
    }
    await cdp.detach()
    console.log(JSON.stringify(entry))
  }
} catch(error){report.failure=String(error);console.error(report.failure);process.exitCode=1}
finally{fs.writeFileSync(path.join(output,'browser-zoom.json'),JSON.stringify(report,null,2));await context.close()}
