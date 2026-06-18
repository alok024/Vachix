/**
 * app/(public)/privacy/page.tsx
 * Static Privacy Policy
 */
export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#0E0F14] text-white px-4 py-16">
      <div className="mx-auto max-w-2xl prose prose-invert">
        <h1>Privacy Policy</h1>
        <p className="text-white/50 text-sm">Last updated: June 2026</p>

        <h2>1. What We Collect</h2>
        <p>When you use Vachix, we collect:</p>
        <ul>
          <li><strong>Account data:</strong> email address, name, and hashed password</li>
          <li><strong>Session data:</strong> interview practice transcripts, scores, and feedback</li>
          <li><strong>Usage data:</strong> features used, session counts, and performance trends</li>
          <li><strong>Payment data:</strong> order IDs and plan status (card details are handled
            exclusively by Razorpay — we never see or store them)</li>
        </ul>

        <h2>2. How We Use Your Data</h2>
        <p>Your data is used to:</p>
        <ul>
          <li>Provide and personalise the interview coaching experience</li>
          <li>Track your progress and surface weak areas over time</li>
          <li>Process payments and manage your subscription</li>
          <li>Send transactional emails (verification, password reset, receipts)</li>
          <li>Improve the AI models and product features (aggregated and anonymised)</li>
        </ul>

        <h2>3. Data Storage</h2>
        <p>
          All data is stored on Supabase infrastructure hosted in secure data centres.
          Session transcripts are retained for as long as your account is active and
          for 90 days after deletion.
        </p>

        <h2>4. Data Sharing</h2>
        <p>We do not sell your personal data. We share it only with:</p>
        <ul>
          <li><strong>Supabase</strong> — database and authentication infrastructure</li>
          <li><strong>Razorpay</strong> — payment processing</li>
          <li><strong>Groq / OpenAI</strong> — AI inference (your messages are sent to generate
            responses; they are not used to train third-party models under our agreements)</li>
          <li><strong>Resend</strong> — transactional email delivery</li>
        </ul>

        <h2>5. Cookies</h2>
        <p>
          We use httpOnly cookies for session authentication. We do not use third-party
          advertising or tracking cookies.
        </p>

        <h2>6. Your Rights</h2>
        <p>You have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Export your session history in JSON format</li>
        </ul>
        <p>
          To exercise any of these rights, email{' '}
          <a href="mailto:support@vachix.in" className="text-[#4F8EF7]">
            support@vachix.in
          </a>.
        </p>

        <h2>7. Security</h2>
        <p>
          Passwords are hashed with bcrypt. All data in transit is encrypted via TLS.
          Access tokens are short-lived httpOnly cookies. We do not log full request
          bodies or AI conversation content in production.
        </p>

        <h2>8. Children</h2>
        <p>
          Vachix is not directed at children under 13. We do not knowingly collect
          personal data from anyone under 13.
        </p>

        <h2>9. Changes to This Policy</h2>
        <p>
          We will notify registered users by email of any material changes to this
          policy at least 14 days before they take effect.
        </p>

        <h2>10. Contact</h2>
        <p>
          Privacy questions or requests:{' '}
          <a href="mailto:support@vachix.in" className="text-[#4F8EF7]">
            support@vachix.in
          </a>
        </p>
      </div>
    </main>
  );
}
