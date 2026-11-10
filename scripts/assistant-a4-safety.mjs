import { AsyncLocalStorage } from "node:async_hooks"
import http from "node:http"
import https from "node:https"
import http2 from "node:http2"
import net from "node:net"
import tls from "node:tls"
import dgram from "node:dgram"
import { syncBuiltinESMExports } from "node:module"

// A4 alone owns these guards. No application module or production environment
// reads them. Only the runner's allowlisted DB/model fetch can open a socket.
export function createA4Safety({ block, fetch: originalFetch, allowFetch }) {
  const allowedTransport = new AsyncLocalStorage()
  const senders = new WeakMap(), guards = [], intercepted = new Set()
  const probeError = new Error("A4 expected safety probe")
  let probing = false, installed = false, passed = false
  const unsafe = () => { passed = false; throw Object.assign(new Error("A4 outbound interception is incomplete; refusing to run"), { code: "A4_OUTBOUND_UNSAFE" }) }
  const reject = (label) => { if (probing) throw probeError; return block(label) }
  const sender = (label) => {
    const fn = () => reject(label)
    senders.set(fn, label)
    return fn
  }
  const protect = (object, key, label) => {
    const original = object[key]
    const guarded = function (...args) {
      if (allowedTransport.getStore()) return Reflect.apply(original, this, args)
      return reject(label)
    }
    senders.set(guarded, label)
    guards.push({ object, key, original, guarded, label })
    object[key] = guarded
  }
  const install = () => {
    if (installed) unsafe()
    installed = true
    for (const [object, keys, prefix] of [
      [http, ["request", "get"], "http"], [https, ["request", "get"], "https"],
      [http2, ["connect"], "http2"], [net, ["connect", "createConnection"], "net"],
      [net.Socket.prototype, ["connect"], "net.Socket"], [tls, ["connect"], "tls"],
      [dgram, ["createSocket"], "dgram"],
    ]) for (const key of keys) protect(object, key, `node:${prefix}.${key}`)
    const guarded = async (input, init) => {
      if (probing) return reject("fetch")
      const allowed = allowFetch(input)
      if (!allowed) return reject("unexpected-network")
      return allowedTransport.run(true, () => originalFetch(input, { ...init, redirect: "error" }))
    }
    senders.set(guarded, "fetch")
    guards.push({ object: globalThis, key: "fetch", original: globalThis.fetch, guarded, label: "fetch" })
    globalThis.fetch = guarded
    syncBuiltinESMExports()
  }
  const verify = () => {
    if (!installed || guards.some(({ object, key, guarded }) => object[key] !== guarded)) unsafe()
  }
  const checkSenders = async (entries) => {
    verify()
    // Check identities BEFORE invoking anything: an unguarded sender must never
    // be called even as a probe. Expected probe blocks never enter block().
    const probes = [...entries, ...guards.map(({ guarded, label }) => [label, guarded])]
    if (probes.some(([label, fn]) => senders.get(fn) !== label)) unsafe()
    for (const [label, fn] of probes) {
      probing = true
      try {
        let caught
        try { await fn() } catch (error) { caught = error }
        if (caught !== probeError) unsafe()
        intercepted.add(label)
      } finally { probing = false }
    }
    verify()
    passed = true
  }
  const restore = () => {
    for (const { object, key, original } of guards.toReversed()) object[key] = original
    syncBuiltinESMExports()
  }
  return { sender, install, verify, checkSenders, restore, summary: () => ({ pass: passed, intercepted: [...intercepted] }) }
}
