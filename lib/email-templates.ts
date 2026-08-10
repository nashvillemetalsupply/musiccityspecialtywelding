import { getShopPhone } from "@/lib/shop-contact"

/* Branded email shell — same shop-wall identity as the site and the CRM.
   Table-based, inline-styled, no external assets; every send keeps a plain-
   text fallback. */

const COAL = "#14100b"
const WOOD = "#241809"
const CREAM = "#f7f1e2"
const PAPER = "#fdf9ec"
const INK = "#241a10"
const FIRE = "#ff8a2a"
const NEON = "#ffb46b"
const MUTED = "#6d5f47"

export function brandedEmail(options: {
  preheader: string
  headline: string
  bodyHtml: string
  ctaLabel?: string
  ctaUrl?: string
  footnote?: string
}): string {
  const shopPhone = getShopPhone()
  const cta = options.ctaLabel && options.ctaUrl
    ? `<tr><td align="left" style="padding: 8px 0 4px;">
        <a href="${options.ctaUrl}"
           style="display:inline-block;background:${FIRE};color:${INK};font-family:Arial Black,Arial,sans-serif;font-size:16px;font-weight:900;text-transform:uppercase;letter-spacing:1px;text-decoration:none;padding:14px 26px;border-radius:6px;border:3px solid #000;">
          ${options.ctaLabel}
        </a>
      </td></tr>`
    : ""

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${COAL};">
    <span style="display:none;max-height:0;overflow:hidden;">${options.preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COAL};padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <tr>
            <td style="background:${COAL};border:3px solid #000;border-radius:10px;padding:26px 28px 22px;text-align:left;">
              <div style="font-family:Courier New,monospace;font-size:11px;letter-spacing:4px;color:${NEON};text-transform:uppercase;">Music City</div>
              <div style="font-family:Arial Black,Arial,sans-serif;font-size:30px;line-height:1;color:${NEON};text-transform:uppercase;letter-spacing:1px;">Specialty Welding</div>
              <div style="font-family:Courier New,monospace;font-size:11px;letter-spacing:3px;color:#d4cab8;text-transform:uppercase;margin-top:8px;">Lebanon, TN &nbsp;·&nbsp; Open 24 hours &nbsp;·&nbsp; ${shopPhone.display}</div>
            </td>
          </tr>
          <tr><td style="height:12px;font-size:0;">&nbsp;</td></tr>
          <tr>
            <td style="background:${PAPER};border-radius:4px;padding:28px 30px 26px;color:${INK};font-family:Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 14px;font-family:Arial Black,Arial,sans-serif;font-size:22px;line-height:1.15;text-transform:uppercase;color:${INK};">${options.headline}</h1>
              <div style="font-size:16px;line-height:1.65;color:#3d3324;">${options.bodyHtml}</div>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;">${cta}</table>
            </td>
          </tr>
          <tr><td style="height:12px;font-size:0;">&nbsp;</td></tr>
          <tr>
            <td style="background:${WOOD};border-radius:4px;padding:18px 24px;color:${CREAM};font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;">
              <strong style="color:${NEON};">Built here. Fixed where it sits.</strong><br />
              533 W Baddour Pkwy, Lebanon, TN 37087<br />
              <a href="${shopPhone.href}" style="color:${CREAM};">${shopPhone.display}</a> ·
              <a href="mailto:sales@musiccityspecialtywelding.com" style="color:${CREAM};">sales@musiccityspecialtywelding.com</a> ·
              <a href="https://musiccityspecialtywelding.com" style="color:${NEON};">musiccityspecialtywelding.com</a>
              ${options.footnote ? `<div style="margin-top:10px;color:${MUTED};font-size:12px;">${options.footnote}</div>` : ""}
            </td>
          </tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}
