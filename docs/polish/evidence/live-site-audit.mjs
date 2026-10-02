import { chromium, request as playwrightRequest } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const BASE = process.env.MCSW_AUDIT_BASE || "https://musiccityspecialtywelding.com";
const OUT = process.env.MCSW_AUDIT_OUT || path.resolve("docs/polish/evidence/live-audit-2026-10-02");
const SHOTS = path.join(OUT, "screenshots");
const MISSING_PATH = "/__mcsw_public_audit_missing_2026_10_02__";
const VIEWPORTS = [
  { name: "mobile-390", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "desktop-1440", width: 1440, height: 900, isMobile: false, hasTouch: false },
];
const EXCLUDE = ["/_next", "/api", "/ops", "/board", "/j/", "/auth", "/login"];
const ASSET = /\.(?:avif|css|gif|ico|jpe?g|js|json|map|mp4|pdf|png|svg|webm|webp|xml|zip)$/i;
await mkdir(SHOTS, { recursive: true });

function slug(value) {
  return (value.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "home").slice(0, 90);
}

function publicRoute(raw) {
  try {
    const origin = new URL(BASE);
    const url = new URL(raw, origin);
    if (url.origin !== origin.origin || url.search || ASSET.test(url.pathname)) return null;
    if (EXCLUDE.some((prefix) => url.pathname === prefix || url.pathname.startsWith(prefix))) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch {
    return null;
  }
}

async function safeGoto(page, url) {
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    return {
      ok: true,
      status: response ? response.status() : null,
      finalUrl: page.url(),
      headers: response ? await response.allHeaders() : {},
    };
  } catch (error) {
    return { ok: false, status: null, finalUrl: page.url(), headers: {}, error: String(error) };
  }
}

async function discover(browser, api) {
  const sitemapUrl = new URL("/sitemap.xml", BASE).href;
  const sitemap = { url: sitemapUrl, status: null, error: null, routes: [] };
  try {
    const response = await api.get(sitemapUrl, { timeout: 30000 });
    sitemap.status = response.status();
    const xml = await response.text();
    sitemap.routes = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map((match) => publicRoute(match[1])).filter(Boolean);
  } catch (error) {
    sitemap.error = String(error);
  }

  const queue = [...new Set([publicRoute(BASE), ...sitemap.routes].filter(Boolean))];
  const visited = new Set();
  const linkSources = {};
  const errors = [];
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  while (queue.length && visited.size < 50) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;
    visited.add(url);
    const navigation = await safeGoto(page, url);
    if (!navigation.ok) {
      errors.push({ url, error: navigation.error });
      continue;
    }
    const links = await page.locator("a[href]").evaluateAll((anchors) => anchors.map((anchor) => ({
      href: anchor.href,
      text: (anchor.textContent || "").trim().replace(/\s+/g, " "),
    })));
    for (const link of links) {
      const normalized = publicRoute(link.href);
      if (!normalized) continue;
      if (!linkSources[normalized]) linkSources[normalized] = [];
      linkSources[normalized].push({ source: url, text: link.text });
      if (!visited.has(normalized) && !queue.includes(normalized)) queue.push(normalized);
    }
  }
  await context.close();
  return { sitemap, routes: [...visited], linkSources, errors };
}

function axeItem(item) {
  return {
    id: item.id,
    impact: item.impact,
    description: item.description,
    help: item.help,
    helpUrl: item.helpUrl,
    tags: item.tags,
    nodes: item.nodes.map((node) => ({
      impact: node.impact,
      target: node.target,
      html: node.html,
      failureSummary: node.failureSummary,
    })),
  };
}

async function auditOne(browser, url, viewport) {
  const routeSlug = slug(new URL(url).pathname);
  const shotDir = path.join(SHOTS, viewport.name, routeSlug);
  await mkdir(shotDir, { recursive: true });
  const consoleMessages = [];
  const pageErrors = [];
  const failedRequests = [];
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.isMobile,
    hasTouch: viewport.hasTouch,
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    locale: "en-US",
    colorScheme: "dark",
  });
  await context.addInitScript(() => {
    window.__mcswAuditPerf = { lcp: null, cls: 0, layoutShifts: [] };
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last) window.__mcswAuditPerf.lcp = {
          value: last.startTime,
          element: last.element ? last.element.tagName : null,
          url: last.url || null,
          size: last.size || null,
        };
      }).observe({ type: "largest-contentful-paint", buffered: true });
    } catch {}
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__mcswAuditPerf.cls += entry.value;
            window.__mcswAuditPerf.layoutShifts.push({ value: entry.value, startTime: entry.startTime });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {}
  });
  const page = await context.newPage();
  page.on("console", (message) => consoleMessages.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => pageErrors.push({ message: error.message, stack: error.stack || null }));
  page.on("requestfailed", (request) => failedRequests.push({
    url: request.url(),
    method: request.method(),
    failure: request.failure() ? request.failure().errorText : null,
  }));

  const navigation = await safeGoto(page, url);
  const screenshots = [];
  const topPath = path.join(shotDir, "00-top.png");
  await page.screenshot({ path: topPath });
  screenshots.push(path.relative(OUT, topPath).replaceAll("\\", "/"));

  let selector = "main section, footer";
  let sections = await page.locator(selector).evaluateAll((nodes) => nodes.map((node, index) => ({
    index,
    tag: node.tagName.toLowerCase(),
    id: node.id || null,
    ariaLabel: node.getAttribute("aria-label"),
    heading: (node.querySelector("h1,h2,h3")?.textContent || "").trim().replace(/\s+/g, " ") || null,
  })));
  if (sections.length === 0) {
    selector = "main > *";
    sections = await page.locator(selector).evaluateAll((nodes) => nodes.map((node, index) => ({
      index,
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      ariaLabel: node.getAttribute("aria-label"),
      heading: (node.querySelector("h1,h2,h3")?.textContent || "").trim().replace(/\s+/g, " ") || null,
    })));
  }

  const sectionLocator = page.locator(selector);
  for (let index = 0; index < sections.length; index += 1) {
    try {
      await sectionLocator.nth(index).scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const label = slug(sections[index].id || sections[index].heading || (sections[index].tag + "-" + (index + 1)));
      const file = path.join(shotDir, String(index + 1).padStart(2, "0") + "-" + label + ".png");
      await page.screenshot({ path: file });
      screenshots.push(path.relative(OUT, file).replaceAll("\\", "/"));
    } catch (error) {
      sections[index].screenshotError = String(error);
    }
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(700);
  const fullPath = path.join(shotDir, "99-full-page.png");
  await page.screenshot({ path: fullPath, fullPage: true });
  screenshots.push(path.relative(OUT, fullPath).replaceAll("\\", "/"));

  let axe = { violations: [], passes: 0, incomplete: [], error: null };
  try {
    const result = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    axe = {
      violations: result.violations.map(axeItem),
      passes: result.passes.length,
      incomplete: result.incomplete.map(axeItem),
      error: null,
    };
  } catch (error) {
    axe.error = String(error);
  }

  const evidence = await page.evaluate(() => {
    const box = (element) => {
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const value = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && value.width > 0 && value.height > 0;
    };
    const schemas = [...document.querySelectorAll('script[type="application/ld+json"]')].map((script, index) => {
      const raw = script.textContent || "";
      try {
        const parsed = JSON.parse(raw);
        const roots = Array.isArray(parsed) ? parsed : [parsed];
        const records = roots.flatMap((root) => Array.isArray(root?.["@graph"]) ? root["@graph"] : [root]);
        return {
          index,
          valid: true,
          types: records.flatMap((record) => Array.isArray(record?.["@type"]) ? record["@type"] : [record?.["@type"]]).filter(Boolean),
          parsed,
        };
      } catch (error) {
        return { index, valid: false, error: String(error), raw: raw.slice(0, 500) };
      }
    });
    const overflowElements = [...document.querySelectorAll("body *")].filter(visible).map((element) => ({
      tag: element.tagName.toLowerCase(),
      id: element.id || null,
      className: typeof element.className === "string" ? element.className : null,
      text: (element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
      box: box(element),
    })).filter((item) => item.box.right > window.innerWidth + 1 || item.box.x < -1);
    const smallTargets = [...document.querySelectorAll('a[href],button,input:not([type="hidden"]),select,textarea,[role="button"]')]
      .filter(visible)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        text: (element.textContent || element.getAttribute("aria-label") || element.getAttribute("name") || "").trim().replace(/\s+/g, " ").slice(0, 100),
        href: element instanceof HTMLAnchorElement ? element.href : null,
        box: box(element),
      }))
      .filter((item) => item.box.width < 44 || item.box.height < 44);
    const nav = performance.getEntriesByType("navigation")[0];

    return {
      document: {
        lang: document.documentElement.lang || null,
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || null,
        viewport: document.querySelector('meta[name="viewport"]')?.content || null,
        canonical: document.querySelector('link[rel="canonical"]')?.href || null,
        robots: [...document.querySelectorAll('meta[name="robots"]')].map((node) => node.content),
        openGraph: Object.fromEntries([...document.querySelectorAll('meta[property^="og:"]')].map((node) => [node.getAttribute("property"), node.content])),
        twitter: Object.fromEntries([...document.querySelectorAll('meta[name^="twitter:"]')].map((node) => [node.getAttribute("name"), node.content])),
      },
      headings: [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map((node) => ({
        level: Number(node.tagName.slice(1)),
        text: (node.textContent || "").trim().replace(/\s+/g, " "),
      })),
      images: [...document.images].map((image) => ({
        src: image.currentSrc || image.src,
        altPresent: image.hasAttribute("alt"),
        alt: image.getAttribute("alt"),
        role: image.getAttribute("role"),
        ariaHidden: image.getAttribute("aria-hidden"),
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        rendered: box(image),
        loading: image.loading,
      })),
      links: [...document.querySelectorAll("a[href]")].map((anchor) => ({
        href: anchor.href,
        rawHref: anchor.getAttribute("href"),
        text: (anchor.textContent || "").trim().replace(/\s+/g, " ") || anchor.getAttribute("aria-label") || "",
        target: anchor.target || null,
        rel: anchor.rel || null,
      })),
      forms: [...document.forms].map((form) => ({
        action: form.action,
        method: form.method,
        fields: [...form.elements].map((field) => ({
          tag: field.tagName.toLowerCase(),
          type: field.getAttribute("type"),
          name: field.getAttribute("name"),
          autocomplete: field.getAttribute("autocomplete"),
          required: field.hasAttribute("required"),
          ariaLabel: field.getAttribute("aria-label"),
          label: field.id ? document.querySelector('label[for="' + CSS.escape(field.id) + '"]')?.textContent?.trim() || null : null,
        })),
      })),
      schema: schemas,
      layout: {
        innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body ? document.body.scrollWidth : null,
        hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        overflowElements,
        smallTargets,
      },
      performance: {
        observer: window.__mcswAuditPerf || null,
        navigation: nav ? {
          duration: nav.duration,
          domContentLoaded: nav.domContentLoadedEventEnd,
          loadEvent: nav.loadEventEnd,
          responseStart: nav.responseStart,
          responseEnd: nav.responseEnd,
          transferSize: nav.transferSize,
          decodedBodySize: nav.decodedBodySize,
        } : null,
      },
    };
  });

  await context.close();
  return { url, viewport, navigation, screenshots, sections, axe, consoleMessages, pageErrors, failedRequests, ...evidence };
}

function uniqueLinks(audits) {
  const records = new Map();
  for (const audit of audits) {
    for (const link of audit.links || []) {
      if (!records.has(link.href)) records.set(link.href, { ...link, sources: [] });
      const record = records.get(link.href);
      if (!record.sources.some((source) => source.url === audit.url && source.text === link.text)) {
        record.sources.push({ url: audit.url, viewport: audit.viewport.name, text: link.text });
      }
    }
  }
  return [...records.values()];
}

async function checkLink(api, link) {
  if (/^tel:/i.test(link.href)) {
    const value = link.href.replace(/^tel:/i, "").replace(/[^\d+]/g, "");
    return { ...link, kind: "tel", valid: /^\+?\d{10,15}$/.test(value), status: null, networkError: null };
  }
  if (/^mailto:/i.test(link.href)) {
    const value = link.href.replace(/^mailto:/i, "").split("?")[0];
    return { ...link, kind: "mailto", valid: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), status: null, networkError: null };
  }
  if (!/^https?:/i.test(link.href)) return { ...link, kind: "other", valid: null, status: null, networkError: null };
  const url = new URL(link.href);
  url.hash = "";
  try {
    let response = await api.head(url.href, { timeout: 30000, maxRedirects: 10 });
    if ([403, 405].includes(response.status())) response = await api.get(url.href, { timeout: 30000, maxRedirects: 10 });
    return {
      ...link,
      checkedUrl: url.href,
      kind: url.origin === new URL(BASE).origin ? "internal" : "external",
      valid: response.status() < 400,
      status: response.status(),
      finalUrl: response.url(),
      networkError: null,
    };
  } catch (error) {
    return {
      ...link,
      checkedUrl: url.href,
      kind: url.origin === new URL(BASE).origin ? "internal" : "external",
      valid: null,
      status: null,
      finalUrl: null,
      networkError: String(error),
    };
  }
}

function summarize(discovery, audits, linkChecks) {
  const routeStatusFailures = audits.filter((audit) => !audit.navigation.ok || (audit.navigation.status !== null && audit.navigation.status >= 400 && !audit.url.endsWith(MISSING_PATH)));
  const axeViolations = audits.flatMap((audit) => audit.axe.violations.map((violation) => ({
    route: new URL(audit.url).pathname,
    viewport: audit.viewport.name,
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
  })));
  const overflow = audits.filter((audit) => audit.layout.hasHorizontalOverflow).map((audit) => ({
    route: new URL(audit.url).pathname,
    viewport: audit.viewport.name,
    scrollWidth: audit.layout.documentScrollWidth,
    innerWidth: audit.layout.innerWidth,
    elements: audit.layout.overflowElements.length,
  }));
  const missingAlt = audits.flatMap((audit) => audit.images.filter((image) => !image.altPresent).map((image) => ({
    route: new URL(audit.url).pathname,
    viewport: audit.viewport.name,
    src: image.src,
  })));
  const pageErrors = audits.flatMap((audit) => audit.pageErrors.map((error) => ({
    route: new URL(audit.url).pathname,
    viewport: audit.viewport.name,
    ...error,
  })));
  const linkProblems = linkChecks.filter((link) => link.valid === false);
  const linkNetworkErrors = linkChecks.filter((link) => link.networkError);
  const missingAudits = audits.filter((audit) => audit.url.endsWith(MISSING_PATH)).map((audit) => ({
    viewport: audit.viewport.name,
    status: audit.navigation.status,
    robots: audit.document.robots,
    title: audit.document.title,
    axeViolations: audit.axe.violations.length,
  }));
  return {
    generatedAt: new Date().toISOString(),
    base: BASE,
    routeCount: discovery.routes.length,
    viewportRuns: audits.length,
    counts: {
      routeStatusFailures: routeStatusFailures.length,
      axeViolations: axeViolations.length,
      horizontalOverflowRuns: overflow.length,
      missingAltOccurrences: missingAlt.length,
      pageErrors: pageErrors.length,
      linkProblems: linkProblems.length,
      linkNetworkErrors: linkNetworkErrors.length,
    },
    routeStatusFailures,
    axeViolations,
    overflow,
    missingAlt,
    pageErrors,
    linkProblems,
    linkNetworkErrors,
    missingRoute: missingAudits,
  };
}

const browser = await chromium.launch({ headless: true });
const api = await playwrightRequest.newContext({ userAgent: "MCSW-Public-Site-Audit/2026-10-02" });
try {
  const discovery = await discover(browser, api);
  process.stdout.write("DISCOVERED " + discovery.routes.length + " routes\n");
  const missingUrl = new URL(MISSING_PATH, BASE).href;
  const audits = [];
  for (const url of [...discovery.routes, missingUrl]) {
    for (const viewport of VIEWPORTS) {
      process.stdout.write("AUDIT " + viewport.name + " " + url + "\n");
      audits.push(await auditOne(browser, url, viewport));
    }
  }
  const linkChecks = [];
  for (const link of uniqueLinks(audits.filter((audit) => audit.url !== missingUrl))) {
    process.stdout.write("LINK " + link.href + "\n");
    linkChecks.push(await checkLink(api, link));
  }
  const summary = summarize(discovery, audits, linkChecks);
  await writeFile(path.join(OUT, "route-manifest.json"), JSON.stringify(discovery, null, 2));
  await writeFile(path.join(OUT, "live-audit.json"), JSON.stringify({ summary, discovery, audits }, null, 2));
  await writeFile(path.join(OUT, "link-check.json"), JSON.stringify(linkChecks, null, 2));
  await writeFile(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2));
  process.stdout.write("DONE " + JSON.stringify(summary.counts) + "\n");
} finally {
  await api.dispose();
  await browser.close();
}
