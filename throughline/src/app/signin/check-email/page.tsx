/** Shown after requesting a magic link. */
export default function CheckEmailPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
      <p className="mt-2 text-sm text-slate-500">
        We sent you a sign-in link. Open it on this device to continue. You can close this tab.
      </p>
    </div>
  );
}
