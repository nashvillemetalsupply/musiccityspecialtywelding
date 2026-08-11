import assert from "node:assert/strict"
import test from "node:test"
import { createGateDxf, formatShopInches } from "../lib/call-sketch-dxf.mjs"

test("shop inch labels preserve familiar fractions", () => {
  assert.equal(formatShopInches(47.5), '47 1/2"')
  assert.equal(formatShopInches(42), '42"')
  assert.equal(formatShopInches(2.0625), '2 1/16"')
})

test("confirmed gate geometry exports as a conservative R12 DXF", () => {
  const dxf = createGateDxf({
    width: 47.5,
    height: 42,
    stockSize: 2,
    railCount: 2,
    hingeSide: "left",
    latchSide: "right",
    title: "Mike Henderson gate",
  })

  assert.match(dxf, /\$ACADVER\r\n1\r\nAC1009/)
  assert.match(dxf, /CONCEPT SKETCH - VERIFY BEFORE FABRICATION/)
  assert.match(dxf, /47 1\/2"/)
  assert.match(dxf, /42"/)
  assert.match(dxf, /MIKE HENDERSON GATE/)
  assert.match(dxf, /HINGES LEFT \/ LATCH RIGHT/)
  assert.ok((dxf.match(/\r\nLINE\r\n/g) ?? []).length >= 20)
  assert.ok(dxf.endsWith("0\r\nEOF\r\n"))
})

test("DXF export rejects incomplete or implausible geometry", () => {
  assert.throws(() => createGateDxf({ width: 0, height: 42, stockSize: 2, railCount: 2 }), /width/)
  assert.throws(() => createGateDxf({ width: 4, height: 42, stockSize: 2, railCount: 2 }), /stockSize/)
  assert.throws(() => createGateDxf({ width: 48, height: 42, stockSize: 2, railCount: 2.5 }), /railCount/)
})

test("rectangular frame exports never invent gate hardware", () => {
  const dxf = createGateDxf({ kind: "frame", width: 36, height: 24, stockSize: 1.5, railCount: 0 })
  assert.match(dxf, /RECTANGULAR FRAME \/ NO GATE HARDWARE/)
  assert.doesNotMatch(dxf, /HINGES (?:LEFT|RIGHT) \/ LATCH/)
  assert.doesNotMatch(dxf, /\r\n8\r\nHARDWARE\r\n/)
})
