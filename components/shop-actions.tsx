"use client"

import Link from "next/link"
import { Phone } from "lucide-react"

type AskShopButtonProps = { className?: string; onClick?: () => void }

export function AskShopButton({ className = "ms-button ms-button-secondary", onClick }: AskShopButtonProps) {
  if (process.env.NEXT_PUBLIC_ASSISTANT_CHAT === "1") {
    return (
      <button className={className} type="button" aria-haspopup="dialog" aria-controls="shop-assistant" onClick={() => {
        onClick?.()
        window.dispatchEvent(new Event("ms:open-assistant"))
      }}>Ask the shop</button>
    )
  }

  return <Link className={className} href="/#contact" onClick={onClick}>Ask the shop</Link>
}

export function ShopActions({ phoneHref, className = "" }: { phoneHref: string; className?: string }) {
  return (
    <div className={`ms-actions ${className}`.trim()}>
      <a className="ms-button ms-button-primary" href={phoneHref}><Phone aria-hidden="true" />Call the shop</a>
      <AskShopButton />
    </div>
  )
}
