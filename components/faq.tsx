const questions = [
  {
    question: "Do you come to the job site?",
    answer:
      "Yes. Mobile welding is available for equipment, facilities, trailers, and other work that is practical to repair on-site. Travel availability depends on the project location, scope, and schedule.",
  },
  {
    question: "What should I send for an accurate quote?",
    answer:
      "Include the project location, what is broken or being built, approximate dimensions, the material if known, your timing, and clear photos. Those details help us determine the right next step quickly.",
  },
  {
    question: "What areas do you serve?",
    answer:
      "We are based in Lebanon and serve Nashville and surrounding Middle Tennessee communities. Larger or specialized projects may be scheduled farther away; call to confirm availability for your location.",
  },
  {
    question: "Do you take urgent repair work?",
    answer:
      "Yes, when scheduling and travel allow. Call (615) 810-4910 for an urgent request so we can confirm current availability instead of relying on the online form alone.",
  },
  {
    question: "Can you work from drawings or specifications?",
    answer:
      "Yes. Specialty and architectural fabrication can be reviewed from drawings, dimensions, tolerances, and installation requirements before the work is scheduled.",
  },
]

export function FAQ() {
  return (
    <section id="faq" className="border-y border-border bg-muted/30 py-16 sm:py-20 lg:py-24">
      <div className="container mx-auto px-4 sm:px-6 lg:px-12">
        <div className="mx-auto max-w-4xl">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.2em] text-primary">Before you request a quote</p>
          <h2 className="font-serif text-3xl font-bold text-secondary sm:text-4xl">Welding service questions, answered clearly</h2>
          <div className="mt-10 divide-y divide-border rounded-xl border border-border bg-background px-5 sm:px-8">
            {questions.map((item) => (
              <details key={item.question} className="group py-5">
                <summary className="cursor-pointer list-none pr-8 font-semibold text-secondary marker:content-none">
                  {item.question}
                </summary>
                <p className="mt-3 max-w-3xl leading-relaxed text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
