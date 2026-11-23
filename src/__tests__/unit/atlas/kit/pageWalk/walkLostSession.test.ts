/**
 * How the page walk ends on a lost session and names a transport failure: it stops, records the rest as not
 * attempted, notes a real sign-in wall but never a dropped relay, and quotes the platform's hint or the
 * transport's URL-free diagnosis rather than any message carrying an address.
 */
import { describe, expect, it } from "vitest";

import { walkDeclaredPages } from "../../../../../atlas/kit/pageWalk.js";
import { BrowserTransportErrors } from "../../../../../browser/pageTransport.js";
import { takeSignInWalls } from "../../../../../browser/signInWalls.js";
import { err, unwrap } from "../../../../../lib/result.js";

import { fakeTransport, recordingWriter } from "../../../../walkTransportFake.js";

import { ORIGIN, PROBE, toySpec, withRoot } from "./harness.js";

describe("walkDeclaredPages", () => {
  // A signed-out platform that keeps answering 200 would otherwise produce one page gap per remaining route.
  it("stops the walk when the platform reads a settled page as the session ending", async () => {
    const fake = withRoot();
    const walked = unwrap(
      await walkDeclaredPages({
        spec: toySpec({ over: { sessionLostOn: () => true } }),
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.sessionLost).toBe(true);
  });

  it("records the pages after a lost session as not attempted, which is not the same as unreachable", async () => {
    const fake = withRoot();
    const walked = unwrap(
      await walkDeclaredPages({
        spec: toySpec({ over: { sessionLostOn: () => true } }),
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages.slice(1).map((page) => page.attempted)).toEqual([false, false]);
  });

  // The register is process-scoped, so each case drains what an earlier one left before it walks.
  it("notes the origin a signed-out page was ASKED for, so a scheduled resync can card the sign-in", async () => {
    takeSignInWalls();
    await walkDeclaredPages({
      spec: toySpec({ over: { sessionLostOn: ({ capture }) => capture.finalUrl === `${ORIGIN}/one` } }),
      transport: withRoot().transport,
      writeArtifact: recordingWriter().write,
    });
    expect(takeSignInWalls()).toEqual([ORIGIN]);
  });

  it("notes a sign-in wall the platform's own root probe lands on, before any declared page", async () => {
    takeSignInWalls();
    await walkDeclaredPages({
      spec: toySpec({
        over: {
          resolveRoot: async ({ transport }) => {
            await transport.visit({ settleMs: 0, url: "https://app.toy.test/" });
            return err(["signed out"]);
          },
          sessionLostOn: ({ capture }) => capture.finalUrl === "https://login.toy.test/",
        },
      }),
      transport: fakeTransport({
        visits: { "https://app.toy.test/": { capture: { finalUrl: "https://login.toy.test/" } } },
      }).transport,
      writeArtifact: recordingWriter().write,
    });
    expect(takeSignInWalls()).toEqual(["https://app.toy.test"]);
  });

  it("notes no sign-in wall when the TRANSPORT reports the session gone — a dropped relay is not a sign-in", async () => {
    takeSignInWalls();
    const gone = { failWith: BrowserTransportErrors.sessionLost({ reason: "relay closed" }) };
    const walked = unwrap(
      await walkDeclaredPages({
        // Every capture reads as signed out here, so only a visit that FAILED can keep the register empty.
        spec: toySpec({ over: { sessionLostOn: () => true } }),
        transport: fakeTransport({ visits: { [PROBE]: gone, [`${ORIGIN}/one`]: gone } }).transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.sessionLost).toBe(true);
    expect(takeSignInWalls()).toEqual([]);
  });

  it("stops the walk when the TRANSPORT reports the session gone", async () => {
    const fake = withRoot({
      visits: { [`${ORIGIN}/one`]: { failWith: BrowserTransportErrors.sessionLost({ reason: "signed out" }) } },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.sessionLost).toBe(true);
  });

  // The transport's own message interpolates the address it was given, and both atlases address URLs that
  // carry a private identifier — so an observation quotes the platform's hint and never that message.
  it("gives a lost session the platform's own sign-in hint, never the transport's URL-bearing message", async () => {
    const fake = withRoot({
      visits: { [`${ORIGIN}/one`]: { failWith: BrowserTransportErrors.sessionLost({ reason: "signed out" }) } },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages[0]!.unreachableBecause).toBe("sign in again");
  });

  // What this closes: a 45-second page timeout and a two-minute client kill both
  // recorded "the browser could not navigate to this page's address", so six Vanta runs could not separate
  // three mechanisms. The transport's own `because` is what a row now carries.
  it("records the transport's URL-FREE diagnosis, so two different mechanisms stop reading identically", async () => {
    const tenantUrl = `${ORIGIN}/one?tenant=private-tenant-slug-9f3a`;
    const fake = withRoot({
      visits: {
        [`${ORIGIN}/one`]: {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the browser client was killed at its own 80.0s process bound after 80.1s (SIGTERM)",
            reason: "spawnSync node ETIMEDOUT",
            url: tenantUrl,
          }),
        },
      },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );

    expect(walked.pages[0]!.unreachableBecause).toBe(
      "the browser client was killed at its own 80.0s process bound after 80.1s (SIGTERM)",
    );
    // Falsifiable: the slug IS in the failure the walk was handed, so this reddens if `message` is ever quoted.
    expect(tenantUrl).toContain("private-tenant-slug-9f3a");
    expect(walked.pages[0]!.unreachableBecause).not.toContain("private-tenant-slug-9f3a");
  });
});
