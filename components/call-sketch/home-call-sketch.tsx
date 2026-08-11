import { ArrowUpRight, Check, Phone } from "lucide-react"
import { GateDrawing, type GateSpec } from "./call-sketch-prototype"

const showcaseSpec: GateSpec = {
  kind: "gate",
  width: 47.5,
  height: 42,
  stockSize: 2,
  railCount: 2,
  hingeSide: "left",
  latchSide: "right",
  swing: "Toward driveway",
  widthTruth: "confirmed",
  heightTruth: "confirmed",
  widthSource: 0,
  heightSource: 0,
}

export function HomeCallSketch({ phoneHref, phoneDisplay }: { phoneHref: string; phoneDisplay: string }) {
  return <section className="ms-call-sketch" id="call-sketch" aria-labelledby="home-call-sketch-title">
    <div className="ms-call-sketch-copy ms-reveal">
      <span className="ms-call-sketch-kicker">Call Sketch</span>
      <h2 className="ms-display" id="home-call-sketch-title">Say it. See it.</h2>
      <p>For a simple gate or frame, the useful dimensions can take shape while we talk—so you can pull the phone from your ear and see whether we heard the same thing.</p>
      <ol>
        <li><strong>Talk through the job.</strong><span>Finished size, stock, rails, hinges, latch, and swing.</span></li>
        <li><strong>Watch the rough sketch.</strong><span>Unclear facts stay marked until somebody answers them.</span></li>
        <li><strong>We confirm it.</strong><span>The owner checks every fact before a DXF can leave the call.</span></li>
      </ol>
      <p className="ms-call-sketch-note"><Check aria-hidden="true" />A call sketch is a planning aid—not an approved fabrication drawing.</p>
      <a className="ms-call-sketch-call" href={phoneHref}><Phone aria-hidden="true" /><span><small>Start with the shop</small><strong>{phoneDisplay}</strong></span><ArrowUpRight aria-hidden="true" /></a>
    </div>

    <figure className="ms-call-sketch-demo ms-reveal">
      <figcaption><span>Rough elevation · live call example</span><strong>Driveway gate</strong></figcaption>
      <div className="ms-call-sketch-canvas"><GateDrawing spec={showcaseSpec} compact /></div>
      <div className="ms-call-sketch-facts" aria-label="Confirmed example facts">
        <p><small>Finished gate</small><strong>47 1/2&quot; × 42&quot;</strong></p>
        <p><small>Frame stock</small><strong>2&quot; square tube</strong></p>
        <p><small>Hardware</small><strong>Hinge left · latch right</strong></p>
      </div>
    </figure>
  </section>
}
