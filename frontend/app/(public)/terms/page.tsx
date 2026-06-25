/**
 * app/(public)/terms/page.tsx
 * Terms of Service
 *
 * Changes from v1:
 *  — Section 5: concrete refund policy (48h / 3 sessions)
 *  — Section 5a: explicit GST, billing cycle, payment failure, and cancellation clause
 *  — Section 5b: plan change limitation (no mid-cycle downgrade)
 */
export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#0E0F14] text-white px-4 py-16">
      <div className="mx-auto max-w-2xl prose prose-invert">
        <h1>Terms of Service</h1>
        <p className="text-white/50 text-sm">Last updated: June 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using Vachix (&ldquo;the Service&rdquo;), you agree to be bound by these
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
          Paid plans are billed in advance as one-time monthly payments. All payments
          are processed securely via Razorpay. Your plan does not auto-renew — you
          choose to repurchase at the end of each billing period.
        </p>

        <h3>5a. Refund Policy</h3>
        <p>
          We offer a full refund if you request it within <strong>48 hours of
          purchase</strong>, provided you have used <strong>fewer than 3 practice
          sessions</strong> in that billing period. No refund is available after 48
          hours or after 3 sessions have been used, whichever comes first.
        </p>
        <p>
          To request a refund, email{' '}
          <a href="mailto:support@vachix.in?subject=Refund%20Request" className="text-[#4F8EF7]">
            support@vachix.in
          </a>{' '}
          with your registered email address and Razorpay order ID (visible in your
          payment confirmation email). We will process eligible refunds within 5–7
          business days.
        </p>

        <h3>5b. GST and Billing</h3>
        <p>
          All prices shown on the Vachix website are exclusive of Goods and Services
          Tax (GST). An additional 18% GST is charged at checkout as required under
          Indian tax law. The GST-inclusive amount will be shown clearly before you
          confirm payment.
        </p>
        <p>
          Each plan is valid for 30 days from the date of purchase. Since payments are
          one-time (not automatically recurring), your access simply ends at the period
          expiry date if you do not repurchase. You will receive an email reminder
          before your period expires.
        </p>
        <p>
          If a payment fails at checkout, no charge is made and your plan is not
          activated. Please retry or contact{' '}
          <a href="mailto:support@vachix.in" className="text-[#4F8EF7]">
            support@vachix.in
          </a>{' '}
          if the issue persists.
        </p>

        <h3>5c. Plan Changes</h3>
        <p>
          Mid-cycle plan changes (for example, switching from Pro to Starter before
          your current period ends) are not currently supported. To change your plan,
          allow your current subscription to expire, then purchase the new plan. Your
          access at the current plan level continues until the end of your paid period.
          Contact{' '}
          <a href="mailto:support@vachix.in" className="text-[#4F8EF7]">
            support@vachix.in
          </a>{' '}
          if you need help with a plan change.
        </p>

        <h2>6. Intellectual Property</h2>
        <p>
          All content, branding, and AI models provided by Vachix remain our
          exclusive property. Your practice session data belongs to you.
        </p>

        <h2>7. Disclaimers</h2>
        <p>
          The Service is provided &ldquo;as is.&rdquo; We do not guarantee interview success or
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
          after changes constitutes acceptance of the revised terms. We will notify
          registered users by email of material changes at least 14 days before they
          take effect.
        </p>

        <h2>10. Contact</h2>
        <p>
          For questions about these terms, email us at{' '}
          <a href="mailto:support@vachix.in" className="text-[#4F8EF7]">
            support@vachix.in
          </a>
          .
        </p>
      </div>
    </main>
  );
}
