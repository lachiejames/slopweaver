/**
 * The judgements Jam contributes to a walk, all of them over deterministic inputs rather than a browser.
 *
 * The regrade against the not-found control is the one that decides whether a published generation is
 * honest: before it existed this atlas published nine of Jam's own rendered not-found pages as routes it had
 * reached, each with a verified screenshot.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { JAM_INVENTED_ROUTE, JAM_NOT_FOUND_ROUTE, JAM_WEB_ORIGIN } from "../../../../atlas/jam/browserPages.js";
import {
  isJamSignInUrl,
  JAM_INVENTED_CONTROL_SURFACE,
  JAM_NOT_FOUND_CONTROL_SURFACE,
  JAM_PAGE_SETTLE_MS,
  type JamPageObservation,
  jamPageOutcome,
  jamPageWalkSpec,
  reduceJamCalls,
  regradeAgainstNotFoundControl,
  walkJamApplication,
} from "../../../../atlas/jam/browserWalk.js";
import type { PageCapture } from "../../../../browser/pageTransport.js";

import { pngOfSize, renderedPng } from "../../../pngFixture.js";
import { fakeTransport, recordingWriter, capture as sharedCapture } from "../../../walkTransportFake.js";

/** A root of the shape the client lands on, with a synthetic team id. */
const ROOT = "/s/team-0000";

/** What is JAM's about a capture, over the shared fake's own defaults. */
const JAM_PAGE: Partial<PageCapture> = {
  observedAt: "2026-09-07T00:00:00.000Z",
  screenshotPng: null,
  title: "Jam",
};

/** One capture, with only the fields a caller under test reads varied. */
function capture(over: Partial<PageCapture> = {}): PageCapture {
  return sharedCapture({ over: { ...JAM_PAGE, ...over }, url: `${JAM_WEB_ORIGIN}${ROOT}/settings` });
}

/** One page observation, with only the fields the regrade reads varied. */
function page(over: Partial<JamPageObservation> = {}): JamPageObservation {
  return {
    artifacts: [],
    attempted: true,
    calls: [],
    captureComplete: true,
    finalUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings`,
    observedAt: "2026-09-07T00:00:00.000Z",
    redirected: false,
    requestedUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings`,
    responseAccounting: { bodyFailed: 0, bodySucceeded: 0, eligible: 0, seen: 0 },
    screenshotMissingBecause: null,
    statusCode: 200,
    surface: "settings",
    title: "Jam",
    unreachableBecause: null,
    ...over,
  };
}

/** One artifact reference of a given size, which is all the not-found oracle reads. */
function shot({ bytes }: { bytes: number }): JamPageObservation["artifacts"] {
  return [
    {
      byteLength: bytes,
      kind: "page-png",
      mediaType: "image/png",
      relativePath: `artifacts/pages/${String(bytes)}.png`,
      sha256: String(bytes).padStart(64, "0"),
    },
  ];
}

describe("isJamSignInUrl", () => {
  it("reads the settled PATH, because Jam serves its sign-in page from the application's own origin", () => {
    expect(isJamSignInUrl({ finalUrl: `${JAM_WEB_ORIGIN}/login?redirect=%2F` })).toBe(true);
    expect(isJamSignInUrl({ finalUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings` })).toBe(false);
  });

  it("answers false for an address it cannot parse rather than throwing", () => {
    expect(isJamSignInUrl({ finalUrl: "not a url" })).toBe(false);
  });
});

describe("jamPageOutcome", () => {
  it("holds a page that settled where it was asked to go", () => {
    const outcome = jamPageOutcome({ capture: capture(), requestedUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings` });
    expect(outcome).toEqual({ redirected: false, unreachableBecause: null });
  });

  it("does NOT catch a rendered not-found, which is why the control pass exists", () => {
    const outcome = jamPageOutcome({
      capture: capture({ finalUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings/nope` }),
      requestedUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings/nope`,
    });
    expect(outcome.unreachableBecause).toBe(null);
  });

  it("catches a sign-in wall, and says the session is gone rather than that the page is missing", () => {
    const outcome = jamPageOutcome({
      capture: capture({ finalUrl: `${JAM_WEB_ORIGIN}/login` }),
      requestedUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings`,
    });
    expect(outcome.unreachableBecause).toContain("no longer signed in");
  });

  it("catches a settle on a different route and does NOT quote the settled path, which carries a team id", () => {
    const outcome = jamPageOutcome({
      capture: capture({ finalUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings/integrations` }),
      requestedUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings/connected-apps`,
    });
    expect(outcome.redirected).toBe(true);
    expect(outcome.unreachableBecause).toContain("settled on a different route");
    expect(outcome.unreachableBecause).not.toContain("team-0000");
  });

  // MEASURED, and the reason the invented control moved to the bare origin: Jam now forwards an
  // unknown TEAM route to its own /404, so a control addressed there is graded unreached and the walk refuses.
  it("grades an invented team route Jam forwarded to /404 as unreached, and names /404", () => {
    const outcome = jamPageOutcome({
      capture: capture({ finalUrl: `${JAM_WEB_ORIGIN}${JAM_NOT_FOUND_ROUTE}` }),
      requestedUrl: `${JAM_WEB_ORIGIN}${ROOT}${JAM_INVENTED_ROUTE}`,
    });
    expect(outcome).toEqual({
      redirected: true,
      unreachableBecause:
        "the application answered 200 and forwarded this route to its own /404, so Jam does not serve it",
    });
  });

  it("holds the invented control at the bare origin, where Jam renders its not-found in place", () => {
    const outcome = jamPageOutcome({
      capture: capture({ finalUrl: `${JAM_WEB_ORIGIN}${JAM_INVENTED_ROUTE}` }),
      requestedUrl: `${JAM_WEB_ORIGIN}${JAM_INVENTED_ROUTE}`,
    });
    expect(outcome).toEqual({ redirected: false, unreachableBecause: null });
  });

  it("catches a settle off the origin", () => {
    const outcome = jamPageOutcome({
      capture: capture({ finalUrl: "https://accounts.google.com/signin" }),
      requestedUrl: `${JAM_WEB_ORIGIN}${ROOT}/settings`,
    });
    expect(outcome.unreachableBecause).toContain("https://accounts.google.com");
  });
});

describe("reduceJamCalls", () => {
  it("keeps Jam's own calls and drops the third parties its client loads", () => {
    const calls = reduceJamCalls({
      responses: [
        { body: null, method: "GET", statusCode: 200, url: "https://api.jam.dev/whoami" },
        { body: null, method: "POST", statusCode: 200, url: "https://js.stripe.com/v1/x" },
        { body: null, method: "POST", statusCode: 200, url: "https://mcp.jam.dev/mcp" },
      ],
    });
    expect(calls.map((call) => `${call.method} ${call.origin}${call.pathShape}`)).toEqual([
      "GET https://api.jam.dev/whoami",
      "POST https://mcp.jam.dev/mcp",
    ]);
  });

  it("folds a short mixed-case recording id, which is the shape Jam actually uses", () => {
    const calls = reduceJamCalls({
      responses: [
        { body: null, method: "GET", statusCode: 200, url: "https://jam.dev/v1/input/aEV5xcX" },
        { body: null, method: "GET", statusCode: 200, url: "https://jam.dev/v1/input/zZQ2mnP" },
      ],
    });
    expect(calls).toEqual([{ method: "GET", origin: "https://jam.dev", pathShape: "/v1/input/{id}" }]);
  });

  it("keeps a VERSION segment, which a looser rule folded into an identifier", () => {
    const calls = reduceJamCalls({
      responses: [
        { body: null, method: "GET", statusCode: 200, url: "https://api.jam.dev/v1/whoami" },
        { body: null, method: "GET", statusCode: 200, url: "https://api.jam.dev/v2/whoami" },
      ],
    });
    expect(calls.map((call) => call.pathShape)).toEqual(["/v1/whoami", "/v2/whoami"]);
  });

  it("folds an all-digit and a long opaque segment too", () => {
    const calls = reduceJamCalls({
      responses: [
        { body: null, method: "GET", statusCode: 200, url: "https://jam.dev/teams/1234/x" },
        { body: null, method: "GET", statusCode: 200, url: "https://jam.dev/s/abcdefghijklmnopqrst" },
      ],
    });
    expect(calls.map((call) => call.pathShape).toSorted()).toEqual(["/s/{id}", "/teams/{id}/x"]);
  });

  it("skips a URL it cannot parse rather than throwing", () => {
    expect(reduceJamCalls({ responses: [{ body: null, method: "GET", statusCode: 200, url: "??" }] })).toEqual([]);
  });
});

describe("regradeAgainstNotFoundControl", () => {
  /** Both controls, photographed at sizes that corroborate each other. */
  function controls({ anchor = 100_000, declared = 100_000 }: { anchor?: number; declared?: number } = {}) {
    return [
      page({ artifacts: shot({ bytes: anchor }), surface: JAM_INVENTED_CONTROL_SURFACE }),
      page({ artifacts: shot({ bytes: declared }), surface: JAM_NOT_FOUND_CONTROL_SURFACE }),
    ];
  }

  it("regrades a rendered not-found once both controls corroborate", () => {
    const result = regradeAgainstNotFoundControl({
      pages: [
        ...controls(),
        page({ artifacts: shot({ bytes: 99_500 }), surface: "settings/members" }),
        page({ artifacts: shot({ bytes: 175_000 }), surface: "settings" }),
      ],
    });
    expect(result.controlFailure).toBe(null);
    expect(result.pages.filter((row) => row.unreachableBecause !== null).map((row) => row.surface)).toEqual([
      JAM_INVENTED_CONTROL_SURFACE,
      JAM_NOT_FOUND_CONTROL_SURFACE,
      "settings/members",
    ]);
  });

  it("REFUSES when the two controls disagree, which is the case one control could not detect", () => {
    const result = regradeAgainstNotFoundControl({
      // Counterexample: Jam starts serving a real page at /404 while the invented route still
      // renders the actual not-found. A check comparing one control to itself passes here; this one does not.
      pages: [
        ...controls({ anchor: 100_000, declared: 200_000 }),
        page({ artifacts: shot({ bytes: 95_000 }), surface: "settings" }),
      ],
    });
    // `band` is the ONE cause that is evidence about Jam's not-found page, so the one that re-measures it.
    expect(result.controlFailure).toEqual({
      because:
        "the two controls do not corroborate each other: the invented route rendered 100000 bytes and the declared /404 rendered 200000, 100.0% apart against a band of 5%. Jam is probably serving something real at /404 now, which would make every not-found grading below it a guess",
      cause: "band",
    });
    expect(result.pages.find((row) => row.surface === "settings")?.unreachableBecause).toBe(null);
  });

  it("types an unphotographed invented control apart from the band, naming it", () => {
    const noAnchor = regradeAgainstNotFoundControl({
      pages: [
        page({ surface: JAM_INVENTED_CONTROL_SURFACE }),
        page({ artifacts: shot({ bytes: 100_000 }), surface: JAM_NOT_FOUND_CONTROL_SURFACE }),
      ],
    });
    expect(noAnchor.controlFailure).toEqual({
      because: "the control `not-found-invented` was reached and carries no screenshot",
      cause: "control-unphotographed",
    });
  });

  it("types an unphotographed declared control apart from the band, carrying the transport's reason", () => {
    const noDeclared = regradeAgainstNotFoundControl({
      pages: [
        page({ artifacts: shot({ bytes: 100_000 }), surface: JAM_INVENTED_CONTROL_SURFACE }),
        page({ screenshotMissingBecause: "the capture timed out", surface: JAM_NOT_FOUND_CONTROL_SURFACE }),
      ],
    });
    expect(noDeclared.controlFailure).toEqual({
      because: "the control `not-found-control` was reached and carries no screenshot: the capture timed out",
      cause: "control-unphotographed",
    });
  });

  it("types an unreached control as unreachable, keeping the walk's own reason", () => {
    const unreached = regradeAgainstNotFoundControl({
      pages: [
        page({ surface: JAM_INVENTED_CONTROL_SURFACE, unreachableBecause: "the visit failed" }),
        page({ artifacts: shot({ bytes: 100_000 }), surface: JAM_NOT_FOUND_CONTROL_SURFACE }),
      ],
    });
    expect(unreached.controlFailure).toEqual({
      because: "the control `not-found-invented` was not reached at all: the visit failed",
      cause: "control-unreachable",
    });
  });

  // The walk visits `/404` before the invented route, so a run-stopping failure on `/404` leaves the invented
  // control with the kit's synthetic, never-attempted row. That row is a consequence; `/404`'s reason is the cause.
  it("reports the attempted control's own reason over a never-attempted control's stop consequence", () => {
    const stopped = regradeAgainstNotFoundControl({
      pages: [
        page({ surface: JAM_NOT_FOUND_CONTROL_SURFACE, unreachableBecause: "the relay stopped answering" }),
        page({
          attempted: false,
          surface: JAM_INVENTED_CONTROL_SURFACE,
          unreachableBecause: "the walk stopped before this page: the browser session was lost part-way through",
        }),
      ],
    });
    expect(stopped.controlFailure).toEqual({
      because: "the control `not-found-control` was not reached at all: the relay stopped answering",
      cause: "control-unreachable",
    });
  });

  it("types a control the walk never visited as missing", () => {
    const absent = regradeAgainstNotFoundControl({ pages: [page({ surface: "settings" })] });
    expect(absent.controlFailure).toEqual({
      because: "the walk visited no page under the control surface `not-found-invented`",
      cause: "control-missing",
    });
  });

  it("leaves a page the walk already recorded unreachable exactly as it was", () => {
    const result = regradeAgainstNotFoundControl({
      pages: [
        ...controls(),
        page({ artifacts: shot({ bytes: 94_500 }), surface: "settings", unreachableBecause: "the visit failed" }),
      ],
    });
    expect(result.pages.find((row) => row.surface === "settings")?.unreachableBecause).toBe("the visit failed");
  });
});

describe("walkJamApplication, over the deterministic transport", () => {
  const PROBE_URL = `${JAM_WEB_ORIGIN}/`;
  const LANDED = `${JAM_WEB_ORIGIN}${ROOT}`;

  /** A transport whose root probe lands on a team, and whose every page renders its own picture. */
  function signedIn(): ReturnType<typeof fakeTransport> {
    return fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { ...JAM_PAGE, finalUrl: LANDED } };
        }
        return { capture: { ...JAM_PAGE, screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
  }

  it("asks the bare origin first, purely to learn the team root", async () => {
    const fake = signedIn();
    await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.visited[0]).toBe(PROBE_URL);
  });

  it("reports it found a team root", async () => {
    const walked = unwrap(
      await walkJamApplication({ transport: signedIn().transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.rootFound).toBe(true);
  });

  it("returns exactly one observation per declared page", async () => {
    const walked = unwrap(
      await walkJamApplication({ transport: signedIn().transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.pages).toHaveLength(jamPageWalkSpec().pages.length);
  });

  it("asks for every page at the settle this atlas chose", async () => {
    const fake = signedIn();
    await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.asked.filter((visit) => visit.settleMs !== JAM_PAGE_SETTLE_MS)).toEqual([]);
  });

  // Every declared page IS photographed here, and deliberately: the not-found oracle is measured off a
  // screenshot's own size, so a refused picture would silently disarm the check that keeps grading honest.
  it("photographs every page, because the not-found oracle is measured off the bytes", async () => {
    const fake = signedIn();
    await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.asked.filter((visit) => visit.photographed === false)).toEqual([]);
  });

  // The review's counterexample: both controls hang off the bare origin, so a walk that learned no team root
  // still photographs them, and they corroborate — while no application page was ever addressed.
  it("refuses a walk that learned no team root, even though both controls were photographed and agree", async () => {
    const fake = fakeTransport({
      answer: ({ url }) => {
        if (url === PROBE_URL) {
          return { capture: { ...JAM_PAGE, finalUrl: `${JAM_WEB_ORIGIN}/welcome` } };
        }
        return { capture: { ...JAM_PAGE, screenshotPng: renderedPng() } };
      },
    });
    const walked = await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(fake.visited).toContain(`${JAM_WEB_ORIGIN}${JAM_INVENTED_ROUTE}`);
    expect(unwrapErr(walked)).toEqual([
      "the walk learned no team root — jam.dev did not settle on an address under /s/ — so no application page was addressed, and the two not-found controls, which hang off the bare origin, prove nothing about one",
      "nothing was published. Open jam.dev in your own Chrome, check it settles under /s/, and run the walk again",
    ]);
  });

  it("tells the owner to check that jam.dev settles under /s/ on every page it could not address", () => {
    expect(jamPageWalkSpec().rootMissingBecause).toContain("an address under /s/");
  });

  it("refuses to start when the application answers its own root with the sign-in page", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { ...JAM_PAGE, finalUrl: `${JAM_WEB_ORIGIN}/login` } } },
    });
    const walked = await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)[0]).toContain("no page could be walked");
  });

  it("refuses when the application could not be reached at all", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } } },
    });
    const walked = await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)[0]).toContain("the relay stopped answering");
  });

  it("prints the sign-in refusal as exactly two lines", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { ...JAM_PAGE, finalUrl: `${JAM_WEB_ORIGIN}/login` } } },
    });
    const walked = await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      "the Jam application answered its own root with its sign-in page, so no page could be walked",
      "sign in to Jam in your own Chrome and run the walk again",
    ]);
  });

  it("quotes the transport's reason for an unreachable application as one line", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } } },
    });
    const walked = await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write });
    expect(unwrapErr(walked)).toEqual([
      "could not reach the Jam application to learn its team root: the relay stopped answering",
    ]);
  });

  // The regrade is what stops nine rendered not-found pages being published as reached routes. Here both
  // controls carry DIFFERENT pictures, so the oracle cannot fire and says which way it failed.
  it("carries no control failure out of a walk whose controls corroborate, because there is nothing to explain", async () => {
    const walked = unwrap(
      await walkJamApplication({ transport: signedIn().transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.controlFailure).toBe(null);
  });

  // The falsifiable half: the oracle compares the two CONTROLS' own pictures, so a declared control whose
  // picture differs from the invented one has to disarm rather than grade every page against it. Every other
  // page renders its OWN picture: one shared picture is the kit's duplicate-shot case, which strips the
  // invented control's screenshot and fails as `control-unphotographed` before the band is ever compared.
  it("types the failure as the band, and says why, when the two controls do not agree", async () => {
    const declaredControl = jamPageWalkSpec().pages.find(
      (declared) => declared.surface === JAM_NOT_FOUND_CONTROL_SURFACE,
    )!;
    const fake = fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { ...JAM_PAGE, finalUrl: LANDED } };
        }
        if (url === `${JAM_WEB_ORIGIN}${declaredControl.path}`) {
          return { capture: { ...JAM_PAGE, screenshotPng: pngOfSize({ byteLength: 4_000, height: 8, width: 8 }) } };
        }
        return { capture: { ...JAM_PAGE, screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
    const walked = unwrap(
      await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(walked.controlFailure!.cause).toBe("band");
    expect(walked.controlFailure!.because).toContain("do not corroborate each other");
  });

  // The same ordering through the real kit: `/404` is visited first, its visit stops the walk, and the kit
  // itself writes the invented control's never-attempted row — so the test cannot retype the kit's sentence.
  it("names the /404 visit that stopped the walk, not the invented control it never reached", async () => {
    const declaredControl = jamPageWalkSpec().pages.find(
      (declared) => declared.surface === JAM_NOT_FOUND_CONTROL_SURFACE,
    )!;
    const fake = fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { ...JAM_PAGE, finalUrl: LANDED } };
        }
        if (url === `${JAM_WEB_ORIGIN}${declaredControl.path}`) {
          return { failWith: { code: "TRANSPORT_UNAVAILABLE", message: "the relay stopped answering" } };
        }
        return { capture: { ...JAM_PAGE, screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
    const walked = unwrap(
      await walkJamApplication({ transport: fake.transport, writeArtifact: recordingWriter().write }),
    );
    expect(fake.visited).toContain(`${JAM_WEB_ORIGIN}${declaredControl.path}`);
    expect(fake.visited).not.toContain(`${JAM_WEB_ORIGIN}${JAM_INVENTED_ROUTE}`);
    expect(walked.controlFailure).toEqual({
      because:
        "the control `not-found-control` was not reached at all: no browser transport was attached, so this page was never asked for",
      cause: "control-unreachable",
    });
  });

  it("names both controls in the declared inventory, or the regrade has nothing to compare", () => {
    const surfaces = jamPageWalkSpec().pages.map((declared) => declared.surface);
    expect(surfaces).toContain(JAM_NOT_FOUND_CONTROL_SURFACE);
    expect(surfaces).toContain(JAM_INVENTED_CONTROL_SURFACE);
  });

  it("hands each page's progress line to a caller that supplied one", async () => {
    const lines: string[] = [];
    await walkJamApplication({
      progress: ({ line }) => lines.push(line),
      transport: signedIn().transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines.length).toBeGreaterThan(0);
  });
});
