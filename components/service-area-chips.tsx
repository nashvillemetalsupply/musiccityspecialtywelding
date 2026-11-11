import Link from "next/link"
import { serviceAreas } from "@/lib/service-areas"

export function ServiceAreaChips() {
  return (
    <div className="ms-city-list" aria-label="Service areas">
      {serviceAreas.map((area) => (
        <Link href="/services/mobile-welding#service" key={area}>{area}</Link>
      ))}
    </div>
  )
}
