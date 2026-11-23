/**
 * What the page walk writes and what each observation carries: progress lines that lead with the platform's
 * label and never quote a URL, an instant a store can read, and calls reduced the platform's own way.
 */
import { describe, expect, it } from "vitest";

import { walkDeclaredPages } from "../../../../../atlas/kit/pageWalk.js";
import { BrowserTransportErrors } from "../../../../../browser/pageTransport.js";
import { ok, unwrap } from "../../../../../lib/result.js";

import { recordingWriter } from "../../../../walkTransportFake.js";

import { ORIGIN, toySpec, withRoot } from "./harness.js";

describe("walkDeclaredPages", () => {
  it("never puts a URL in a progress line, because both atlases address URLs carrying a private id", async () => {
    const fake = withRoot();
    const lines: string[] = [];
    await walkDeclaredPages({
      progress: ({ line }) => lines.push(line),
      spec: toySpec(),
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines.filter((line) => line.includes("http"))).toEqual([]);
  });

  // A probe that recovered from a failure has to be able to say so, and the walk's own sink is the only
  // channel its caller already points somewhere a person reads.
  it("hands the walk's own progress sink to the platform's root probe", async () => {
    const fake = withRoot();
    const lines: string[] = [];
    await walkDeclaredPages({
      progress: ({ line }) => lines.push(line),
      spec: toySpec({
        over: {
          resolveRoot: async ({ progress }) => {
            progress?.({ line: "toy: the root probe recovered" });
            return ok(`${ORIGIN}/root`);
          },
        },
      }),
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines[0]).toBe("toy: the root probe recovered");
  });

  it("leads every progress line with the platform's own label", async () => {
    const fake = withRoot();
    const lines: string[] = [];
    await walkDeclaredPages({
      progress: ({ line }) => lines.push(line),
      spec: toySpec(),
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines.every((line) => line.startsWith("toy: "))).toBe(true);
  });

  it("repairs an instant a succeeding capture brought back unreadable, because one refuses a whole generation", async () => {
    const fake = withRoot({ visits: { [`${ORIGIN}/one`]: { capture: { observedAt: "not-an-instant" } } } });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(Number.isNaN(Date.parse(walked.pages[0]!.observedAt))).toBe(false);
  });

  it("keeps the instant a capture brought back when a store can read it", async () => {
    const fake = withRoot({ visits: { [`${ORIGIN}/one`]: { capture: { observedAt: "2026-09-05T00:00:00.000Z" } } } });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages[0]!.observedAt).toBe("2026-09-05T00:00:00.000Z");
  });

  it("leaves a FAILED visit's empty instant alone, because the surfaces read it as never observed", async () => {
    const fake = withRoot({
      visits: {
        [`${ORIGIN}/one`]: {
          failWith: BrowserTransportErrors.navigationFailed({
            because: "the fake reported this page unreachable",
            reason: "timed out",
            url: `${ORIGIN}/one`,
          }),
        },
      },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages[0]!.observedAt).toBe("");
  });

  it("reduces a page's calls through the platform's own reduction", async () => {
    const fake = withRoot({
      visits: {
        [`${ORIGIN}/one`]: {
          capture: { responses: [{ body: {}, method: "GET", statusCode: 200, url: `${ORIGIN}/api/x` }] },
        },
      },
    });
    const walked = unwrap(
      await walkDeclaredPages({ spec: toySpec(), transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages[0]!.calls).toEqual([`${ORIGIN}/api/x`]);
  });
});
