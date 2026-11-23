/**
 * The guard a console GET puts in front of itself when answering it costs a provider read on the owner's token.
 *
 * A GET is what any page can make a browser send: an `<img>`, a link, a form, a `fetch` in `no-cors` mode. Without a
 * guard, a page on another origin open in the same browser could make this server spawn an authenticated Slack read
 * every time it loads, and the 429 that buys would land on the window the owner actually uses.
 * `./consolePress.ts` closes that for the writing routes with a JSON body; a read has no body, so it needs its own.
 */

/** The header the console's own fetch carries, and the one value it carries. */
export const CONSOLE_READ_HEADER = "x-slopweaver-console-read";
export const CONSOLE_READ_VALUE = "1";

/** The hostnames a loopback server answers on, as a `Host` header spells them. */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** The hostname half of a `Host` header, port dropped, IPv6 brackets kept. */
function hostnameOf({ host }: { host: string }): string {
  if (host.startsWith("[")) {
    return host.slice(0, host.indexOf("]") + 1);
  }
  const colon = host.indexOf(":");
  if (colon === -1) {
    return host.toLowerCase();
  }
  return host.slice(0, colon).toLowerCase();
}

/**
 * Decide whether a GET is the console's own read, and nothing else.
 *
 * Three checks, each a thing another origin cannot do. The `Host` must be this machine's loopback, so a page on
 * another name that DNS-rebinds to 127.0.0.1 — and is then "same-origin" with itself — is refused. A request carrying
 * a header of its own naming is not a simple request, so a cross-origin page cannot send it without a CORS preflight
 * this server never answers, and no tag or navigation can set one at all. `Sec-Fetch-Site`, where the browser sends
 * it, must say `same-origin`.
 *
 * What it does NOT establish: that a human hovered. A process running as the owner on this machine can send all three,
 * the same residue `refuseUnlessConsolePress` names and accepts.
 *
 * @param request the incoming GET
 * @returns `undefined` for the console's own read, else the sentence the refusal prints
 */
export function refuseUnlessConsoleRead({ request }: { request: Request }): string | undefined {
  const host = request.headers.get("host");
  if (host === null) {
    return "no Host header";
  }
  if (!LOOPBACK.has(hostnameOf({ host }))) {
    return `Host ${host} is not this machine. The console reads only for the page this server serves`;
  }
  if (request.headers.get(CONSOLE_READ_HEADER) !== CONSOLE_READ_VALUE) {
    return `no ${CONSOLE_READ_HEADER} header. The console's own window sends one, a page on another site cannot`;
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return `Sec-Fetch-Site is ${site}, not same-origin`;
  }
  return undefined;
}
