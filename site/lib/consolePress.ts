/**
 * The one guard every console route that WRITES puts in front of itself.
 *
 * It was the act route's own function until the console voice arrived with two more writing routes, and a
 * second copy is exactly the shape that loses a check: the act route, the voice's relay and its offer
 * all need the same answer to the same question, and a guard that drifts between them protects whichever
 * copy was edited last.
 */

/** The hostnames a loopback server answers on. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Decide whether a request is a press from the console this server is serving, and nothing else.
 *
 * What this establishes, exactly: the request came from a document this server served, in a browser on
 * this machine, as a same-origin fetch. Every check is a header a browser sets and a script on another
 * origin cannot forge — `Origin` (absent on a bare navigation and on a curl with no thought given to it),
 * `Sec-Fetch-Site` where the browser sends one, and a JSON content type a cross-site form cannot produce.
 *
 * **"On this machine" is the bind's doing, not this function's.** Every header read here is one a client
 * writes, so a process on another host could send all of them; and Next hands a route no socket address to
 * check — `x-forwarded-for` is filled with `??=`, so a client's own value wins. What keeps another host out is
 * that `scripts/docs-site.sh` starts every console server on 127.0.0.1 alone (its `console_host`), so a
 * connection from anywhere else is refused before a route runs.
 *
 * What it does NOT establish, stated rather than implied: that a human pressed. Any process already
 * running as the owner on this machine can send these headers; the protection is against a page on another
 * origin and against a stray GET, not against the owner's own shell. That is the same residue the
 * journalled-grants contract names and accepts.
 *
 * **The console voice makes that residue load-bearing rather than theoretical**, which is why it is repeated
 * here. A language model reads source text, board rows and cards and can ask for a tool; when it calls the
 * relay, this guard passes — the fetch really is same-origin, from the page this server served. So the
 * separation that holds there is not this function. It is that `talkToolsList.ts` has exactly one relay arm and
 * no generic writer, and that the relay posts only after `relayGate.ts` finds the owner's own words since the last
 * relay with no third-party read after them.
 *
 * @param request the incoming press
 * @returns `undefined` for a press, else the sentence the refusal prints
 */
export function refuseUnlessConsolePress({ request }: { request: Request }): string | undefined {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (host === null) {
    return "no Host header";
  }
  if (origin === null) {
    return "no Origin header: a press from the console carries one, a navigation or a bare curl does not";
  }
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return `Origin ${origin} is not a URL`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Origin ${origin} is not a web origin`;
  }
  if (!LOOPBACK.has(parsed.hostname === "::1" ? "[::1]" : parsed.hostname)) {
    return `Origin ${origin} is not this machine; the console acts only from the page this server serves`;
  }
  if (parsed.host !== host) {
    return `Origin ${origin} does not match the Host this server was reached as (${host})`;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return `Sec-Fetch-Site is ${site}, not same-origin`;
  }
  const type = request.headers.get("content-type");
  if (type === null || !type.toLowerCase().startsWith("application/json")) {
    return "the body is not application/json";
  }
  return undefined;
}
