/**
 * Inngest's own five decisions about walking its dashboard. The ENGINE's behaviour — the four-way
 * accounting, the lost-session stop, the duplicate-picture check, the artifact addressing — is
 * `kit/pageWalk/`.
 *
 * What is left here is what a reader would get wrong about Inngest specifically: the environment slug is
 * LEARNED from where the client lands rather than configured, a sign-in landing STOPS the whole walk, and no
 * settled path is ever quoted into a reason because it can carry the environment slug, an app's external id
 * or a function slug.
 */
import { describe, expect, it } from "vitest";

import { unwrap, unwrapErr } from "#lib/result.js";
import { INNGEST_APP_ORIGIN, type InngestBrowserPage } from "../../../../atlas/inngest/browserPages.js";
import {
  environmentSlugFromFinalUrl,
  INNGEST_PAGE_SETTLE_MS,
  inngestPageOutcome,
  inngestPageWalkSpec,
  walkInngestDashboard,
} from "../../../../atlas/inngest/browserWalk.js";

import { renderedPng } from "../../../pngFixture.js";
import { capture, fakeTransport, recordingWriter } from "../../../walkTransportFake.js";

const PROBE_URL = `${INNGEST_APP_ORIGIN}/`;
const ENV = "production";
const PAGE_URL = `${INNGEST_APP_ORIGIN}/env/${ENV}/apps`;

/** Two declared pages: one that hangs off an environment, one that does not. */
const PAGES: readonly InngestBrowserPage[] = [
  { section: "apps", surface: "/env/$envSlug/apps" },
  { section: "settings", surface: "/settings/billing" },
];

const artifactPathFor = ({ sha256 }: { sha256: string }): string => `artifacts/pages/${sha256}.png`;

describe("environmentSlugFromFinalUrl", () => {
  it("reads the slug out of the /env/<slug>/… shape the client lands on", () => {
    expect(environmentSlugFromFinalUrl({ finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` })).toBe(ENV);
  });

  it("reads the slug from a bare environment root with nothing after it", () => {
    expect(environmentSlugFromFinalUrl({ finalUrl: `${INNGEST_APP_ORIGIN}/env/staging` })).toBe("staging");
  });

  it("tolerates a trailing slash, which is what the client's own redirect writes", () => {
    expect(environmentSlugFromFinalUrl({ finalUrl: `${INNGEST_APP_ORIGIN}/env/staging/` })).toBe("staging");
  });

  it("answers with nothing when the landing has no environment segment at all", () => {
    expect(environmentSlugFromFinalUrl({ finalUrl: `${INNGEST_APP_ORIGIN}/settings/billing` })).toBe(null);
  });

  it("answers with nothing when /env is the whole path and names no environment", () => {
    expect(environmentSlugFromFinalUrl({ finalUrl: `${INNGEST_APP_ORIGIN}/env` })).toBe(null);
  });

  it("answers with nothing for an address it cannot read", () => {
    expect(environmentSlugFromFinalUrl({ finalUrl: "::::" })).toBe(null);
  });
});

describe("inngestPageOutcome", () => {
  it("holds a page the client settled on exactly", () => {
    expect(inngestPageOutcome({ capture: capture({ over: {}, url: PAGE_URL }), requestedUrl: PAGE_URL })).toEqual({
      redirected: false,
      unreachableBecause: null,
    });
  });

  it("tolerates a query string, because the client restores its own view state", () => {
    const settled = capture({ over: { finalUrl: `${PAGE_URL}?archived=true` }, url: PAGE_URL });
    expect(inngestPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).redirected).toBe(false);
  });

  it("treats a trailing slash as the same address", () => {
    const settled = capture({ over: { finalUrl: `${PAGE_URL}/` }, url: PAGE_URL });
    expect(inngestPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toBe(null);
  });

  it("recognises the sign-in page before the path rule, so a lost session is not a moved page", () => {
    const settled = capture({ over: { finalUrl: `${INNGEST_APP_ORIGIN}/sign-in` }, url: PAGE_URL });
    expect(inngestPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toContain(
      "no longer signed in",
    );
  });

  it("names the origin when the client settled somewhere else entirely", () => {
    const settled = capture({ over: { finalUrl: "https://www.inngest.com/pricing" }, url: PAGE_URL });
    expect(inngestPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause).toContain(
      "https://www.inngest.com",
    );
  });

  it("records a same-origin move as unreachable and says what it answered", () => {
    const settled = capture({
      over: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/functions`, statusCode: 200 },
      url: PAGE_URL,
    });
    const because = inngestPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause;
    expect(because).toContain("did not keep this address");
    expect(because).toContain("200");
  });

  // A settled path can carry the environment slug, an app's external id or a function slug.
  it("never quotes the settled PATH, only its origin", () => {
    const settled = capture({
      over: { finalUrl: `${INNGEST_APP_ORIGIN}/env/our-internal-env-name/apps/app_private` },
      url: PAGE_URL,
    });
    const because = inngestPageOutcome({ capture: settled, requestedUrl: PAGE_URL }).unreachableBecause;
    expect(because).not.toContain("our-internal-env-name");
    expect(because).not.toContain("app_private");
  });

  it("refuses an address it cannot read rather than grading it reached", () => {
    const settled = capture({ over: { finalUrl: "::::" }, url: PAGE_URL });
    expect(inngestPageOutcome({ capture: settled, requestedUrl: PAGE_URL })).toEqual({
      redirected: true,
      unreachableBecause: "the browser settled on an address this atlas cannot read",
    });
  });
});

describe("inngestPageWalkSpec", () => {
  const spec = inngestPageWalkSpec({ artifactPathFor, pages: PAGES });

  it("walks exactly the pages it was handed, rather than a list of its own", () => {
    expect(spec.pages).toBe(PAGES);
  });

  it("reads a settle on the sign-in page as the session ending", () => {
    const settled = capture({ over: { finalUrl: `${INNGEST_APP_ORIGIN}/sign-in` }, url: PAGE_URL });
    expect(spec.sessionLostOn({ capture: settled })).toBe(true);
  });

  it("reads an ordinary settle as the session continuing", () => {
    expect(spec.sessionLostOn({ capture: capture({ over: {}, url: PAGE_URL }) })).toBe(false);
  });

  it("cannot address an environment page with no environment", () => {
    expect(spec.urlFor({ page: PAGES[0]!, root: null })).toBe(null);
  });

  it("fills the environment segment in when there is one", () => {
    expect(spec.urlFor({ page: PAGES[0]!, root: ENV })).toBe(PAGE_URL);
  });

  it("addresses a page that hangs off no environment even with none", () => {
    expect(spec.urlFor({ page: PAGES[1]!, root: null })).toBe(`${INNGEST_APP_ORIGIN}/settings/billing`);
  });

  // Eight seconds, because the dashboard renders every list from GraphQL calls made after first paint —
  // a short settle photographs a skeleton AND loses the surface this walk exists to find.
  it("lets a page settle for eight seconds", () => {
    expect(spec.settleMs).toBe(INNGEST_PAGE_SETTLE_MS);
  });
});

describe("walkInngestDashboard learns the environment from where the client lands", () => {
  it("asks for the bare origin first, purely to learn the environment", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } } },
    });
    await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited[0]).toBe(PROBE_URL);
  });

  it("addresses every environment page with the slug it learned", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } } },
    });
    await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited).toContain(PAGE_URL);
  });

  it("reports it found an environment", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } } },
    });
    const walked = unwrap(
      await walkInngestDashboard({
        artifactPathFor,
        pages: PAGES,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.rootFound).toBe(true);
  });

  it("records an environment page as never attempted when the landing named no environment", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/settings/billing` } } },
    });
    const walked = unwrap(
      await walkInngestDashboard({
        artifactPathFor,
        pages: PAGES,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages.find((page) => page.surface === PAGES[0]!.surface)!.attempted).toBe(false);
  });

  it("still walks the page that hangs off no environment when there is none", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/settings/billing` } } },
    });
    const walked = unwrap(
      await walkInngestDashboard({
        artifactPathFor,
        pages: PAGES,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages.find((page) => page.surface === PAGES[1]!.surface)!.attempted).toBe(true);
  });

  it("names the missing environment on a page it could not address", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/settings/billing` } } },
    });
    const walked = unwrap(
      await walkInngestDashboard({
        artifactPathFor,
        pages: PAGES,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages.find((page) => page.surface === PAGES[0]!.surface)!.unreachableBecause).toContain(
      "hangs off an environment",
    );
  });

  it("returns exactly one observation per declared page", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } } },
    });
    const walked = unwrap(
      await walkInngestDashboard({
        artifactPathFor,
        pages: PAGES,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.pages).toHaveLength(PAGES.length);
  });

  it("asks for every page at the settle this atlas chose", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } } },
    });
    await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.asked.filter((visit) => visit.settleMs !== INNGEST_PAGE_SETTLE_MS)).toEqual([]);
  });

  it("writes a screenshot for every page it reached", async () => {
    const fake = fakeTransport({
      answer: ({ url, visitIndex }) => {
        if (url === PROBE_URL) {
          return { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } };
        }
        return { capture: { screenshotPng: renderedPng({ seed: visitIndex + 1 }) } };
      },
    });
    const writer = recordingWriter();
    await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: writer.write,
    });
    expect(writer.written).toHaveLength(PAGES.length);
  });

  it("hands each page's progress line to a caller that supplied one", async () => {
    const lines: string[] = [];
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } } },
    });
    await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      progress: ({ line }) => lines.push(line),
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(lines.length).toBeGreaterThan(0);
  });
});

describe("walkInngestDashboard refuses to walk a signed-out session", () => {
  it("refuses when the probe lands on the sign-in page", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/sign-in` } } },
    });
    const walked = await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[0]).toContain("no page could be walked");
  });

  it("tells the owner where to sign in", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/sign-in` } } },
    });
    const walked = await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[1]).toContain("sign in to Inngest in your own Chrome");
  });

  it("visits nothing after a sign-in landing", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/sign-in` } } },
    });
    await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(fake.visited).toEqual([PROBE_URL]);
  });

  it("refuses when the dashboard could not be reached at all, and quotes the transport's own reason", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } } },
    });
    const walked = await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)[0]).toContain("the relay stopped answering");
  });

  it("stops the whole walk when the session is lost mid-way", async () => {
    const fake = fakeTransport({
      answer: ({ url }) => {
        if (url === PROBE_URL) {
          return { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/env/${ENV}/apps` } };
        }
        return { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/sign-in` } };
      },
    });
    const walked = unwrap(
      await walkInngestDashboard({
        artifactPathFor,
        pages: PAGES,
        transport: fake.transport,
        writeArtifact: recordingWriter().write,
      }),
    );
    expect(walked.sessionLost).toBe(true);
  });
});

describe("walkInngestDashboard's refusals, line for line", () => {
  it("quotes an unreachable probe as exactly one line, having visited only the origin", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { failWith: { code: "SESSION_LOST", message: "the relay stopped answering" } } },
    });
    const walked = await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "could not reach the Inngest dashboard to learn its default environment: the relay stopped answering",
    ]);
    expect(fake.visited).toEqual(["https://app.inngest.com/"]);
  });

  it("refuses a sign-in landing as exactly its two lines", async () => {
    const fake = fakeTransport({
      visits: { [PROBE_URL]: { capture: { finalUrl: `${INNGEST_APP_ORIGIN}/sign-in` } } },
    });
    const walked = await walkInngestDashboard({
      artifactPathFor,
      pages: PAGES,
      transport: fake.transport,
      writeArtifact: recordingWriter().write,
    });
    expect(unwrapErr(walked)).toEqual([
      "the Inngest dashboard sent this browser to its sign-in page, so no page could be walked",
      "sign in to Inngest in your own Chrome and run the walk again",
    ]);
  });
});
