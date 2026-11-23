/**
 * SUBPROCESS lane: the one inbound socket in this product, exercised for real.
 *
 * `docs/security/mail-boundary.md` claims three properties of the shared `connect` loopback listener — it binds to the
 * loopback interface only, it serves exactly ONE request and closes, and it tears itself down on a deadline
 * whether or not anything arrives. Those are safety claims, so they are proved by binding a real socket and
 * connecting to it rather than by prose. It lives here rather than on the unit lane because a real socket is
 * real I/O; there is no `vi.mock` anywhere in it.
 *
 * Both advertised hosts are driven: `127.0.0.1` (the Google doors) and `localhost` (the Outlook door), where the
 * listener also answers on `::1` so either resolution of the name reaches it.
 */
import { describe, expect, it } from "vitest";
import { unwrap, unwrapErr } from "../../../../lib/result.js";
import { awaitLoopbackCallback } from "../../../../live/oauth/loopback.js";

/** How long the deadline test waits — long enough not to be flaky, short enough not to slow the lane. */
const SHORT_DEADLINE_MS = 250;

/** One fetch that reports whether a connection was made, rather than throwing on a refusal. */
async function reach({ url }: { url: string }): Promise<"connected" | "refused"> {
  return fetch(url).then(
    () => "connected" as const,
    () => "refused" as const,
  );
}

/** Start a `localhost` wait, and hand back the announced redirect URI as a promise beside the wait itself. */
function listenAsLocalhost(): {
  pending: ReturnType<typeof awaitLoopbackCallback>;
  redirect: Promise<string>;
} {
  let announce: (uri: string) => void = () => undefined;
  const redirect = new Promise<string>((resolve) => {
    announce = resolve;
  });
  const pending = awaitLoopbackCallback({
    onListening: ({ redirectUri }) => {
      announce(redirectUri);
    },
    productName: "Outlook",
    redirectHost: "localhost",
    timeoutMs: 10_000,
  });
  return { pending, redirect };
}

describe("awaitLoopbackCallback", () => {
  it("binds loopback, hands back the redirect URI, and resolves with the request the browser made", async () => {
    let redirect = "";
    const pending = awaitLoopbackCallback({
      onListening: ({ redirectUri }) => {
        redirect = redirectUri;
      },
      productName: "Gmail",
      timeoutMs: 10_000,
    });
    // The callback fires before any request, so the URI is known by the time we can send one.
    await new Promise((resolve) => setImmediate(resolve));
    expect(redirect.startsWith("http://127.0.0.1:")).toBe(true);

    const response = await fetch(`${redirect}/?code=the-code&state=st8`);
    expect(response.status).toBe(200);
    const page = await response.text();
    // The code is not yet redeemed when this page is served, so it never claims the connection worked.
    expect(page).toContain("Gmail answer received");
    expect(page).toContain("it says whether connecting finished");
    expect(page).not.toContain("connected<");

    expect(unwrap(await pending).requestUrl).toBe("/?code=the-code&state=st8");
  });

  it("CLOSES after that one request — a second connection to the same port is refused", async () => {
    let redirect = "";
    const pending = awaitLoopbackCallback({
      onListening: ({ redirectUri }) => {
        redirect = redirectUri;
      },
      productName: "Gmail",
      timeoutMs: 10_000,
    });
    await new Promise((resolve) => setImmediate(resolve));
    await fetch(`${redirect}/?code=c&state=s`);
    await pending;

    expect(await reach({ url: redirect })).toBe("refused");
  });

  it("tears itself down on the deadline when the browser never comes back", async () => {
    let redirect = "";
    const result = await awaitLoopbackCallback({
      onListening: ({ redirectUri }) => {
        redirect = redirectUri;
      },
      productName: "Gmail",
      timeoutMs: SHORT_DEADLINE_MS,
    });
    expect(unwrapErr(result).code).toBe("CONSENT_WINDOW_CLOSED");

    expect(await reach({ url: redirect })).toBe("refused");
  });

  it("closes at once when its signal aborts, before any request or deadline", async () => {
    const controller = new AbortController();
    let redirect = "";
    const pending = awaitLoopbackCallback({
      onListening: ({ redirectUri }) => {
        redirect = redirectUri;
      },
      productName: "Outlook",
      redirectHost: "localhost",
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    await new Promise((resolve) => setImmediate(resolve));
    controller.abort();
    expect(unwrapErr(await pending).code).toBe("CONSENT_ABANDONED");

    expect(await reach({ url: redirect })).toBe("refused");
  });

  it("advertises localhost and answers on the IPv4 loopback under that name", async () => {
    const { pending, redirect } = listenAsLocalhost();
    const uri = await redirect;
    expect(uri.startsWith("http://localhost:")).toBe(true);
    const port = new URL(uri).port;

    const response = await fetch(`http://127.0.0.1:${port}/?code=v4&state=s`);
    expect(await response.text()).toContain("Outlook answer received");
    expect(unwrap(await pending).requestUrl).toBe("/?code=v4&state=s");
  });

  it("with localhost, a browser that resolves the name to ::1 reaches the same handler", async () => {
    const { pending, redirect } = listenAsLocalhost();
    // No wait beyond the announcement: the URI is announced only once BOTH families are listening.
    const port = new URL(await redirect).port;

    const response = await fetch(`http://[::1]:${port}/?code=v6&state=s`);
    expect(response.status).toBe(200);
    expect(unwrap(await pending).requestUrl).toBe("/?code=v6&state=s");
    // The IPv4 listener closed with it — the witness that both were ONE wait.
    expect(await reach({ url: `http://127.0.0.1:${port}/` })).toBe("refused");
  });

  it("with localhost, the first request on EITHER family closes both listeners", async () => {
    const { pending, redirect } = listenAsLocalhost();
    const port = new URL(await redirect).port;
    await fetch(`http://127.0.0.1:${port}/?code=c&state=s`);
    await pending;

    expect(await reach({ url: `http://127.0.0.1:${port}/` })).toBe("refused");
    expect(await reach({ url: `http://[::1]:${port}/` })).toBe("refused");
  });
});
