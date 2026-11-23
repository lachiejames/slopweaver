/**
 * The one inbound socket in this product: the loopback listener a user-consent `connect` verb receives its
 * authorisation code on, and the browser hand-off that sends the owner to the consent page. Shared by every
 * door that consents through an installed-app OAuth flow — the Google doors (`../google/consent.ts`) and the
 * Outlook door (`../outlook/consent.ts`).
 *
 * ## Why it is acceptable
 *
 * `docs/security/mail-boundary.md` can say "nothing listens on a port" of every other verb. It cannot say it of
 * the `connect` verbs: an installed-app flow delivers the code to `http://<loopback>:<port>`. So this binds a
 * server, and every property that bounds it is deliberate: it binds the **loopback interface only** (never
 * `0.0.0.0`), on an **ephemeral port the kernel picks**, it serves **one** request and closes, and it is torn
 * down on a {@link CONSENT_TIMEOUT_MS} deadline whether or not anything ever arrives. There is no path by which
 * it outlives the `connect` invocation that opened it.
 *
 * ## Two redirect hosts, because two providers register redirects differently
 *
 * Google's installed-app flow redirects to `http://127.0.0.1:<port>`. A Microsoft "Mobile and desktop
 * applications" registration made in the portal accepts `http://localhost` and ignores the port, while an
 * `http://127.0.0.1` redirect needs a hand-edited manifest. So a caller names the host it ADVERTISES. With
 * `localhost` the browser may resolve the name to `::1` or `127.0.0.1`, so the listener binds `127.0.0.1` and
 * then `::1` on the same port, and the redirect URI is announced only once BOTH are listening — a browser is free
 * to pick either address, so a missing one would be a consent that completes and then reaches nothing. Either
 * resolution reaches the one handler, and the first request on either closes both.
 *
 * The browser is opened with a blocking `execFileSync` — `no-headless` bans the async `child_process` family
 * outright and that ban has no exemption marker (AGENTS.md rule 2). The URL is ALWAYS printed as well, so a
 * failed opener degrades to "paste this" rather than to a dead wait.
 */
import { execFileSync } from "node:child_process";
import { createServer, type RequestListener, type Server } from "node:http";

import { err, ok, type Result } from "#lib/result.js";

/** How long the loopback listener waits for the browser before giving up. */
const CONSENT_TIMEOUT_MS = 300_000;

/** The loopback listener's deadline passed before the browser came back. */
export interface ConsentWindowClosedError {
  readonly code: "CONSENT_WINDOW_CLOSED";
  readonly message: string;
}

/** The loopback listener could not be bound. */
export interface ListenerFailedError {
  readonly code: "LISTENER_FAILED";
  readonly message: string;
  readonly cause: unknown;
}

/** The caller gave up on the wait before the browser came back — it could not build the consent URL. */
export interface ConsentAbandonedError {
  readonly code: "CONSENT_ABANDONED";
  readonly message: string;
}

/** Why the loopback wait ended without a callback. */
export type LoopbackError = ConsentAbandonedError | ConsentWindowClosedError | ListenerFailedError;

/** How to raise one — the factory the listener calls, so a test built the same way catches a drift. */
export const LoopbackErrors = {
  abandoned: (): ConsentAbandonedError => ({
    code: "CONSENT_ABANDONED",
    message: "the consent was abandoned before the browser came back",
  }),
  listenerFailed: ({ cause }: { cause: Error }): ListenerFailedError => ({
    cause,
    code: "LISTENER_FAILED",
    message: `could not open the loopback listener: ${cause.message}`,
  }),
  windowClosed: (): ConsentWindowClosedError => ({
    code: "CONSENT_WINDOW_CLOSED",
    message: "the consent window closed before the browser came back",
  }),
} as const;

/** The host a redirect URI names. */
export type RedirectHost = "127.0.0.1" | "localhost";

/**
 * What the browser is shown once the redirect has been captured — deliberately plain, and never the code. It
 * claims only what is true at that instant: the answer reached the terminal. The redirect may carry a refusal,
 * and the code has not been redeemed nor the grant stored yet, so whether connecting worked is the
 * terminal's to say, never this page's.
 *
 * @param productName the door's own name, as the owner would say it ("Gmail", "Outlook")
 * @returns the one-page HTML body served to the browser
 */
function donePage({ productName }: { productName: string }): string {
  return (
    "<!doctype html><meta charset=utf-8><title>Slopweaver</title>" +
    `<body style="font:16px/1.5 system-ui;padding:3rem"><h1>${productName} answer received</h1>` +
    "<p>Return to the terminal: it says whether connecting finished. You can close this tab.</p>"
  );
}

/** The port a listening server was given. */
function portOf({ server }: { server: Server }): number {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : 0;
}

/**
 * Bind the loopback interface, serve exactly one request, and resolve with its URL. Closes on the first
 * request or on {@link CONSENT_TIMEOUT_MS}, whichever comes first — there is no path that leaves a socket open.
 *
 * @param onListening called once the ephemeral port is known, with the redirect URI to send the provider to
 * @param productName the door's own name, shown on the page the browser lands on
 * @param redirectHost the host the redirect URI advertises — see this file's header
 * @param timeoutMs how long to wait for the browser
 * @param signal ends the wait early and closes every listener — for a caller that cannot go on to present a URL
 * @returns the raw request URL the browser hit, or the reason the wait ended without one
 */
export async function awaitLoopbackCallback({
  onListening,
  productName,
  redirectHost = "127.0.0.1",
  timeoutMs = CONSENT_TIMEOUT_MS,
  signal,
}: {
  onListening: (args: { redirectUri: string }) => void;
  productName: string;
  redirectHost?: RedirectHost;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<Result<{ requestUrl: string }, LoopbackError>> {
  return new Promise((resolve) => {
    let settled = false;
    const servers: Server[] = [];
    const finish = ({ outcome }: { outcome: Result<{ requestUrl: string }, LoopbackError> }): void => {
      if (settled) {
        return;
      }
      settled = true;
      for (const server of servers) {
        server.close();
      }
      resolve(outcome);
    };
    const handler: RequestListener = (request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(donePage({ productName }));
      // Node types `url` optional only because the same class serves the CLIENT side; a request a server
      // received always carries one, so that invariant is asserted rather than defaulted.
      finish({ outcome: ok({ requestUrl: request.url! }) });
    };
    const primary = createServer(handler);
    servers.push(primary);
    const timer = setTimeout(() => {
      finish({ outcome: err(LoopbackErrors.windowClosed()) });
    }, timeoutMs);
    timer.unref();
    signal?.addEventListener("abort", () => {
      finish({ outcome: err(LoopbackErrors.abandoned()) });
    });
    primary.on("error", (error: Error) => {
      finish({ outcome: err(LoopbackErrors.listenerFailed({ cause: error })) });
    });
    primary.listen(0, "127.0.0.1", () => {
      const port = portOf({ server: primary });
      if (redirectHost === "127.0.0.1") {
        onListening({ redirectUri: `http://127.0.0.1:${String(port)}` });
        return;
      }
      bindIpv6Twin({ finish, handler, onListening, port, servers });
    });
  });
}

/**
 * Bind `::1` on the port `127.0.0.1` was given, so a `localhost` redirect lands whichever address the browser
 * resolves it to, and announce the `localhost` redirect URI once both listen.
 *
 * Not best effort: no browser promises to fall back from a refused `::1` to `127.0.0.1`, so a failed second
 * bind ends the wait BEFORE the URL is shown rather than after the owner has approved.
 */
function bindIpv6Twin({
  finish,
  handler,
  onListening,
  port,
  servers,
}: {
  finish: (args: { outcome: Result<{ requestUrl: string }, LoopbackError> }) => void;
  handler: RequestListener;
  onListening: (args: { redirectUri: string }) => void;
  port: number;
  servers: Server[];
}): void {
  const secondary = createServer(handler);
  servers.push(secondary);
  secondary.on("error", (error: Error) => {
    finish({ outcome: err(LoopbackErrors.listenerFailed({ cause: error })) });
  });
  secondary.listen(port, "::1", () => {
    onListening({ redirectUri: `http://localhost:${String(port)}` });
  });
}

/**
 * Open the owner's browser at the consent URL, and print the URL either way.
 *
 * @param url the consent URL
 * @param productName the door's own name, so the printed line says which grant is being approved
 * @param writeLine where the URL is printed
 * @param openWith the platform opener command, defaulting to macOS `open`
 */
export function presentConsentUrl({
  url,
  productName,
  writeLine,
  openWith = process.platform === "darwin" ? "open" : "xdg-open",
}: {
  url: string;
  productName: string;
  writeLine: (line: string) => void;
  openWith?: string;
}): void {
  writeLine(`open this to approve the ${productName} grant:\n  ${url}`);
  try {
    execFileSync(openWith, [url], { stdio: "ignore", timeout: 10_000 });
  } catch {
    writeLine("(could not open a browser for you — paste the URL above)");
  }
}
