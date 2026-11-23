/*
 * The pull-requests page's open panel holds a repository AND a number, so two repositories' same number open two panels
 * rather than whichever row the reading lists first, and a number with no repository opens nothing (the
 * repository-qualified Queue key).
 */

import { describe, expect, it } from "vitest";

import { linkedPullKeyOf, openedRowOf, openParamOf } from "../../components/live/PullRequestsOpen";
import { ACME_PLACER } from "../organisationFixture";
import { ACME_ADMIN, ACME_WEB, acmeRow, landingReading, uncensusedRow, WITH_DRAFTS } from "./landingReadingFixture";

const READY = {
  fixture: undefined,
  observedAtIso: "2026-11-03T20:50:00.000Z",
  phase: "ready",
  stampedByRoute: false,
  value: landingReading({
    census: undefined,
    rows: [acmeRow({ number: 42 }), uncensusedRow({ number: 42 })],
    selection: WITH_DRAFTS,
  }),
} as const;

const EVERYWHERE = (): boolean => true;

describe("openParamOf", () => {
  it("reads the repository and number, and nothing from a link missing either", () => {
    expect([
      openParamOf({ params: new URLSearchParams("open=42&repo=acme%2Facme-web") }),
      openParamOf({ params: new URLSearchParams("open=42") }),
      openParamOf({ params: new URLSearchParams("open=42&repo=") }),
      openParamOf({ params: new URLSearchParams("open=x&repo=acme%2Facme-web") }),
      openParamOf({ params: new URLSearchParams("repo=acme%2Facme-web") }),
      openParamOf({ params: new URLSearchParams("") }),
    ]).toStrictEqual([{ number: 42, repoSlug: ACME_WEB }, undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("linkedPullKeyOf", () => {
  it("tells two repositories' same number apart, so a second deep link reopens the panel in place", () => {
    const links = ["open=42&repo=acme%2Facme-web", "open=42&repo=acme%2Facme-admin", "open=42", ""];
    expect(
      links.map((link) => linkedPullKeyOf({ linked: openParamOf({ params: new URLSearchParams(link) }) })),
    ).toEqual(["acme/acme-web#42", "acme/acme-admin#42", "", ""]);
  });
});

describe("openedRowOf", () => {
  it("opens the row of the repository pressed, never the first same-numbered row the reading lists", () => {
    const opened = [ACME_ADMIN, ACME_WEB].map(
      (repoSlug) =>
        openedRowOf({ opened: { number: 42, repoSlug }, placer: ACME_PLACER, shows: EVERYWHERE, state: READY })
          ?.repoSlug,
    );
    expect(opened).toStrictEqual([ACME_ADMIN, ACME_WEB]);
  });

  it("opens nothing for a repository the reading does not hold", () => {
    expect(
      openedRowOf({
        opened: { number: 42, repoSlug: "acme/other" },
        placer: ACME_PLACER,
        shows: EVERYWHERE,
        state: READY,
      }),
    ).toBe(undefined);
  });
});
