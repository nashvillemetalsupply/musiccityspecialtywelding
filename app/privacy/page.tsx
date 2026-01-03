import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"

export default function PrivacyPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 sm:pt-28 md:pt-32 pb-16 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-12 max-w-4xl">
          <div className="prose prose-lg max-w-none">
            <h1 className="font-serif font-bold text-3xl sm:text-4xl text-secondary mb-3 sm:mb-4">
              Privacy Policy
            </h1>
            <p className="text-sm text-muted-foreground mb-10 sm:mb-12">
              Last updated: January 3, 2026
            </p>

            <div className="space-y-8 text-base text-foreground leading-relaxed">
              <p>
                Music City Specialty Welding ("we," "us," or "our") values your privacy. This Privacy Policy explains how we collect, use, and protect your information when you visit our website or contact us for services.
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
                </ul>
                <p className="mb-2 font-medium">Automatically collected information, such as:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>IP address</li>
                  <li>Browser type</li>
                  <li>Device type</li>
                  <li>Pages visited and time spent on the site</li>
                </ul>
                <p>
                  This information is collected to help us operate our website and respond to inquiries.
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
                  <li>With trusted service providers (such as email or hosting providers) who help us operate our website and communicate with customers</li>
                  <li>When required by law or to protect our legal rights</li>
                </ul>
                <p>
                  All third parties are required to keep your information confidential.
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
                  You can disable cookies through your browser settings if you prefer.
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
                  Your Choices
                </h2>
                <p className="mb-4">You may:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Request access to the personal information we have about you</li>
                  <li>Ask us to correct or delete your information</li>
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
                  <p>
                    <a href="tel:6158104910" className="text-primary hover:text-primary/80 transition-colors">
                      Phone: (615) 810-4910
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
    </>
  )
}

