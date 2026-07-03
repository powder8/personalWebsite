/**
 * Privacy policy — required by Whoop developer registration.
 * URL registered: https://throughline.badoo.net/privacy
 */
export const metadata = { title: 'Privacy Policy — Throughline' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-slate-200">
      <h1 className="mb-2 text-2xl font-bold text-white">Privacy Policy</h1>
      <p className="mb-8 text-sm text-slate-400">Last updated: July 3, 2026</p>

      <Section title="What is Throughline?">
        Throughline is a personal endurance coaching application. It is used by a small, closed group of
        athletes and their coach. It is not a public product and does not solicit users.
      </Section>

      <Section title="Data we collect">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>Training activity data (pace, distance, heart rate) imported from connected wearables and apps such as Strava and Whoop.</li>
          <li>Health metrics from Whoop: HRV, resting heart rate, sleep stages, recovery score, respiratory rate, and skin temperature.</li>
          <li>Self-reported check-in data: subjective soreness, energy, and perceived effort.</li>
          <li>Profile information: name, email address, and race goals you enter manually.</li>
        </ul>
      </Section>

      <Section title="How we use your data">
        All data collected is used exclusively to generate training plans, coaching insights, and readiness
        assessments for you. Data is never sold, shared with third parties, or used for advertising.
      </Section>

      <Section title="Data storage">
        Data is stored in a private PostgreSQL database hosted on Neon (neon.tech), a SOC 2-compliant
        cloud provider. Access is restricted to the application and its administrator.
      </Section>

      <Section title="Third-party integrations">
        When you connect Whoop or Strava, we receive data from their APIs under OAuth 2.0. We store your
        access tokens encrypted at rest. You can revoke access at any time from within your Whoop or Strava
        account settings, or by disconnecting from the Throughline settings page.
      </Section>

      <Section title="Data retention">
        Your data is retained for as long as your account is active. You may request deletion at any time
        by contacting the administrator.
      </Section>

      <Section title="Contact">
        For any privacy-related questions, contact:{' '}
        <a href="mailto:powder8@gmail.com" className="text-sky-400 underline hover:text-sky-300">
          powder8@gmail.com
        </a>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-2 text-base font-semibold text-white">{title}</h2>
      <div className="text-sm leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}
