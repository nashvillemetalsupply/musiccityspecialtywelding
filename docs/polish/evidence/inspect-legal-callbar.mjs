import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const route of ["/privacy", "/terms"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    const response = await page.goto("https://musiccityspecialtywelding.com" + route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    const fixedBottom = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.position === "fixed" && box.bottom >= innerHeight - 2 && box.height > 0 && box.width > 0;
    }).map((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : null,
        text: (element.textContent || "").trim().replace(/\s+/g, " "),
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        opacity: style.opacity,
        zIndex: style.zIndex,
        box: { x: box.x, y: box.y, width: box.width, height: box.height, bottom: box.bottom },
        children: [...element.children].map((child) => {
          const childStyle = getComputedStyle(child);
          const childBox = child.getBoundingClientRect();
          return {
            tag: child.tagName.toLowerCase(),
            className: typeof child.className === "string" ? child.className : null,
            text: (child.textContent || "").trim().replace(/\s+/g, " "),
            color: childStyle.color,
            backgroundColor: childStyle.backgroundColor,
            backgroundImage: childStyle.backgroundImage,
            opacity: childStyle.opacity,
            box: { x: childBox.x, y: childBox.y, width: childBox.width, height: childBox.height },
          };
        }),
      };
    }));
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    results.push({
      route,
      status: response ? response.status() : null,
      fixedBottom,
      axeViolations: axe.violations.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.map((node) => ({ target: node.target, html: node.html, failureSummary: node.failureSummary })),
      })),
    });
    await context.close();
  }
} finally {
  await browser.close();
}
await writeFile("docs/polish/evidence/live-audit-2026-10-02/legal-mobile-callbar.json", JSON.stringify(results, null, 2));
process.stdout.write(JSON.stringify(results, null, 2));
