import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"

export default function TermsPage() {
  return (
    <>
      <Navbar />
      <main className="min-h-screen pt-24 sm:pt-28 md:pt-32 pb-16 bg-background">
        <div className="container mx-auto px-4 sm:px-6 lg:px-12 max-w-4xl">
          <div className="prose prose-lg max-w-none">
            <h1 className="font-serif font-bold text-3xl sm:text-4xl text-secondary mb-3 sm:mb-4">
              Terms of Service
            </h1>
            <p className="text-sm text-muted-foreground mb-10 sm:mb-12">
              Last updated: January 3, 2026
            </p>

            <div className="space-y-8 text-base text-foreground leading-relaxed">
              <p>
                By accessing or using this website, you agree to be bound by these Terms of Service. If you do not agree, please do not use the site.
              </p>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Use of This Website
                </h2>
                <p className="mb-4">
                  This website is provided for informational purposes and to allow users to request quotes or contact Music City Specialty Welding for services.
                </p>
                <p className="mb-4">You agree to use this site only for lawful purposes and not to:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Submit false or misleading information</li>
                  <li>Attempt to disrupt or interfere with the site's operation</li>
                  <li>Upload malicious files or content</li>
                  <li>Use the site in a way that violates applicable laws or regulations</li>
                </ul>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Service Requests & Quotes
                </h2>
                <ul className="list-disc list-inside space-y-2 ml-4 mb-4">
                  <li>Submitting a request for a quote does not guarantee service availability or pricing</li>
                  <li>All quotes are non-binding until confirmed in writing</li>
                  <li>Final pricing, scope, and timelines are determined after project review</li>
                  <li>Emergency service availability is subject to technician availability and conditions</li>
                </ul>
                <p>
                  We reserve the right to refuse service at our discretion.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  No Warranties on Website Content
                </h2>
                <p className="mb-4">
                  While we strive to keep information accurate and up to date, this website is provided "as is" and "as available."
                </p>
                <p className="mb-4">We make no warranties regarding:</p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Accuracy or completeness of content</li>
                  <li>Availability or uninterrupted access</li>
                  <li>Suitability of information for a specific purpose</li>
                </ul>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Limitation of Liability
                </h2>
                <p className="mb-4">
                  To the fullest extent permitted by law, Music City Specialty Welding shall not be liable for:
                </p>
                <ul className="list-disc list-inside space-y-1 ml-4 mb-4">
                  <li>Any indirect, incidental, or consequential damages</li>
                  <li>Loss of data, business, or profits</li>
                  <li>Issues arising from reliance on website content</li>
                </ul>
                <p>
                  Use of this website is at your own risk.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Intellectual Property
                </h2>
                <p>
                  All content on this website—including text, images, logos, and branding—is the property of Music City Specialty Welding and may not be copied, reproduced, or used without written permission.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Third-Party Links
                </h2>
                <p>
                  This website may contain links to third-party websites. We are not responsible for the content, policies, or practices of those sites.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Privacy
                </h2>
                <p>
                  Your use of this website is also governed by our <a href="/privacy" className="text-primary hover:text-primary/80 transition-colors underline">Privacy Policy</a>, which explains how we collect and use personal information.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Changes to These Terms
                </h2>
                <p>
                  We may update these Terms of Service at any time. Changes will be posted on this page with an updated revision date. Continued use of the website constitutes acceptance of the updated terms.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Governing Law
                </h2>
                <p>
                  These Terms are governed by the laws of the State of Tennessee, without regard to conflict-of-law principles.
                </p>
              </section>

              <section>
                <h2 className="font-serif font-semibold text-2xl text-secondary mt-12 mb-5">
                  Contact Information
                </h2>
                <p className="mb-4">
                  If you have questions about these Terms of Service, contact us at:
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

