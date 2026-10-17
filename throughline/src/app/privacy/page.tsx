/**
 * Privacy policy. Public (registered with Whoop, Strava, and Garmin as the
 * app's policy URL: https://throughline.badoo.net/privacy). Keep it in step
 * with the code: every processor and data type named here is one the app
 * actually uses.
 */
export const metadata = { title: 'Privacy Policy. Throughline' };

const UPDATED = 'October 17, 2026';
const CONTACT = 'powder8@gmail.com';

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl py-10 text-slate-600">
      <h1 className="text-3xl font-semibold tracking-tight text-white">Privacy policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: {UPDATED}</p>

      <p className="mt-8 text-[15px] leading-relaxed">
        Throughline is an AI endurance coach. This policy explains what data we collect, why, who processes it for us,
        and how you control it. In this policy, &ldquo;we&rdquo; means Throughline and its operator, and &ldquo;you&rdquo;
        means a person who uses the service.
      </p>

      <Section title="Data we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <b className="text-white">Account data:</b> your name and email address, from Google sign-in or the email
            address you enter.
          </li>
          <li>
            <b className="text-white">Profile and goals:</b> races, target times, training availability, units, and,
            if you add them, your date of birth and sex. We use date of birth and sex only to compare health metrics
            with age and sex norms.
          </li>
          <li>
            <b className="text-white">Training data:</b> workouts from the services you connect (Strava, Whoop, Garmin,
            and Apple Health or Health Connect through our mobile app), including sport, time, distance, pace, speed,
            heart rate, power, cadence, elevation, and route.
          </li>
          <li>
            <b className="text-white">Health data:</b> resting heart rate, heart rate variability, sleep, recovery
            scores, steps, VO2max, weight, and body composition, from the services you connect.
          </li>
          <li>
            <b className="text-white">What you tell us:</b> daily check-ins (energy, soreness, sleep quality, stress),
            injury reports, workout feedback, messages you send the coach chat, and product feedback.
          </li>
          <li>
            <b className="text-white">Technical data:</b> your device&apos;s timezone (so &ldquo;today&rdquo; is your
            today) and the sign-in cookie that keeps you signed in.
          </li>
        </ul>
        <p className="mt-3">
          Health data is sensitive. We collect it only when you connect a service or enter it yourself, and we use it
          only to coach you.
        </p>
      </Section>

      <Section title="How we use your data">
        <ul className="list-disc space-y-2 pl-5">
          <li>Build and adapt your training plan.</li>
          <li>Estimate your fitness, readiness, and progress toward your goal.</li>
          <li>Answer your questions in the coach chat and write session debriefs.</li>
          <li>Send the reminders and updates you turn on.</li>
          <li>Keep the service secure and fix problems.</li>
        </ul>
        <p className="mt-3">
          We don&apos;t sell your data, use it for advertising, or share it with data brokers. We don&apos;t use it to
          train AI models.
        </p>
      </Section>

      <Section title="Service providers that process your data">
        <p>We use these providers to run the service. Each one receives only the data it needs for its task.</p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>
            <b className="text-white">Neon</b> stores the database.
          </li>
          <li>
            <b className="text-white">Vercel</b> hosts the app.
          </li>
          <li>
            <b className="text-white">Anthropic</b> runs the AI model behind the coach chat and session debriefs. It
            receives your message and the relevant training and health context. Under Anthropic&apos;s commercial
            terms, it doesn&apos;t use this data to train its models.
          </li>
          <li>
            <b className="text-white">TypeSafe</b> checks which sport each workout was. It receives the workout&apos;s
            title and metrics (sport label, duration, distance, speed, heart rate, cadence, and elevation), not your
            name or email.
          </li>
          <li>
            <b className="text-white">Resend</b> delivers email, such as sign-in links and reminders.
          </li>
          <li>
            <b className="text-white">Google</b> handles sign-in when you choose &ldquo;Continue with Google&rdquo;. We
            keep your name, email, profile picture, and Google account ID, not Google access tokens.
          </li>
          <li>
            <b className="text-white">GoatCounter and Vercel Analytics</b> count page views without cookies. Page
            addresses are recorded with account IDs removed.
          </li>
        </ul>
        <p className="mt-3">
          These providers may process data in the United States, the United Kingdom, or the European Union.
        </p>
      </Section>

      <Section title="Connected services">
        <p>
          When you connect Strava, Whoop, or Garmin, you approve access on that service&apos;s own page, and we receive
          data through its API under OAuth 2.0. Garmin data is available through the Garmin Connect Developer Program.
          We encrypt the access tokens with AES-256 before we store them.
        </p>
        <p className="mt-3">To stop sharing, do either of the following:</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>
            In Throughline, open <b className="text-white">Settings</b> and choose{' '}
            <b className="text-white">Disconnect</b> for the service. We revoke our access at that service and delete
            the tokens.
          </li>
          <li>Remove Throughline in that service&apos;s own app or account settings.</li>
        </ol>
        <p className="mt-3">Workouts that already synced stay in your history until you delete your account.</p>
      </Section>

      <Section title="Security">
        <p>
          Data travels over HTTPS and is encrypted at rest. Third-party access tokens get an extra layer of AES-256
          encryption. Access to the database is limited to the app and its operator.
        </p>
      </Section>

      <Section title="Retention and deletion">
        <p>
          We keep your data while your account exists. To delete your account, open{' '}
          <b className="text-white">Settings</b>, go to <b className="text-white">Delete your account</b>, and type
          DELETE to confirm. Deletion removes your profile, plans, workouts, health data, check-ins, and connections,
          and revokes our access at Strava, Whoop, and Garmin.
        </p>
        <p className="mt-3">
          Deleted data can stay in our database provider&apos;s encrypted backups for up to 30 days before it&apos;s
          overwritten. Product feedback you sent is kept with your name removed.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          You can ask for a copy of your data, ask us to correct it, or ask us to delete it. You can also object to
          how we process it. Email{' '}
          <a href={`mailto:${CONTACT}`} className="text-lime-300 underline">
            {CONTACT}
          </a>{' '}
          and we reply within 30 days. If you live in the UK or the EU, you can also complain to your data protection
          authority.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          We use one sign-in cookie to keep you signed in, and short-lived cookies that protect the connect flows for
          Strava, Whoop, and Garmin. We don&apos;t use advertising or tracking cookies.
        </p>
      </Section>

      <Section title="Children">
        <p>Throughline is not intended for anyone under 16, and we don&apos;t knowingly collect their data.</p>
      </Section>

      <Section title="Not medical advice">
        <p>
          Throughline gives training guidance, not medical advice. Talk to a doctor about pain, illness, or a health
          condition.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If we change this policy, we update the date at the top, and for significant changes we tell you in the app.
          For questions, email{' '}
          <a href={`mailto:${CONTACT}`} className="text-lime-300 underline">
            {CONTACT}
          </a>
          .
        </p>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <div className="mt-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}
