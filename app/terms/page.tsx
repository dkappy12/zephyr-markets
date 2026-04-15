import Link from "next/link";

export default function TermsPage() {
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
        <h1 className="mt-3 font-serif text-4xl text-ink">Terms of Service</h1>
        <p className="mt-2 text-sm text-ink-light">
          Last updated: 14 April 2026 · Version 1.0
        </p>
        <div className="mt-12 space-y-10">
          <div>
            <h2 className="font-serif text-xl text-ink">
              1. Introduction and Acceptance
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                These Terms of Service (&quot;Terms&quot;) govern your access to and use of
                the Zephyr Markets platform, available at zephyr.markets (the
                &quot;Platform&quot;), operated by Zephyr Markets Ltd (&quot;Zephyr
                Markets&quot;, &quot;we&quot;, &quot;us&quot;, &quot;our&quot;).
              </p>
              <p>
                By registering for an account or accessing the Platform, you confirm that
                you have read, understood, and agree to be bound by these Terms and our
                Privacy Policy, which is incorporated herein by reference. If you do not
                agree to these Terms, you must not use the Platform.
              </p>
              <p>
                These Terms constitute a legally binding agreement between you and Zephyr
                Markets Ltd. If you are accessing the Platform on behalf of a company or
                other legal entity, you represent that you have authority to bind that
                entity to these Terms, in which case &quot;you&quot; refers to that entity.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">2. Definitions</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>In these Terms, the following definitions apply:</p>
              <p>
                &quot;Account&quot; means the account you register to access the Platform.
              </p>
              <p>
                &quot;Content&quot; means all data, text, analysis, scores, signals,
                briefs, and other information made available through the Platform.
              </p>
              <p>
                &quot;Intellectual Property Rights&quot; means patents, trademarks, copyright,
                database rights, trade secrets, and all other intellectual property rights,
                whether registered or unregistered.
              </p>
              <p>
                &quot;Physical Premium Score&quot; means the CCGT-anchored short-run marginal
                cost model output comparing the physically-implied GB day-ahead price
                against the prevailing N2EX market price.
              </p>
              <p>
                &quot;REMIT&quot; means Regulation on Wholesale Energy Market Integrity and
                Transparency (EU) No 1227/2011 as retained in UK law.
              </p>
              <p>
                &quot;Services&quot; means the Platform and all features, tools, and content
                accessible through it.
              </p>
              <p>
                &quot;Subscription&quot; means a paid plan (Pro or Team) providing access to
                enhanced features.
              </p>
              <p>
                &quot;User&quot; means any individual who registers for an Account.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">3. The Services</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Zephyr Markets provides a physical market intelligence platform for
                professional participants in the GB power and European gas markets. The
                Services include: a real-time Physical Premium Score based on a
                CCGT-anchored SRMC model updated every 5 minutes; a REMIT signal feed
                sourcing notices from Elexon BMRS and other authorised data providers; an
                AI-generated morning brief published at 06:00 GMT on each trading day;
                portfolio management tools including position tracking, P&amp;L attribution,
                and risk analytics; and market data feeds including N2EX day-ahead prices,
                TTF and NBP gas prices, EU storage levels, and weather forecasts.
              </p>
              <p>
                We reserve the right to modify, suspend, or discontinue any aspect of the
                Services at any time, with reasonable notice where practicable. We will not
                be liable to you or any third party for any modification, suspension, or
                discontinuation of the Services.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">
              4. Not Financial Advice - Important Disclaimer
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                The Services are provided for informational and analytical purposes only.
                Nothing on the Platform constitutes financial advice, investment advice,
                trading advice, or a recommendation to buy, sell, or hold any financial
                instrument, commodity, or energy product.
              </p>
              <p>
                The Physical Premium Score, REMIT signal feed, morning brief, portfolio
                attribution, and all other Content produced by the Platform are analytical
                tools designed to assist professional market participants in their own
                independent analysis. They are not trading signals and should not be treated
                as such.
              </p>
              <p>
                Zephyr Markets is not authorised or regulated by the Financial Conduct
                Authority (&quot;FCA&quot;) or any other financial regulatory authority. The
                Platform does not constitute a regulated activity under the Financial
                Services and Markets Act 2000 (&quot;FSMA&quot;). If you require regulated
                financial advice, you should consult an appropriately authorised firm.
              </p>
              <p>
                Energy markets are subject to significant volatility, regulatory change, and
                physical constraints. Past model performance is not indicative of future
                accuracy. You should independently verify all data and analysis before
                making any trading or investment decision.
              </p>
              <p>
                You acknowledge that you are a professional market participant with
                sufficient knowledge and experience to evaluate the analytical tools
                provided and to make your own independent trading decisions. You accept sole
                responsibility for all trading decisions made in reliance on or with
                reference to the Platform.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">5. Registration and Accounts</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                To access the Services you must register for an Account. You agree to
                provide accurate, current, and complete information during registration and
                to update such information as necessary.
              </p>
              <p>
                You must be at least 18 years of age to register for an Account. By
                registering, you represent and warrant that you are at least 18 years old.
              </p>
              <p>
                You are responsible for maintaining the confidentiality of your Account
                credentials and for all activity that occurs under your Account. You must
                notify us immediately at contact@zephyr.markets if you suspect any
                unauthorised access to or use of your Account.
              </p>
              <p>
                You may not create an Account on behalf of another person without their
                express authorisation, or create multiple Accounts for the purpose of
                circumventing access restrictions or usage limits.
              </p>
              <p>
                We reserve the right to refuse registration, suspend, or terminate any
                Account at our discretion, including where we reasonably believe that these
                Terms have been violated.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">
              6. Subscriptions, Fees, and Payment
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Certain features of the Platform are available only to paid Subscribers. The
                current subscription tiers, features, and pricing are set out on the
                Platform&apos;s pricing page and may be updated from time to time.
              </p>
              <p>
                All fees are stated in pounds sterling (GBP) and are exclusive of any
                applicable taxes unless otherwise stated. You are responsible for any taxes
                applicable to your use of the Services.
              </p>
              <p>
                When paid subscriptions are enabled, payment processing will be handled
                by Stripe Inc. By subscribing, you agree to Stripe&apos;s terms of
                service. We do not store your payment card details.
              </p>
              <p>
                Subscriptions are billed monthly or annually in advance, as selected at the
                time of purchase. Subscriptions automatically renew at the end of each
                billing period unless cancelled. You may cancel your Subscription at any time
                through your Account settings; cancellation will take effect at the end of
                the current billing period and no refunds will be issued for the unused
                portion of a billing period except where required by applicable law.
              </p>
              <p>
                We reserve the right to change Subscription fees on not less than 30
                days&apos; written notice. Continued use of the Services after a fee change
                takes effect constitutes acceptance of the new fees.
              </p>
              <p>
                If any payment is not received when due, we may suspend access to paid
                features until payment is received.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">7. Acceptable Use</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                You agree to use the Services only for lawful purposes and in accordance
                with these Terms. You must not: use the Platform in any way that violates
                any applicable local, national, or international law or regulation,
                including without limitation the UK Market Abuse Regulation (UK MAR), REMIT,
                or the Financial Services and Markets Act 2000; use the Platform to engage
                in, facilitate, or assist in market manipulation, front-running, insider
                trading, or any other form of market abuse as defined under applicable law;
                resell, redistribute, sublicense, or otherwise commercially exploit access
                to the Platform or any Content without our prior written consent; scrape,
                crawl, or systematically extract data from the Platform by automated means
                without our prior written consent; reverse-engineer, decompile, or attempt
                to derive the source code of any part of the Platform; introduce viruses or
                other malicious code into the Platform; attempt to gain unauthorised access
                to any part of the Platform or its connected systems; or impersonate any
                person or entity.
              </p>
              <p>
                We reserve the right to investigate and take appropriate action in response
                to any suspected violation of this clause, including suspension or
                termination of your Account and referral to relevant authorities.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">8. Data Accuracy and Availability</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                We source data from third-party providers including Elexon BMRS, EEX, Nord
                Pool, GIE AGSI, Open-Meteo, Sheffield Solar PV_Live, and others. While we
                make reasonable efforts to ensure the accuracy, completeness, and timeliness
                of data, we do not warrant that any data or Content on the Platform is
                accurate, complete, or up to date.
              </p>
              <p>
                The Physical Premium Score is based on a structural model with periodically
                recalibrated coefficients. The model&apos;s implied price may differ
                materially from actual market prices, particularly during unusual system
                conditions, scarcity events, or structural market shifts. The model is not a
                price forecast.
              </p>
              <p>
                We target Platform availability of 99% but do not guarantee uninterrupted
                access. Scheduled and unscheduled maintenance may result in temporary
                unavailability.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">9. Intellectual Property</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                All Intellectual Property Rights in the Platform, its code, design, data
                structures, model architecture, and original Content are owned by or licensed
                to Zephyr Markets Ltd. Nothing in these Terms grants you any rights in or to
                our Intellectual Property Rights except as expressly set out herein.
              </p>
              <p>
                Subject to your compliance with these Terms and payment of any applicable
                fees, we grant you a limited, non-exclusive, non-transferable, revocable
                licence to access and use the Platform and its Content for your own
                internal business purposes during the term of your Account.
              </p>
              <p>
                The morning brief and other AI-generated Content is provided under this
                licence for your personal and internal business use only. You may not
                reproduce, distribute, publish, or transmit such Content to third parties
                without our prior written consent.
              </p>
              <p>
                You retain ownership of all data you input into the Platform, including your
                portfolio positions and trade data. You grant us a limited licence to
                process this data solely for the purpose of providing the Services to you.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">10. Confidentiality</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Each party may have access to information that is confidential to the other
                party. Each party agrees to keep the other&apos;s confidential information
                strictly confidential and not to disclose it to any third party without
                prior written consent, except as required by law or regulation.
              </p>
              <p>
                We will keep confidential all non-public information about your trading
                positions, portfolio composition, and trading activity. We will not disclose
                such information to any third party except as set out in our Privacy Policy
                or as required by law.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">11. Limitation of Liability</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Nothing in these Terms excludes or limits our liability for death or
                personal injury caused by our negligence, fraud or fraudulent
                misrepresentation, or any other liability that cannot be excluded or
                limited by applicable law.
              </p>
              <p>
                Subject to the above, we shall not be liable to you, whether in contract,
                tort (including negligence), breach of statutory duty, or otherwise, for:
                any trading losses, loss of profit, loss of revenue, or loss of business,
                whether direct or indirect, arising from your use of or reliance on the
                Platform or its Content; any indirect, consequential, special, or punitive
                loss or damage; any loss arising from interruption, suspension, or
                termination of the Services; any loss arising from inaccurate, incomplete, or
                delayed data provided by third-party data sources; or any loss arising from
                unauthorised access to your Account resulting from circumstances outside our
                reasonable control.
              </p>
              <p>
                Our total aggregate liability to you arising under or in connection with
                these Terms shall not exceed the greater of: (a) the total fees paid by you
                to us in the 3 months immediately preceding the event giving rise to the
                claim; or (b) £100.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">12. Indemnity</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                You agree to indemnify, defend, and hold harmless Zephyr Markets Ltd and its
                officers, directors, employees, and agents from and against any claims,
                liabilities, damages, losses, costs, and expenses (including reasonable
                legal fees) arising out of or in connection with: your use of or access to
                the Platform; your violation of these Terms; your violation of any
                applicable law or regulation; or any trading decision made by you in
                reliance on or with reference to the Platform.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">13. Termination</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                These Terms commence on the date you register for an Account and continue
                until terminated.
              </p>
              <p>
                You may terminate your Account at any time by contacting us at
                contact@zephyr.markets or through your Account settings.
              </p>
              <p>
                We may terminate or suspend your Account and access to the Services
                immediately and without notice if you breach any provision of these Terms;
                we are required to do so by applicable law or regulation; we reasonably
                suspect fraudulent, abusive, or illegal activity associated with your
                Account; or we decide to discontinue the Services.
              </p>
              <p>
                Upon termination, your right to access the Services ceases immediately.
                Clauses 4, 9, 10, 11, 12, 14, and 15 shall survive termination.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">14. Force Majeure</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Neither party shall be in breach of these Terms or liable for any failure or
                delay in performing obligations under these Terms to the extent that such
                failure or delay results from events, circumstances, or causes beyond their
                reasonable control, including without limitation: acts of God, pandemic,
                war, civil unrest, government action, regulatory intervention, power outages,
                internet service provider failures, or failures of third-party data
                providers.
              </p>
              <p>
                The affected party shall notify the other as soon as reasonably practicable
                and shall use reasonable endeavours to resume performance as soon as
                possible.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">15. General</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>
                Governing law and jurisdiction. These Terms and any dispute or claim arising
                out of or in connection with them shall be governed by and construed in
                accordance with the law of England and Wales. Each party irrevocably agrees
                that the courts of England and Wales shall have exclusive jurisdiction to
                settle any dispute or claim.
              </p>
              <p>
                Entire agreement. These Terms, together with the Privacy Policy, constitute
                the entire agreement between you and Zephyr Markets Ltd with respect to the
                subject matter hereof and supersede all prior agreements, representations,
                and understandings.
              </p>
              <p>
                Severability. If any provision of these Terms is held to be invalid or
                unenforceable, the remaining provisions shall continue in full force and
                effect.
              </p>
              <p>
                Waiver. No failure or delay by us in exercising any right or remedy shall
                constitute a waiver of that right or remedy.
              </p>
              <p>
                Assignment. You may not assign or transfer any of your rights or obligations
                under these Terms without our prior written consent. We may assign our
                rights and obligations to any affiliate or successor entity.
              </p>
              <p>
                Notices. All notices under these Terms shall be in writing and sent to
                contact@zephyr.markets or to the email address associated with your
                Account.
              </p>
              <p>
                Updates to these Terms. We may update these Terms from time to time. We will
                notify you of material changes by email at least 14 days before the changes
                take effect. Continued use of the Platform after the effective date
                constitutes acceptance of the revised Terms.
              </p>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-xl text-ink">16. Contact</h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-mid">
              <p>For any questions regarding these Terms, contact us at: contact@zephyr.markets</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
