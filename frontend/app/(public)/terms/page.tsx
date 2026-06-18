/**
 * app/(public)/terms/page.tsx
 * Static Terms of Service
 */
export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0E0F14] text-white px-4 py-16">
      <div className="mx-auto max-w-2xl prose prose-invert">
        <h1>Terms of Service</h1>
        <p className="text-white/50 text-sm">Last updated: June 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using Vachix ("the Service"), you agree to be bound by these
          Terms of Service. If you do not agree, do not use the Service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          Vachix provides AI-powered interview coaching and English communication
          practice. The Service is intended for personal, non-commercial use unless you
          have entered into a separate B2B agreement with us.
        </p>

        <h2>3. User Accounts</h2>
        <p>
          You are responsible for maintaining the confidentiality of your account
          credentials and for all activity that occurs under your account. You must
          provide accurate information when registering.
        </p>

        <h2>4. Acceptable Use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for any unlawful purpose</li>
          <li>Attempt to reverse-engineer, scrape, or abuse the AI systems</li>
          <li>Share your account with others</li>
          <li>Submit content that is harmful, offensive, or misleading</li>
        </ul>

        <h2>5. Subscriptions and Payments</h2>
        <p>
          Paid plans are billed in advance. All payments are processed securely via
          Razorpay. Refunds are handled on a case-by-case basis — contact
          support within 7 days of purchase if you have an issue.
        </p>

        <h2>6. Intellectual Property</h2>
        <p>
          All content, branding, and AI models provided by Vachix remain our
          exclusive property. Your practice session data belongs to you.
        </p>

        <h2>7. Disclaimers</h2>
        <p>
          The Service is provided "as is." We do not guarantee interview success or
          employment outcomes. AI-generated feedback is for practice purposes only.
        </p>

        <h2>8. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, Vachix shall not be liable for
          indirect, incidental, or consequential damages arising from your use of the
          Service.
        </p>

        <h2>9. Changes to Terms</h2>
        <p>
          We may update these terms from time to time. Continued use of the Service
          after changes constitutes acceptance of the revised terms.
        </p>

        <h2>10. Contact</h2>
        <p>
          For questions about these terms, email us at{' '}
          <a href="mailto:support@vachix.in" className="text-[#4F8EF7]">
            support@vachix.in
          </a>.
        </p>
      </div>
    </main>
  );
}
