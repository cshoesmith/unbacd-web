export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return <LoginPageInner searchParams={searchParams} />;
}

async function LoginPageInner({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const errorMessage =
    error === 'invalid_state'  ? 'Authentication failed — please try again.' :
    error === 'missing_code'   ? 'Sign-in was cancelled.' :
    error === 'auth_failed'    ? 'Untappd rejected the login. Please try again.' :
    error                      ? 'Something went wrong. Please try again.' : null;

  return (
    <main className="min-h-screen bg-[#080604] flex flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-8 w-full max-w-sm">

        {/* Title */}
        <div className="text-center">
          <h1 className="text-5xl font-black text-[#ffd166] tracking-widest">
            un'bac'd
          </h1>
          <p className="text-[#9ca3af] text-sm mt-3">
            Real-time BAC tracking, powered by Untappd
          </p>
        </div>

        {/* Error banner */}
        {errorMessage && (
          <div className="w-full bg-red-900/30 border border-red-700/60 text-red-300 rounded-xl px-4 py-3 text-sm">
            {errorMessage}
          </div>
        )}

        {/* Sign-in button */}
        <a
          href="/api/auth/login"
          className="w-full flex items-center justify-center gap-3 bg-[#ffd166] hover:bg-[#f5c842] active:bg-[#e6b930] text-[#080604] font-bold py-4 px-6 rounded-2xl text-base transition-colors shadow-lg"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
          </svg>
          Sign in with Untappd
        </a>

        <p className="text-[#4b5563] text-xs text-center leading-relaxed">
          Your Untappd credentials are never stored.
          <br />
          Only your access token is saved to verify check-ins.
        </p>

        {/* Powered by Untappd */}
        <p className="text-[#374151] text-xs mt-4">Powered by Untappd</p>
      </div>
    </main>
  );
}
