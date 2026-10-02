import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const url = "https://musiccityspecialtywelding.com/services/trailer-welding-repair";
const browser = await chromium.launch({ headless: true });
const runs = [];
try {
  for (let index = 0; index < 3; index += 1) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
    await context.addInitScript(() => {
      window.__lcp = null;
      try {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const last = entries[entries.length - 1];
          if (last) window.__lcp = { value: last.startTime, element: last.element ? last.element.tagName : null, url: last.url || null, size: last.size || null };
        }).observe({ type: "largest-contentful-paint", buffered: true });
      } catch {}
    });
    const page = await context.newPage();
    const started = Date.now();
    const response = await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(4000);
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0];
      return {
        lcp: window.__lcp,
        responseStart: nav?.responseStart ?? null,
        responseEnd: nav?.responseEnd ?? null,
        domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
        loadEvent: nav?.loadEventEnd ?? null,
        duration: nav?.duration ?? null,
        transferSize: nav?.transferSize ?? null,
      };
    });
    runs.push({ run: index + 1, status: response ? response.status() : null, wallMs: Date.now() - started, ...perf });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile("docs/polish/evidence/live-audit-2026-10-02/trailer-mobile-remeasure.json", JSON.stringify(runs, null, 2));
process.stdout.write(JSON.stringify(runs, null, 2));
