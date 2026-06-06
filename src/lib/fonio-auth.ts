// Shared-secret gate for fonio's inbound/outbound API calls.
//
// fonio can be configured to send a secret with each webhook / API Request. We accept it in
// any of the common spots so it works however the fonio side is set up:
//   - Authorization: Bearer <secret>
//   - x-fonio-secret: <secret>      (custom header)
//   - ?secret=<secret>              (query param, for read endpoints fonio calls as a tool)
//
// If FONIO_WEBHOOK_SECRET is unset we allow the call (dev convenience) but warn loudly, so the
// loop is still demoable before the secret is wired — never silently fail closed in dev.

const SECRET = process.env.FONIO_WEBHOOK_SECRET?.trim();

/** Constant-time-ish compare to avoid trivial timing leaks. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function presentedSecret(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const header = req.headers.get("x-fonio-secret");
  if (header) return header.trim();
  const url = new URL(req.url);
  const q = url.searchParams.get("secret");
  if (q) return q.trim();
  return null;
}

/** True if the request is authorized. */
export function verifyFonioRequest(req: Request): boolean {
  if (!SECRET) {
    console.warn("[fonio-auth] FONIO_WEBHOOK_SECRET is unset — accepting request UNVERIFIED.");
    return true;
  }
  const given = presentedSecret(req);
  return !!given && safeEqual(given, SECRET);
}
