/**
 * Every Graph request this door sends carries its own deadline: the middleware puts an `AbortSignal` on the
 * request's options, keeps what was already there, hands the request on once, and the signal fires.
 */
import type { Context, Middleware } from "@microsoft/microsoft-graph-client";
import { describe, expect, it } from "vitest";

import { unwrapErr } from "../../../../lib/result.js";
import { acquireOutlookToken, graphDeadlineMiddleware } from "../../../../live/outlook/client.js";

/** A next link that records each context it is handed and answers nothing. */
function recordingNext(): { readonly seen: Context[]; readonly link: Middleware } {
  const seen: Context[] = [];
  return {
    link: {
      execute: (context) => {
        seen.push(context);
        return Promise.resolve();
      },
    },
    seen,
  };
}

describe("graphDeadlineMiddleware", () => {
  it("puts a live signal on the request's options, keeps its other options, and hands it on once", async () => {
    const next = recordingNext();
    const deadline = graphDeadlineMiddleware({ deadlineMs: 60_000 });
    deadline.setNext(next.link);
    const context: Context = { options: { method: "POST" }, request: "https://graph.microsoft.com/v1.0/me" };

    await deadline.execute(context);

    expect(next.seen).toHaveLength(1);
    expect(next.seen[0]).toBe(context);
    expect(context.options!.method).toBe("POST");
    expect(context.options!.signal).toBeInstanceOf(AbortSignal);
    expect(context.options!.signal!.aborted).toBe(false);
  });

  it("aborts the request's signal as a timeout once the deadline passes", async () => {
    const next = recordingNext();
    const deadline = graphDeadlineMiddleware({ deadlineMs: 1 });
    deadline.setNext(next.link);
    const context: Context = { request: "https://graph.microsoft.com/v1.0/me" };

    await deadline.execute(context);
    const signal = context.options!.signal!;
    await new Promise((resolve) => {
      signal.addEventListener("abort", resolve, { once: true });
    });

    expect(signal.aborted).toBe(true);
    expect((signal.reason as Error).name).toBe("TimeoutError");
  });

  it("refuses to run with no next link rather than dropping the request", async () => {
    const deadline = graphDeadlineMiddleware({ deadlineMs: 60_000 });

    await expect(deadline.execute({ request: "https://graph.microsoft.com/v1.0/me" })).rejects.toThrow(
      "the Graph deadline middleware was built with no next handler",
    );
  });
});

describe("acquireOutlookToken", () => {
  it("refuses a cache that will not deserialize without quoting it, before any network call", async () => {
    // The witness that this input WOULD leak through a parser message: V8 quotes its first ten characters.
    expect(() => JSON.parse("FIXTURE_REFRESH_TOKEN_VALUE")).toThrow("FIXTURE_RE");

    const refused = unwrapErr(
      await acquireOutlookToken({
        clientId: "00000000-0000-0000-0000-000000000000",
        homeAccountId: "fixture.home",
        msalCache: "FIXTURE_REFRESH_TOKEN_VALUE",
        scopes: ["User.Read"],
      }),
    );

    expect(refused.code).toBe("CREDENTIAL_UNREADABLE");
    expect(refused.message).toContain("is not a readable MSAL cache");
    expect(refused.message).not.toContain("FIXTURE_RE");
  });
});
