import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve("docs/polish/evidence/live-audit-2026-10-02");
const discovery = JSON.parse(await readFile(path.join(ROOT, "route-manifest.json"), "utf8"));
const urls = [...discovery.routes, "https://musiccityspecialtywelding.com/__mcsw_public_audit_missing_2026_10_02__"];
const viewports = [
  { name: "mobile-390", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "desktop-1440", width: 1440, height: 900, isMobile: false, hasTouch: false },
];
const shotRoot = path.join(ROOT, "screenshots", "forced-content-visibility");
await mkdir(shotRoot, { recursive: true });

function slug(url) {
  return (new URL(url).pathname.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "home").slice(0, 90);
}

function violation(item) {
  return {
    id: item.id,
    impact: item.impact,
    help: item.help,
    nodes: item.nodes.map((node) => ({
      target: node.target,
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  };
}

const browser = await chromium.launch({ headless: true });
const audits = [];
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    for (const url of urls) {
      process.stdout.write("FORCED " + viewport.name + " " + url + "\n");
      let navigation;
      try {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(1000);
        navigation = { ok: true, status: response ? response.status() : null, finalUrl: page.url() };
      } catch (error) {
        navigation = { ok: false, status: null, finalUrl: page.url(), error: String(error) };
      }
      await page.addStyleTag({ content: "* { content-visibility: visible !important; }" });
      await page.evaluate(async () => {
        const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
        const step = Math.max(400, Math.floor(innerHeight * 0.75));
        let position = 0;
        let passes = 0;
        while (position < document.documentElement.scrollHeight && passes < 100) {
          scrollTo(0, position);
          await pause(100);
          position += step;
          passes += 1;
        }
        scrollTo(0, document.documentElement.scrollHeight);
        await pause(500);
      });
      await page.waitForTimeout(500);
      const shotDir = path.join(shotRoot, viewport.name);
      await mkdir(shotDir, { recursive: true });
      const screenshot = path.join(shotDir, slug(url) + ".png");
      await page.screenshot({ path: screenshot, fullPage: true });
      let axe = { violations: [], passes: 0, incomplete: [], error: null };
      try {
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        axe = {
          violations: result.violations.map(violation),
          passes: result.passes.length,
          incomplete: result.incomplete.map(violation),
          error: null,
        };
      } catch (error) {
        axe.error = String(error);
      }
      const dom = await page.evaluate(() => ({
        forcedRule: [...document.styleSheets].some((sheet) => {
          try {
            return [...sheet.cssRules].some((rule) => rule.cssText.includes("content-visibility: visible"));
          } catch {
            return false;
          }
        }),
        textLength: (document.body.innerText || "").length,
        headingCount: document.querySelectorAll("h1,h2,h3,h4,h5,h6").length,
        controlCount: document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"]').length,
        sectionCount: document.querySelectorAll("main section, footer").length,
        scrollHeight: document.documentElement.scrollHeight,
      }));
      audits.push({
        url,
        viewport,
        navigation,
        screenshot: path.relative(ROOT, screenshot).replaceAll("\\", "/"),
        injectedAuditStyle: "* { content-visibility: visible !important; }",
        purpose: "Coverage instrumentation only. Natural viewport screenshots remain visual authority.",
        axe,
        dom,
      });
    }
    await context.close();
  }
} finally {
  await browser.close();
}
const summary = {
  generatedAt: new Date().toISOString(),
  runs: audits.length,
  failedNavigations: audits.filter((audit) => !audit.navigation.ok).length,
  missingForcedRule: audits.filter((audit) => !audit.dom.forcedRule).length,
  axeViolations: audits.flatMap((audit) => audit.axe.violations.map((item) => ({
    route: new URL(audit.url).pathname,
    viewport: audit.viewport.name,
    id: item.id,
    impact: item.impact,
    nodes: item.nodes.length,
  }))),
};
await writeFile(path.join(ROOT, "forced-render-audit.json"), JSON.stringify({ summary, audits }, null, 2));
process.stdout.write("FORCED DONE " + JSON.stringify(summary) + "\n");
