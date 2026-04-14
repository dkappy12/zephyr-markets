import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-ivory">
      <nav className="border-b-[0.5px] border-ivory-border px-6 py-4">
        <Link href="/" className="font-serif text-xl text-ink">
          Zephyr
        </Link>
      </nav>
      <div className="mx-auto max-w-2xl px-6 py-16 pb-24">
        <p className="font-sans text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-light">
          Legal
        </p>
        <h1 className="mt-3 font-serif text-4xl text-ink">Privacy Policy</h1>
        <p className="mt-2 text-sm text-ink-light">
          Last updated: 14 April 2026 · Version 1.0
        </p>
        <div className="mt-12 space-y-10">
          <div>
            <h2 className="font-serif text-xl text-ink">
              1. Introduction and Identity of the Controller
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                This Privacy Policy explains how Zephyr Markets Ltd (&quot;Zephyr
                Markets&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;)
                collects, uses, stores, and shares personal data when you access or
                use the Zephyr Markets platform, available at zephyr.markets (the
                &quot;Platform&quot;).
              </p>
              <p>
                Zephyr Markets Ltd is the data controller for the purposes of the UK
                General Data Protection Regulation (&quot;UK GDPR&quot;) and the Data
                Protection Act 2018. If you have questions about how we process your
                personal data, contact us at: privacy@zephyr.markets.
              </p>
              <p>
                This Policy applies to all users of the Platform, including individuals
                who register for a free account, Pro subscribers, and Team subscribers.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">
              2. Data We Collect and the Lawful Basis for Processing
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Account and identity data. When you register, we collect your email address
                and a hashed password. Lawful basis: performance of a contract (Article
                6(1)(b) UK GDPR) - this data is necessary to provide you with access to the
                Platform.
              </p>
              <p>
                Portfolio and position data. When you use the Portfolio features, we collect
                trade positions, instruments, directions, sizes, entry prices, and any
                other data you input manually or import via CSV. Lawful basis: performance
                of a contract (Article 6(1)(b)) - this data is necessary to provide the
                attribution, risk, and optimisation features you have requested.
              </p>
              <p>
                Usage and technical data. We collect log data including IP address, browser
                type, pages visited, features used, session duration, and timestamps. Lawful
                basis: legitimate interests (Article 6(1)(f)) - we process this data to
                maintain platform security, diagnose technical issues, and improve the
                service.
              </p>
              <p>
                Communication data. If you contact us by email or through the Platform, we
                retain records of that correspondence. Lawful basis: legitimate interests
                (Article 6(1)(f)) - to manage our relationship with you and respond to your
                enquiries.
              </p>
              <p>
                Morning brief personalisation data. We use your portfolio positions and
                current physical market conditions to generate a personalised morning brief
                via the Anthropic API. No personally identifiable information beyond your
                position data is sent to Anthropic. Lawful basis: performance of a contract
                (Article 6(1)(b)).
              </p>
              <p>
                We do not collect special category data as defined under Article 9 UK GDPR.
                We do not collect payment card details directly - if and when payment
                processing is activated, this will be handled entirely by Stripe and
                subject to Stripe&apos;s own privacy policy.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">3. How We Use Your Data</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                We use your data for the following purposes: to provide, maintain, and
                improve the Platform and its features; to send you the morning brief and
                any other platform notifications you have subscribed to; to personalise
                your experience, including generating portfolio-specific attribution and
                brief content; to respond to support enquiries and manage our relationship
                with you; to detect, investigate, and prevent fraudulent or abusive
                activity; to comply with our legal obligations; and to enforce our Terms of
                Service.
              </p>
              <p>
                We will not use your data for automated decision-making that produces legal
                or similarly significant effects without your explicit consent.
              </p>
              <p>
                We do not sell your personal data to third parties under any circumstances.
              </p>
              <p>
                We do not use your personal data, including your position data or trading
                activity, to train artificial intelligence or machine learning models
                without your explicit written consent.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">
              4. Data Sharing and Third-Party Processors
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                We share your data with the following third-party processors, each of whom
                processes data on our behalf under appropriate data processing agreements:
                Supabase Inc. (database hosting and authentication, EU/AWS eu-west-1,
                protected by Standard Contractual Clauses); Anthropic PBC (AI-generated
                brief content, USA, Standard Contractual Clauses); Vercel Inc. (platform
                hosting and deployment, USA/EU, Standard Contractual Clauses); Railway
                Corp. (data pipeline hosting, USA, Standard Contractual Clauses).
              </p>
              <p>
                We do not share your data with any other third parties except where
                required by law, regulation, or court order, or where necessary to protect
                the rights, property, or safety of Zephyr Markets, our users, or others.
              </p>
              <p>
                If we are required by law to disclose your data, we will notify you as soon
                as reasonably practicable unless prohibited from doing so by law.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">5. International Data Transfers</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Some of our third-party processors are located outside the UK. Where we
                transfer personal data outside the UK, we ensure that appropriate
                safeguards are in place in accordance with Chapter V UK GDPR, including
                Standard Contractual Clauses approved by the Information Commissioner&apos;s
                Office (&quot;ICO&quot;) or an adequacy decision.
              </p>
              <p>
                You may request a copy of the relevant transfer safeguards by contacting
                privacy@zephyr.markets.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">6. Data Retention</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                We retain your personal data for as long as is necessary for the purposes
                set out in this Policy, subject to the following specific retention periods:
              </p>
              <p>
                Account data (email address, hashed password): retained for the duration of
                your account and deleted within 30 days of account closure, unless we are
                required to retain it for longer by law.
              </p>
              <p>
                Portfolio and position data: retained for the duration of your account and
                deleted within 30 days of account closure.
              </p>
              <p>
                Usage and log data: retained for 12 months from the date of collection.
              </p>
              <p>
                Communication data: retained for 3 years from the date of last contact.
              </p>
              <p>
                Prediction and accuracy logs (anonymised model performance data): retained
                indefinitely in anonymised form for model improvement purposes.
              </p>
              <p>
                Where we are required to retain data for longer periods by applicable law
                or regulation, we will do so and notify you accordingly.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">7. Security</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                We implement appropriate technical and organisational measures to protect
                your personal data against unauthorised access, loss, destruction, or
                alteration. These include encrypted data storage, TLS encryption in transit,
                access controls, and regular security reviews.
              </p>
              <p>
                No method of electronic transmission or storage is completely secure.
                While we take reasonable precautions, we cannot guarantee absolute security
                and are not liable for unauthorised access resulting from circumstances
                outside our reasonable control.
              </p>
              <p>
                In the event of a personal data breach that is likely to result in a risk to
                your rights and freedoms, we will notify the ICO within 72 hours of becoming
                aware and will notify affected individuals without undue delay where
                required.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">8. Cookies</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                We use session cookies that are strictly necessary for authentication and
                platform functionality. These are deleted when you close your browser. No
                consent is required for these cookies under the Privacy and Electronic
                Communications Regulations 2003 (PECR).
              </p>
              <p>
                We do not use analytics cookies, advertising cookies, or any tracking
                technologies that monitor your behaviour across third-party websites.
              </p>
              <p>
                You can control cookies through your browser settings. Disabling session
                cookies will prevent you from logging in to the Platform.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">9. Your Rights Under UK GDPR</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Subject to applicable law, you have the following rights regarding your
                personal data: right of access (to obtain a copy of your personal data and
                information about how it is processed); right to rectification (to have
                inaccurate personal data corrected); right to erasure (to request deletion of
                your personal data where it is no longer necessary, where you withdraw
                consent, or where processing is unlawful); right to restriction (to
                request that we restrict processing of your data in certain circumstances);
                right to data portability (to receive your personal data in a structured,
                commonly used, machine-readable format); right to object (to object to
                processing based on legitimate interests, including for direct marketing);
                and rights related to automated decision-making.
              </p>
              <p>
                To exercise any of these rights, contact us at privacy@zephyr.markets. We
                will respond within one calendar month. We may ask you to verify your
                identity before processing your request.
              </p>
              <p>
                If you are not satisfied with our response, you have the right to lodge a
                complaint with the Information Commissioner&apos;s Office (ICO) at ico.org.uk
                or by calling 0303 123 1113.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">10. Children</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                The Platform is not directed at individuals under the age of 18. We do not
                knowingly collect personal data from children. If you believe we have
                inadvertently collected data from a child, please contact us immediately at
                privacy@zephyr.markets.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">11. Changes to This Policy</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                We may update this Privacy Policy from time to time. We will notify you of
                material changes by email to the address associated with your account at
                least 14 days before the changes take effect. The updated Policy will be
                posted at zephyr.markets/privacy with a revised last updated date.
              </p>
              <p>
                Continued use of the Platform after the effective date of any changes
                constitutes your acceptance of the revised Policy.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">12. Contact</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                For any questions, concerns, or requests relating to this Privacy Policy or
                our data practices, contact us at: privacy@zephyr.markets
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
