import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

const repo = path.join(import.meta.dirname, "..")

function parseYaml(source) {
  const lines = source.replaceAll("\r", "").split("\n").flatMap((raw, index) => {
    if (!raw.trim() || raw.trimStart().startsWith("#")) return []
    const indent = raw.length - raw.trimStart().length
    if (raw.slice(0, indent).includes("\t")) throw new Error(`Tabs are not valid indentation on line ${index + 1}`)
    return [{ indent, content: raw.slice(indent), raw }]
  })

  function scalar(value) {
    if (value.startsWith('"')) return JSON.parse(value)
    if (value === "true") return true
    if (value === "false") return false
    if (value === "null" || value === "~") return null
    return value
  }

  function pair(line) {
    const split = line.indexOf(":")
    if (split < 1) throw new Error(`Expected a YAML mapping entry: ${line}`)
    return [line.slice(0, split), line.slice(split + 1).trimStart()]
  }

  function parseBlockScalar(index, parentIndent, style) {
    const first = lines[index]
    if (!lines[index + 1] || lines[index + 1].indent <= parentIndent) return ["", index + 1]
    const blockIndent = lines[index + 1].indent
    const value = []
    let next = index + 1
    while (next < lines.length && lines[next].indent > parentIndent) {
      value.push(lines[next].raw.slice(Math.min(blockIndent, lines[next].indent)))
      next++
    }
    return [style === ">" ? value.join(" ") : value.join("\n"), next]
  }

  function parseMap(index, indent, firstEntry = null) {
    const value = {}
    let next = index

    function assign(entry) {
      const [key, rawValue] = pair(entry.content)
      if (rawValue === "|" || rawValue === ">") {
        const [block, after] = parseBlockScalar(next - 1, entry.indent, rawValue)
        value[key] = block
        next = after
      } else if (rawValue !== "") {
        value[key] = scalar(rawValue)
      } else if (next < lines.length && lines[next].indent > entry.indent) {
        const [child, after] = parseNode(next, lines[next].indent)
        value[key] = child
        next = after
      } else {
        value[key] = null
      }
    }

    if (firstEntry) assign(firstEntry)
    while (next < lines.length && lines[next].indent === indent && !lines[next].content.startsWith("- ")) {
      const entry = lines[next]
      next++
      assign(entry)
    }
    return [value, next]
  }

  function parseSequence(index, indent) {
    const value = []
    let next = index
    while (next < lines.length && lines[next].indent === indent && lines[next].content.startsWith("- ")) {
      const line = lines[next]
      const rest = line.content.slice(2)
      next++
      if (rest === "") {
        const [child, after] = parseNode(next, lines[next].indent)
        value.push(child)
        next = after
      } else if (rest.includes(":")) {
        const [child, after] = parseMap(next, indent + 2, { indent: indent + 2, content: rest })
        value.push(child)
        next = after
      } else {
        value.push(scalar(rest))
      }
    }
    return [value, next]
  }

  function parseNode(index, indent) {
    if (!lines[index]) throw new Error("Unexpected end of YAML")
    return lines[index].content.startsWith("- ")
      ? parseSequence(index, indent)
      : parseMap(index, indent)
  }

  if (lines.length === 0) throw new Error("Workflow YAML is empty")
  const [document, consumed] = parseNode(0, lines[0].indent)
  if (consumed !== lines.length) throw new Error(`Could not parse workflow YAML after line ${consumed + 1}`)
  return document
}

async function loadWorkflow() {
  const text = await readFile(path.join(repo, ".github", "workflows", "qa-preview.yml"), "utf8")
  return { text, workflow: parseYaml(text) }
}

test("preview QA workflow parses with only pull_request and workflow_dispatch triggers", async () => {
  const { workflow } = await loadWorkflow()
  assert.deepEqual(Object.keys(workflow.on).sort(), ["pull_request", "workflow_dispatch"])
  assert.equal(workflow.jobs["qa-preview"]["runs-on"], "ubuntu-latest")
})

test("workflow builds and deploys a Vercel Preview without production flags or aliases", async () => {
  const { text, workflow } = await loadWorkflow()
  const steps = workflow.jobs["qa-preview"].steps
  const build = steps.find((step) => step.name === "Build Vercel Preview")
  const deploy = steps.find((step) => step.name === "Deploy Vercel Preview only")

  assert.match(build.run, /vercel build --target=preview/)
  assert.match(deploy.run, /vercel deploy --prebuilt --target=preview/)
  assert.match(deploy.run, /githubDeployment=1/)
  assert.doesNotMatch(text, /--prod|\bvercel\s+(?:promote|alias)\b/i)
})

test("workflow creates the owner login before strict QA and points both steps at the Preview", async () => {
  const { workflow } = await loadWorkflow()
  const steps = workflow.jobs["qa-preview"].steps
  const deployIndex = steps.findIndex((step) => step.name === "Deploy Vercel Preview only")
  const loginIndex = steps.findIndex((step) => step.name === "Create one-use owner QA login")
  const qaIndex = steps.findIndex((step) => step.name === "Run strict preview QA")
  const login = steps[loginIndex]
  const qa = steps[qaIndex]

  assert.ok(deployIndex < loginIndex && loginIndex < qaIndex)
  assert.match(login.run, /node scripts\/create-local-login\.mjs/)
  assert.match(login.run, /MCSW_QA_LOGIN_URL=/)
  assert.equal(login.env.DATABASE_URL, "${{ secrets.DATABASE_URL }}")
  assert.equal(qa.env.MCSW_QA_STRICT, "1")
  assert.equal(qa.env.MCSW_QA_BASE, "${{ steps.deploy.outputs.url }}")
  assert.equal(qa.env.VERCEL_AUTOMATION_BYPASS_SECRET, "${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}")
  assert.match(qa.run, /npm run test:qa/)
})

test("missing protection bypass fails clearly and the workflow sends its header from the secret", async () => {
  const { workflow } = await loadWorkflow()
  const steps = workflow.jobs["qa-preview"].steps
  const requireSecret = steps.find((step) => step.name === "Require Vercel protection bypass")
  const protectedRequest = steps.find((step) => step.name === "Verify protected Preview is reachable")
  const config = await readFile(path.join(repo, "scripts", "qa", "playwright.config.mjs"), "utf8")

  assert.equal(
    requireSecret.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    "${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
  )
  assert.match(requireSecret.run, /if \[ -z "\$VERCEL_AUTOMATION_BYPASS_SECRET" \]/)
  assert.match(requireSecret.run, /::error::[^\n]*VERCEL_AUTOMATION_BYPASS_SECRET/)
  assert.match(requireSecret.run, /exit 1/)
  assert.doesNotMatch(requireSecret.run, /echo\s+"?\$VERCEL_AUTOMATION_BYPASS_SECRET/)
  assert.match(
    protectedRequest.run,
    /x-vercel-protection-bypass: \$VERCEL_AUTOMATION_BYPASS_SECRET/,
  )
  assert.equal(
    protectedRequest.env.VERCEL_AUTOMATION_BYPASS_SECRET,
    "${{ secrets.VERCEL_AUTOMATION_BYPASS_SECRET }}",
  )
  assert.match(config, /"x-vercel-protection-bypass": automationBypass/)
  assert.match(config, /required for strict preview QA/)
})
