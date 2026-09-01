import { getShopPhone } from "@/lib/shop-contact"

export type ServicePage = {
  slug: string
  title: string
  shortTitle: string
  seoTitle: string
  metaDescription: string
  eyebrow: string
  intro: string
  image: string
  imageAlt: string
  commonJobs: string[]
  goodFit: string[]
  details: string[]
  faqs: { question: string; answer: string }[]
}

export const servicePages: ServicePage[] = [
  {
    slug: "mobile-welding",
    title: "Mobile Welding in Nashville & Middle Tennessee",
    shortTitle: "Mobile Welding",
    seoTitle: "Mobile Welder Nashville & Middle Tennessee",
    metaDescription:
      "On-site mobile welding for equipment, trailers, facilities, and repair work across Nashville, Lebanon, and surrounding Middle Tennessee communities.",
    eyebrow: "The welding equipment comes to you",
    intro:
      "When moving the damaged equipment or metalwork is impractical, we bring mobile welding capability to the job site. We review the failure, access, material, and working conditions before confirming the safest and most efficient repair plan.",
    image: "/images/owner-work/IMG_20260225_135845.webp",
    imageAlt: "Installed steel balcony railing completed on-site by Music City Specialty Welding",
    commonJobs: [
      "Equipment and trailer component repairs",
      "Broken brackets, frames, supports, and attachments",
      "On-site gate, railing, and structural metal repairs",
      "Commercial and industrial repair calls",
    ],
    goodFit: [
      "The item is difficult, expensive, or unsafe to transport",
      "Downtime matters and the repair must be evaluated on-site",
      "The work area can be made safe for hot work",
      "Photos and a clear location can be provided before dispatch",
    ],
    details: [
      "Send photos of the full item and close-ups of the failure.",
      "Include the job-site address, access restrictions, and desired timing.",
      "Call for urgent requests so current availability can be confirmed.",
    ],
    faqs: [
      {
        question: "How far will you travel?",
        answer:
          "Travel depends on the job size, location, and schedule. We routinely serve Lebanon, Nashville, and surrounding Middle Tennessee communities; call for an exact availability check.",
      },
      {
        question: "Can every repair be completed on-site?",
        answer:
          "No. Access, material condition, weather, fire risk, power, and the required repair method can make shop work the better option. We will tell you when an on-site repair is not the right fit.",
      },
      {
        question: "Do you handle emergency work?",
        answer: `Urgent work is accepted when scheduling and travel allow. Call ${getShopPhone().display} to confirm availability.`,
      },
    ],
  },
  {
    slug: "trailer-welding-repair",
    title: "Trailer Welding & Frame Repair in Middle Tennessee",
    shortTitle: "Trailer Welding & Repair",
    seoTitle: "Trailer Welding Repair Nashville & Middle Tennessee",
    metaDescription:
      "Trailer welding and frame repair for utility, work, equipment, and specialty trailers across Nashville, Lebanon, and Middle Tennessee.",
    eyebrow: "Repair the failure, not just the crack",
    intro:
      "Trailer damage can involve the frame, tongue, crossmembers, ramps, fenders, brackets, hangers, or the structure around the running gear. We inspect the damaged area and the surrounding load path before confirming what can be repaired and whether the work belongs on-site or in the shop.",
    image: "/images/owner-work/IMG_20250809_180018.webp",
    imageAlt: "Trailer frame and axle exposed during structural welding repair by Music City Specialty Welding",
    commonJobs: [
      "Cracked trailer frames, crossmembers, and support steel",
      "Ramps, fenders, brackets, hangers, and attachment points",
      "Utility, work, equipment, and specialty trailer repairs",
      "Damage evaluation before a trailer returns to service",
    ],
    goodFit: [
      "The damaged area and nearby structure can be photographed clearly",
      "The trailer can be safely staged for inspection and hot work",
      "The owner can explain the load, failure, and prior repairs",
      "A shop or mobile repair can be selected after the damage is reviewed",
    ],
    details: [
      "Send one photo of the full trailer plus close-ups from both sides of the damage.",
      "Include the trailer type, approximate capacity, location, and whether it can be moved.",
      "Mention prior repairs, visible bending, axle or suspension concerns, and the timing required.",
    ],
    faqs: [
      {
        question: "Can you repair a trailer where it sits?",
        answer:
          "Some trailer repairs can be completed on-site when access and hot-work conditions are suitable. Damage that needs better positioning, disassembly, or controlled fitting may be better handled in the shop.",
      },
      {
        question: "Can you weld a cracked trailer frame?",
        answer:
          "A crack may be repairable, but the surrounding deformation, corrosion, prior work, material, and cause of failure matter. We review those conditions before recommending a repair.",
      },
      {
        question: "What photos help with a trailer quote?",
        answer:
          "Send the entire trailer, the damaged area from both sides, nearby crossmembers or mounts, the identification plate if available, and anything visibly bent or displaced.",
      },
    ],
  },
  {
    slug: "equipment-repair",
    title: "Welding Repair for Equipment & Machinery",
    shortTitle: "Equipment Repair",
    seoTitle: "Equipment Welding Repair Nashville",
    metaDescription:
      "Welding repair and maintenance for industrial equipment, machinery, trailers, and working assets in Nashville and Middle Tennessee.",
    eyebrow: "Reduce downtime with a repair plan built around the equipment",
    intro:
      "We repair welded equipment and metal components with attention to how the part carries load, moves, mounts, and returns to service. The first step is understanding the failure, not simply covering a crack with another weld.",
    image: "/images/optimized/Service 04.webp",
    imageAlt: "Welding repair on industrial equipment",
    commonJobs: [
      "Cracked or failed welded components",
      "Frames, brackets, guards, supports, and attachments",
      "Trailer and material-handling equipment repairs",
      "Scheduled maintenance and urgent repair evaluation",
    ],
    goodFit: [
      "A failed metal component is stopping or limiting work",
      "The cause and load path need to be considered before repair",
      "Replacement lead time makes a sound repair worth evaluating",
      "The owner can provide equipment details and clear photos",
    ],
    details: [
      "Share the equipment make/model and the failed component if known.",
      "Photograph the full assembly, the damage, and nearby mounting points.",
      "Explain how the failure occurred and whether it has been repaired before.",
    ],
    faqs: [
      {
        question: "Can you repair equipment at our facility?",
        answer:
          "Many equipment repairs can be evaluated and completed on-site. The final decision depends on access, safety, material condition, and the repair method.",
      },
      {
        question: "Can you reinforce a repeatedly cracked area?",
        answer:
          "Possibly, but repeated failure often points to load, alignment, fatigue, or design issues. We review the surrounding assembly before recommending reinforcement.",
      },
      {
        question: "What information speeds up the quote?",
        answer: "Send the equipment make/model, location, several photos, approximate dimensions, and the timing required.",
      },
    ],
  },
  {
    slug: "architectural-welding",
    title: "Architectural Welding & Metal Fabrication",
    shortTitle: "Architectural Welding",
    seoTitle: "Architectural Welding Nashville",
    metaDescription:
      "Architectural welding and custom metal fabrication for railings, stairs, structural details, and commercial projects across Middle Tennessee.",
    eyebrow: "Metalwork that has to look right and perform correctly",
    intro:
      "Architectural metalwork demands both clean execution and practical installation planning. We review dimensions, finish expectations, attachment points, drawings, and site conditions before fabrication begins.",
    image: "/images/optimized/Service 02.webp",
    imageAlt: "Architectural welded steel staircase and railing",
    commonJobs: [
      "Steel railings, guardrails, and stair components",
      "Frames, supports, brackets, and architectural details",
      "Commercial metalwork built from drawings",
      "Repair or modification of existing architectural steel",
    ],
    goodFit: [
      "The project has drawings, dimensions, or a clear design reference",
      "Installation conditions need to be considered during fabrication",
      "Strength, alignment, appearance, and finish all matter",
      "The contractor or owner can confirm field dimensions and requirements",
    ],
    details: [
      "Send drawings, sketches, dimensions, finish requirements, and site photos.",
      "Identify who is responsible for engineering, permits, and final code approval where applicable.",
      "Confirm the installation location and target schedule before fabrication.",
    ],
    faqs: [
      {
        question: "Can you work from architectural drawings?",
        answer: "Yes. Provide the relevant sheets, dimensions, material notes, finishes, and installation requirements for review.",
      },
      {
        question: "Do you install the metalwork you fabricate?",
        answer:
          "Installation can be discussed as part of the project. Access, anchoring, site readiness, and project location determine the final scope.",
      },
      {
        question: "Who handles engineering and permits?",
        answer:
          "That depends on the project contract. Engineering, permitting, and inspection responsibilities should be confirmed before fabrication begins.",
      },
    ],
  },
  {
    slug: "custom-fabrication",
    title: "Custom & Specialty Metal Fabrication",
    shortTitle: "Custom Fabrication",
    seoTitle: "Custom Metal Fabrication Nashville",
    metaDescription:
      "Custom metal fabrication for brackets, frames, manifolds, signage, streetscape components, and built-to-spec projects in Middle Tennessee.",
    eyebrow: "Built from the requirement, not from a generic catalog",
    intro:
      "Custom fabrication starts by defining what the part must do, how it fits, and how it will be installed. We work from drawings, sketches, dimensions, samples, or a well-documented field requirement.",
    image: "/images/owner-work/stainless-worktable.webp",
    imageAlt: "Finished custom stainless steel worktable and sink fabricated for an existing room",
    commonJobs: [
      "Custom brackets, frames, supports, and assemblies",
      "Gas manifolds and specialized industrial metalwork",
      "Streetscape poles and custom signage components",
      "One-off or short-run fabrication built to drawings",
    ],
    goodFit: [
      "Off-the-shelf parts do not meet the application",
      "Dimensions, tolerances, or installation details are available",
      "The owner needs a practical fabrication partner for a defined requirement",
      "Material, finish, and schedule can be confirmed before production",
    ],
    details: [
      "Send drawings or a dimensioned sketch whenever possible.",
      "Identify material, quantity, finish, tolerances, and installation needs.",
      "Include photos of the mating components or final location.",
    ],
    faqs: [
      {
        question: "Do I need a finished CAD drawing?",
        answer:
          "Not always. A clear sketch, dimensions, photos, and an explanation of the application may be enough to begin reviewing the project.",
      },
      {
        question: "Can you duplicate an existing part?",
        answer:
          "Some parts can be recreated from a sample or complete measurements. Safety-critical or protected designs may require additional documentation or engineering.",
      },
      {
        question: "Do you handle one-off projects?",
        answer:
          "Yes. One-off and specialized projects are considered when the scope, material, dimensions, and intended use are clear.",
      },
    ],
  },
  {
    slug: "custom-metal-products",
    title: "Custom Metal Mailboxes & Planter Boxes",
    shortTitle: "Custom Metal Products",
    seoTitle: "Custom Metal Products Nashville",
    metaDescription:
      "Custom steel mailboxes, mailbox clusters, brackets, and metal planter boxes fabricated for residential and commercial properties.",
    eyebrow: "Durable exterior metalwork made for the property",
    intro:
      "We fabricate custom steel mailboxes, mailbox supports, cluster units, brackets, and planter boxes to fit the dimensions and look of a residential or commercial property.",
    image: "/images/mailbox.webp",
    imageAlt: "Custom wrought iron mailbox fabrication",
    commonJobs: [
      "Individual residential mailbox structures",
      "Mailbox clusters for multi-unit or commercial properties",
      "Mailbox repairs, brackets, and replacement metalwork",
      "Custom metal planter boxes sized for the space",
    ],
    goodFit: [
      "Standard retail products do not match the size or design needed",
      "Durability and a clean architectural appearance both matter",
      "The project has clear dimensions and placement details",
      "Installation requirements can be reviewed before fabrication",
    ],
    details: [
      "Send the desired dimensions, quantity, location photos, and design references.",
      "Identify the preferred finish and whether installation is needed.",
      "For planters, include placement, drainage, and soil/load considerations.",
    ],
    faqs: [
      {
        question: "Can the size and design be customized?",
        answer: "Yes. Dimensions, layout, decorative details, finish, and mounting can be reviewed for the property.",
      },
      {
        question: "Do you build mailbox clusters?",
        answer:
          "Yes. Residential and commercial-style clusters can be reviewed based on quantity, access, mounting, and delivery or installation needs.",
      },
      {
        question: "What is needed to quote a planter box?",
        answer:
          "Provide length, width, height, quantity, placement photos, finish preference, and whether installation is part of the request.",
      },
    ],
  },
]

export const servicePageBySlug = new Map(servicePages.map((service) => [service.slug, service]))
