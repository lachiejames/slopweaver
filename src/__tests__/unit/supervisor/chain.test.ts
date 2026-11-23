import { describe, expect, it } from "vitest";

import {
  buildSupervisorLink,
  type ChainCoverage,
  chainReachesSince,
  chainSpans,
  coverageClause,
  orderChain,
  parseSupervisorChainJournal,
  parseSupervisorLinkLine,
  type SupervisorLink,
  spansSince,
} from "../../../supervisor/chain.js";

const S1 = "a0000013-0000-4000-8000-000000000014";
const S2 = "b3f532df-83e5-495b-b5b8-8b8c3e54d512";
const S3 = "feedb3d7-7ab0-4cac-818b-13bdb201b514";

/** The built link, or a throw carrying the refusal — so no assertion here has to branch. */
function built({
  id,
  pinnedAtIso,
  source,
}: {
  id: string;
  pinnedAtIso: string;
  source: SupervisorLink["source"];
}): SupervisorLink {
  const result = buildSupervisorLink({
    pinnedAtIso,
    session: { host: "codex", id },
    source,
    workspaceId: "B731E026",
    workspaceRef: "workspace:266",
  });
  if ("refusal" in result) {
    throw new Error(result.refusal);
  }
  return result.link;
}

/** The refusal, or a throw when the build unexpectedly succeeded. */
function refusalOf({ id, pinnedAtIso }: { id: string; pinnedAtIso: string }): string {
  const result = buildSupervisorLink({
    pinnedAtIso,
    session: { host: "claude-code", id },
    source: "scan",
    workspaceId: "",
    workspaceRef: "",
  });
  if ("link" in result) {
    throw new Error("expected a refusal, got a link");
  }
  return result.refusal;
}

/** One Claude Code link, overridable field by field; `host` names the other host when a case needs it. */
const link = ({
  id,
  host = "claude-code",
  ...over
}: Partial<SupervisorLink> & { id: string; host?: "claude-code" | "codex"; pinnedAtIso: string }): SupervisorLink => ({
  session: { host, id },
  source: "pin",
  workspaceId: "B731E026",
  workspaceRef: "workspace:266",
  ...over,
});

const coverage = (over: Partial<ChainCoverage> = {}): ChainCoverage => ({
  earliestIso: "2026-08-28T00:00:00.000Z",
  linksKnown: 3,
  reachesSince: true,
  unreadable: [],
  walked: [S1, S2, S3],
  ...over,
});

describe("parsing a chain journal", () => {
  it("round-trips a link written by the pin verb", () => {
    const line = JSON.stringify(link({ id: S1, pinnedAtIso: "2026-09-05T10:12:46.544Z" }));

    expect(parseSupervisorLinkLine({ line })).toEqual({
      pinnedAtIso: "2026-09-05T10:12:46.544Z",
      session: { host: "claude-code", id: S1 },
      source: "pin",
      workspaceId: "B731E026",
      workspaceRef: "workspace:266",
    });
  });

  it("reads a pre-Codex line's `claudeSessionId` as Claude, and refuses a line carrying both shapes", () => {
    const { session, ...rest } = link({ id: S1, pinnedAtIso: "2026-09-05T10:12:46.544Z" });

    expect(parseSupervisorLinkLine({ line: JSON.stringify({ ...rest, claudeSessionId: session.id }) })).toEqual({
      ...rest,
      session: { host: "claude-code", id: S1 },
    });
    const both = JSON.stringify({ ...rest, claudeSessionId: S1, session });

    expect(parseSupervisorLinkLine({ line: both })).toBeUndefined();
  });

  it("refuses a link with no session id, since the id is the transcript it names", () => {
    const line = JSON.stringify(link({ id: "  ", pinnedAtIso: "2026-09-05T10:12:46.544Z" }));

    expect(parseSupervisorLinkLine({ line })).toBeUndefined();
  });

  it("refuses a link whose instant will not parse, since nothing can order it", () => {
    const line = JSON.stringify(link({ id: S1, pinnedAtIso: "yesterday" }));

    expect(parseSupervisorLinkLine({ line })).toBeUndefined();
  });

  it("refuses a link whose source is not one of the two", () => {
    const line = JSON.stringify({
      ...link({ id: S1, pinnedAtIso: "2026-09-05T10:12:46.544Z" }),
      source: "guessed",
    });

    expect(parseSupervisorLinkLine({ line })).toBeUndefined();
  });

  it("skips a line that will not decode rather than failing the whole journal", () => {
    const good = JSON.stringify(link({ id: S1, pinnedAtIso: "2026-09-05T10:12:46.544Z" }));
    const text = `${good}\nnot json at all\n\n${JSON.stringify({ claudeSessionId: S2 })}\n`;

    expect(parseSupervisorChainJournal({ text }).map((item) => item.session.id)).toEqual([S1]);
  });
});

describe("buildSupervisorLink", () => {
  it("trims the session id and keeps the workspace a human can open", () => {
    const made = built({ id: `  ${S1}  `, pinnedAtIso: "2026-09-05T10:12:46.544Z", source: "pin" });

    expect(made.session).toStrictEqual({ host: "codex", id: S1 });
    expect(made.workspaceRef).toBe("workspace:266");
  });

  it("refuses a blank session id with a reason naming what makes a link checkable", () => {
    expect(refusalOf({ id: "", pinnedAtIso: "2026-09-05T10:12:46.544Z" })).toBe(
      "a chain link needs a session id — the transcript it names is what makes it checkable",
    );
  });

  it("refuses an instant that will not parse", () => {
    expect(refusalOf({ id: S1, pinnedAtIso: "not-a-time" })).toContain("is not an instant");
  });
});

describe("orderChain", () => {
  it("puts the links in succession order whatever order the journal held them", () => {
    const ordered = orderChain({
      links: [
        link({ id: S3, pinnedAtIso: "2026-09-05T02:00:00.000Z" }),
        link({ id: S1, pinnedAtIso: "2026-08-28T09:00:00.000Z" }),
        link({ id: S2, pinnedAtIso: "2026-09-04T22:00:00.000Z" }),
      ],
    });

    expect(ordered.map((item) => item.session.id)).toEqual([S1, S2, S3]);
  });

  it("keeps ONE link per session at its EARLIEST instant, so a re-pin drops no turn in between", () => {
    const ordered = orderChain({
      links: [
        link({ id: S1, pinnedAtIso: "2026-09-05T06:00:00.000Z" }),
        link({ id: S1, pinnedAtIso: "2026-09-05T01:00:00.000Z" }),
      ],
    });

    expect(ordered.length).toBe(1);
    expect(ordered[0]!.pinnedAtIso).toBe("2026-09-05T01:00:00.000Z");
  });

  it("keeps a Claude session and a Codex thread sharing one opaque id as TWO links", () => {
    const ordered = orderChain({
      links: [
        link({ id: S1, pinnedAtIso: "2026-09-05T01:00:00.000Z" }),
        link({ host: "codex", id: S1, pinnedAtIso: "2026-09-05T06:00:00.000Z" }),
      ],
    });

    expect(ordered.map((item) => item.session)).toEqual([
      { host: "claude-code", id: S1 },
      { host: "codex", id: S1 },
    ]);
  });

  it("lets a pin link's workspace outrank a scan link's blanks for the same session", () => {
    const ordered = orderChain({
      links: [
        link({
          id: S1,
          pinnedAtIso: "2026-09-05T01:00:00.000Z",
          source: "scan",
          workspaceId: "",
          workspaceRef: "",
        }),
        link({ id: S1, pinnedAtIso: "2026-09-05T01:05:00.000Z" }),
      ],
    });

    expect(ordered[0]!.source).toBe("pin");
    expect(ordered[0]!.workspaceRef).toBe("workspace:266");
    expect(ordered[0]!.pinnedAtIso).toBe("2026-09-05T01:00:00.000Z");
  });
});

describe("chainSpans", () => {
  const ordered = orderChain({
    links: [
      link({ id: S1, pinnedAtIso: "2026-08-28T09:00:00.000Z" }),
      link({ id: S2, pinnedAtIso: "2026-09-04T22:00:00.000Z" }),
      link({ id: S3, pinnedAtIso: "2026-09-05T02:00:00.000Z" }),
    ],
  });

  it("ends each span where its successor took over, and leaves the last one open", () => {
    const spans = chainSpans({ links: ordered });

    expect(spans.map((span) => span.untilIso)).toEqual([
      "2026-09-04T22:00:00.000Z",
      "2026-09-05T02:00:00.000Z",
      undefined,
    ]);
  });

  it("keeps every span still current at the floor and drops the one that had already handed over", () => {
    const kept = spansSince({ sinceIso: "2026-09-04T23:00:00.000Z", spans: chainSpans({ links: ordered }) });

    expect(kept.map((span) => span.link.session.id)).toEqual([S2, S3]);
  });

  it("keeps the whole chain when no floor is asked for", () => {
    expect(spansSince({ sinceIso: undefined, spans: chainSpans({ links: ordered }) }).length).toBe(3);
  });
});

describe("chainReachesSince", () => {
  const ordered = orderChain({ links: [link({ id: S1, pinnedAtIso: "2026-09-05T10:00:00.000Z" })] });

  it("says an empty chain reaches nothing, so a chain that knows nothing never reads clean", () => {
    expect(chainReachesSince({ links: [], sinceIso: undefined })).toBe(false);
  });

  it("says a chain starting AFTER the floor does not reach it — the measured week-audit lie", () => {
    expect(chainReachesSince({ links: ordered, sinceIso: "2026-08-28T00:00:00.000Z" })).toBe(false);
  });

  it("says a chain starting at or before the floor reaches it", () => {
    expect(chainReachesSince({ links: ordered, sinceIso: "2026-09-05T10:00:00.000Z" })).toBe(true);
    expect(chainReachesSince({ links: ordered, sinceIso: "2026-09-05T18:00:00.000Z" })).toBe(true);
  });
});

describe("coverageClause", () => {
  it("says NOTHING was read when no chain is recorded, and names the verb that fixes it", () => {
    expect(coverageClause({ coverage: coverage({ linksKnown: 0, walked: [] }) })).toBe(
      "No supervisor chain is recorded, so NOTHING was read — rebuild it with `slopweaver supervisor chain --rescan`.",
    );
  });

  it("is SILENT only when the whole window was walked", () => {
    expect(coverageClause({ coverage: coverage() })).toBe("");
  });

  it("names the instant a short chain starts at, rather than reporting a clean week", () => {
    expect(
      coverageClause({ coverage: coverage({ earliestIso: "2026-09-05T10:00:00.000Z", reachesSince: false }) }),
    ).toBe(
      "Chain coverage: 3 session(s) walked, but the chain starts at 2026-09-05T10:00:00.000Z, so anything " +
        "earlier was NOT read — `slopweaver supervisor chain --rescan`.",
    );
  });

  it("counts the sessions it could not walk, and reports both gaps together", () => {
    expect(
      coverageClause({
        coverage: coverage({
          earliestIso: "2026-09-05T10:00:00.000Z",
          reachesSince: false,
          unreadable: [{ claudeSessionId: S2, untilIso: undefined, why: "no transcript" }],
        }),
      }),
    ).toBe(
      "Chain coverage: 3 session(s) walked, but the chain starts at 2026-09-05T10:00:00.000Z, so anything " +
        "earlier was NOT read, and 1 session(s) could not be walked — `slopweaver supervisor chain --rescan`.",
    );
  });
});
