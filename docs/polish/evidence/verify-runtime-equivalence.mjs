import fs from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import ts from "typescript"

const baseCommit = "5d116c0"
const files = [
  "lib/ad-spend.ts",
  "lib/ai-usage.ts",
  "lib/call-sketch-claims.ts",
  "lib/csp-report.ts",
  "lib/photo-draft-workflow.ts",
  "lib/shop-brain-invariants.ts",
]
const compilerOptions = {
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  removeComments: true,
  newLine: ts.NewLineKind.LineFeed,
}

function emit(source, fileName) {
  return ts.transpileModule(source, { compilerOptions, fileName }).outputText
}

function normalize(node) {
  if (ts.isParenthesizedExpression(node)) return normalize(node.expression)
  const result = { kind: ts.SyntaxKind[node.kind] }
  if (
    ts.isIdentifier(node)
    || ts.isPrivateIdentifier(node)
    || ts.isStringLiteral(node)
    || ts.isNumericLiteral(node)
    || ts.isRegularExpressionLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isBigIntLiteral(node)
  ) {
    result.text = node.text
  }
  const children = []
  node.forEachChild((child) => { children.push(normalize(child)) })
  if (children.length) result.children = children
  return result
}

function astJson(source, fileName) {
  const tree = ts.createSourceFile(fileName.replace(/\.ts$/, ".js"), source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
  return JSON.stringify(normalize(tree))
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex")
}

const results = files.map((file) => {
  const beforeSource = execFileSync("git", ["show", baseCommit + ":" + file], { encoding: "utf8" })
  const afterSource = fs.readFileSync(file, "utf8")
  const beforeJs = emit(beforeSource, file)
  const afterJs = emit(afterSource, file)
  const beforeAst = astJson(beforeJs, file)
  const afterAst = astJson(afterJs, file)
  return {
    file,
    equivalent: beforeAst === afterAst,
    normalizedAstBeforeSha256: hash(beforeAst),
    normalizedAstAfterSha256: hash(afterAst),
    emittedTextIdentical: beforeJs === afterJs,
  }
})

const artifact = {
  generatedAt: new Date().toISOString(),
  baseCommit,
  workspaceHead: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  node: process.version,
  compilerOptions: {
    target: "ESNext",
    module: "ESNext",
    removeComments: true,
  },
  normalization: "Source positions and ParenthesizedExpression wrappers ignored; identifier and literal text retained.",
  allEquivalent: results.every((result) => result.equivalent),
  files: results,
}

fs.writeFileSync("docs/polish/evidence/G01-runtime-equivalence.json", JSON.stringify(artifact, null, 2) + "\n")
console.log(JSON.stringify(artifact, null, 2))
if (!artifact.allEquivalent) process.exitCode = 1
