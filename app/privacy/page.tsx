import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { MobileQuickActions } from "@/components/mobile-quick-actions"
import { createPublicMetadata } from "@/lib/public-metadata"
import { getShopPhone } from "@/lib/shop-contact"

export const metadata = createPublicMetadata({
  title: "Privacy Policy",
  description: "How Music City Specialty Welding collects, uses, and protects website, call, message, email, and project information.",
  canonical: "/privacy",
})

export default function PrivacyPage() {
  const shopPhone = getShopPhone()
  return (
    <>
      <Navbar />
      <main id="main-content" className="ms-site ms-legal">
        <div className="container mx-auto px-4 sm:px-6 lg:px-12 max-w-4xl">
          <div className="prose prose-lg max-w-none">
            <h1 className="font-serif font-bold text-3xl sm:text-4xl text-secondary mb-3 sm:mb-4">
              Privacy Policy
            </h1>
            <p className="text-sm text-muted-foreground mb-10 sm:mb-12">
              Last updated: August 11, 2026
            </p>

            <div className="space-y-8 text-base text-foreground leading-relaxed">
              <p>
                Music City Specialty Welding is operated by Neverlift Chassis Works, LLC ("we," "us," or "our"). We value your privacy. This policy explains how we handle information when you visit our website, call or message our shop, exchange email with us, receive a customer job page, or hire us for welding services.
              </p>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Information We Collect
                </h2>
                <p className="mb-4">
                  We may collect the following information when you use our website or contact us:
                </p>
                <p className="mb-2 font-medium">Personal information you provide, such as:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Name</li>
                  <li>Phone number</li>
                  <li>Email address</li>
                  <li>Project details or messages</li>
                  <li>Photos or files you choose to upload</li>
                  <li>Text and multimedia messages, email threads, drawings, quotes, invoices, and payment-status notices connected with your project</li>
                  <li>Call metadata and, after a spoken notice, call recordings and transcripts</li>
                </ul>
                <p className="mb-2 font-medium">Automatically collected information, such as:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>IP address</li>
                  <li>Browser type</li>
                  <li>Device type</li>
                  <li>Pages visited and time spent on the site</li>
                </ul>
                <p>
                  We also keep project status, commitments, corrections, and a receipt-backed activity history so we can answer questions accurately and avoid asking you to repeat information.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  How We Use Your Information
                </h2>
                <p className="mb-4">We use the information we collect to:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Respond to quote requests and service inquiries</li>
                  <li>Communicate with you about your project</li>
                  <li>Route and return calls from our published shop number</li>
                  <li>Transcribe project conversations, identify stated job details and commitments, and keep our work board current</li>
                  <li>Provide a private customer job page when we send you one</li>
                  <li>Match trusted invoice-payment notices to the correct job</li>
                  <li>Improve our website and services</li>
                  <li>Provide customer support</li>
                  <li>Comply with legal or regulatory requirements</li>
                </ul>
                <p>
                  We do not sell, rent, or trade your personal information.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  How We Share Information
                </h2>
                <p className="mb-4">
                  We may share your information only in the following limited situations:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>With service providers that help us host the website and database, store private project files, route calls and texts, deliver email and push notifications, transcribe audio, and assist with structured project summaries. These currently include Vercel, Neon, Twilio, Resend, Google Workspace/Gmail, Deepgram, and our configured AI model providers.</li>
                  <li>When required by law or to protect our legal rights</li>
                </ul>
                <p>
                  We limit provider access to what is needed for the service and use contractual and account-security controls appropriate to the information involved.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Calls, Messages, and Transcription
                </h2>
                <p className="mb-4">
                  Calls placed through our published shop number may be recorded and transcribed for project documentation, quality, follow-up, and promise tracking. We provide a spoken recording notice before connecting a recorded call. If you do not want a call recorded, tell us and use another available contact method.
                </p>
                <p>
                  Texts and multimedia messages sent to the shop number, including photos, may be copied into the applicable work order. Automated tools may extract proposed facts or commitments, but our crew remains responsible for the job record and can correct the source-backed information.
                </p>
                <p className="mt-4">
                  If you optionally agree, you may receive recurring customer-care and job-update text messages from Music City Specialty Welding about your request. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is optional and is not a condition of purchase. We keep an append-only record of when and how permission was given, along with later STOP, START, or HELP requests. We do not sell or share mobile opt-in information for third-party marketing.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Private Customer Job Pages
                </h2>
                <p>
                  We may send you a private link showing selected job status, promised dates, shared progress photos, quote or invoice information, and a way to contact the shop. The link works like a bearer key: anyone you share it with may be able to view that job page. These pages are excluded from our advertising analytics, can be revoked, and close after the configured post-completion period.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Cookies & Analytics
                </h2>
                <p className="mb-4">
                  Our website may use cookies or similar technologies to:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Understand how visitors use our site</li>
                  <li>Improve performance and usability</li>
                </ul>
                <p>
                  We use Vercel Analytics and Google Analytics on our public marketing pages to understand website usage, and Google advertising technology to measure whether an ad leads to a successful quote request. Internal shop pages and private customer job pages are excluded from these analytics. These providers may process device, browser, page, and conversion-event information under their own privacy terms. Learn more about{" "}
                  <a
                    href="https://policies.google.com/technologies/partner-sites"
                    className="text-primary hover:text-primary/80 transition-colors"
                    target="_blank"
                    rel="noreferrer"
                  >
                    how Google uses information from sites that use its services
                  </a>
                  . You can limit cookies through your browser settings and Google advertising controls.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Data Security
                </h2>
                <p>
                  We take reasonable steps to protect your information from unauthorized access, disclosure, or misuse. However, no method of transmission over the internet is 100% secure.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Retention
                </h2>
                <p>
                  We keep project and communication records for as long as reasonably needed to perform the work, support repeat customers, document commitments, maintain financial and legal records, and resolve disputes. Some receipt and provenance records are intentionally append-only so later corrections do not erase what the shop relied on at the time. Private job-page links expire or may be revoked; provider backups and legally required records may remain for a limited period after a request.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Your Choices
                </h2>
                <p className="mb-4">You may:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Request access to the personal information we have about you</li>
                  <li>Ask us to correct or delete eligible information</li>
                  <li>Opt out of future communications at any time</li>
                </ul>
                <p>
                  To do so, contact us using the information below.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Third-Party Links
                </h2>
                <p>
                  Our website may contain links to third-party websites. We are not responsible for the privacy practices of those sites.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Children's Privacy
                </h2>
                <p>
                  Our services are not directed to individuals under the age of 13, and we do not knowingly collect information from children.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Changes to This Policy
                </h2>
                <p>
                  We may update this Privacy Policy from time to time. Any changes will be posted on this page with an updated revision date.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Contact Us
                </h2>
                <p className="mb-4">
                  If you have questions about this Privacy Policy or how we handle your information, contact us at:
                </p>
                <div className="bg-muted/50 rounded-lg p-6 space-y-2">
                  <p className="font-semibold text-secondary">Music City Specialty Welding</p>
                  <p className="text-muted-foreground">Operated by Neverlift Chassis Works, LLC</p>
                  <p>
                    <a href={shopPhone.href} className="text-primary hover:text-primary/80 transition-colors">
                      Phone: {shopPhone.display}
                    </a>
                  </p>
                  <p>
                    <a href="mailto:sales@musiccityspecialtywelding.com" className="text-primary hover:text-primary/80 transition-colors break-all">
                      Email: sales@musiccityspecialtywelding.com
                    </a>
                  </p>
                  <p className="text-muted-foreground">
                    Location: Lebanon, TN
                  </p>
                </div>
              </section>
            </div>
          </div>
        </div>
      </main>
      <Footer />
      <MobileQuickActions quoteHref="/#contact" phoneHref={shopPhone.href} />
    </>
  )
}

