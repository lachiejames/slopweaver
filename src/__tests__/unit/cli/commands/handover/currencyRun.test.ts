/**
 * `handover currency`'s shell over a throwaway home: an empty board still writes a whole reading — every source it
 * could not read is named, never "nothing since" — and the verb refuses a mistyped flag before it reads anything.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { queueLogPath } from "../../../../../admit/queueStore.js";
import {
  type CurrencyDeps,
  currencyDocument,
  runHandoverCurrency,
} from "../../../../../cli/commands/handover/currencyRun.js";
import { readIntakeHalves } from "../../../../../cli/commands/handover/intakeHalves.js";
import { EXIT_OK, EXIT_USAGE } from "../../../../../cli/exitCodes.js";
import { buildHandStep, type HandStep } from "../../../../../hand/step.js";
import { appendHandRow } from "../../../../../hand/store.js";
import type { RunEvent } from "../../../../../handover/ledger.js";
import { appendRunEvent, runJournalPath } from "../../../../../handover/runStore.js";
import { err, ok, unwrap } from "../../../../../lib/result.js";
import { GithubLiveErrors } from "../../../../../live/github/errors.js";
import { stateHomePaths } from "../../../../../stateHome.js";

const NOW = "2026-10-02T12:00:00.000Z";
const POSTED = "2026-10-02T11:00:00.000Z";
const minted: string[] = [];

/** One hand step waiting on the owner. */
function handStep(): HandStep {
  return unwrap(
    buildHandStep({
      draft: {
        id: "gcloud-signin",
        postedBy: "workspace:129",
        postedIso: POSTED,
        unblocks: "handover run datadog-monitor-deploy",
        url: "https://console.cloud.google.com/",
        what: "Sign in to Google Cloud so the monitor deploy can finish",
        witness: "slopweaver hand done gcloud-signin",
      },
    }),
  );
}

const freshHome = (): { home: string; handoverDir: string } => {
  const home = mkdtempSync(join(tmpdir(), "currency-"));
  minted.push(home);
  const handoverDir = join(home, "handovers");
  mkdirSync(handoverDir);
  return { handoverDir, home };
};

afterEach(() => {
  for (const dir of minted.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Pull-request reads that answer each address from a fixed table, recording what was asked. */
function fakePrDeps({ bodies, failure }: { bodies: ReadonlyMap<string, string>; failure?: string }): {
  deps: CurrencyDeps;
  asked: string[][];
} {
  const asked: string[][] = [];
  const projectsDir = mkdtempSync(join(tmpdir(), "currency-projects-"));
  minted.push(projectsDir);
  return {
    asked,
    deps: {
      readPrBodies: ({ addresses }) => {
        asked.push(addresses.map((address) => `${address.owner}/${address.repo}#${String(address.number)}`));
        if (failure !== undefined) {
          return Promise.resolve(err(GithubLiveErrors.readFailed({ message: failure })));
        }
        return Promise.resolve(ok(bodies));
      },
      repoSlugs: () => new Map(),
      standing: { projectsDir, readProfile: () => Promise.resolve({ kind: "absent" }) },
    },
  };
}

/** A board doc carrying one quote of the owner's. */
function quotedDoc({ slug, words, summary }: { slug: string; words: string; summary: string }): string {
  return [
    "---",
    `slug: ${slug}`,
    "kind: ask",
    "status: ready",
    `summary: ${summary}`,
    "anchor: transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433",
    `ownerWords: ${JSON.stringify(words)}`,
    'ownerWordsAnchor: "transcript:a0000032-0000-4000-8000-000000000035#0633bdef-34d9-48a7-92cf-8e02bd019433"',
    'ownerWordsIso: "2026-09-25T02:41:26.704Z"',
    "ownerWordsWhere: session",
    "ownerWordsCut: none",
    "---",
    "",
    "# body",
    "",
  ].join("\n");
}

const PR_URL = "https://github.com/acme/acme-admin/pull/17564";

describe("currencyDocument", () => {
  it("writes a whole reading over an empty board, checked at the verb's clock, asking GitHub nothing", async () => {
    const { asked, deps } = fakePrDeps({ bodies: new Map() });
    const built = await currencyDocument({ ...freshHome(), deps, nowIso: NOW });

    expect(built.kind).toBe("built");
    const { document } = built as Extract<typeof built, { kind: "built" }>;
    expect(document.checkedIso).toBe(NOW);
    expect(document.readFromIso).toBe("2026-10-01T12:00:00.000Z");
    expect(document.rows).toEqual([]);
    expect(document.said).toEqual({});
    expect(document.pullRequests).toEqual([]);
    expect(asked).toEqual([[]]);
  });

  it("publishes the gap for a pull request whose body lacks the proof the owner asked for", async () => {
    const { handoverDir, home } = freshHome();
    writeFileSync(
      join(handoverDir, "proof-row.md"),
      quotedDoc({
        slug: "proof-row",
        summary: `before-and-after proof for ${PR_URL}`,
        words: "i expected some screenshots and links to those runs in github",
      }),
    );
    const { asked, deps } = fakePrDeps({ bodies: new Map([["acme/acme-admin#17564", "## Summary\nno proof"]]) });

    const built = await currencyDocument({ deps, handoverDir, home, nowIso: NOW });
    const { document } = built as Extract<typeof built, { kind: "built" }>;

    expect(asked).toEqual([["acme/acme-admin#17564"]]);
    expect(document.sources.github).toBe("1 pull-request bodies read");
    expect(document.pullRequests.map((pr) => [pr.identity, pr.rowSlugs, pr.proof.kind])).toEqual([
      ["acme/acme-admin#17564", ["proof-row"], "requested-and-unmet"],
    ]);
  });

  it("calls every asked body unread when GitHub could not be read, and still writes the reading", async () => {
    const { handoverDir, home } = freshHome();
    writeFileSync(
      join(handoverDir, "proof-row.md"),
      quotedDoc({ slug: "proof-row", summary: PR_URL, words: "I need a screenshot of the CI run" }),
    );
    const { deps } = fakePrDeps({ bodies: new Map(), failure: "rate limited" });

    const built = await currencyDocument({ deps, handoverDir, home, nowIso: NOW });
    const { document } = built as Extract<typeof built, { kind: "built" }>;

    expect(built.kind).toBe("built");
    expect(document.pullRequests.map((pr) => pr.proof)).toEqual([
      expect.objectContaining({ kind: "body-unread", why: "rate limited" }),
    ]);
  });

  it("writes a schema-3 row for a hand step waiting on the owner, keyed and floored the way the console stamps its card", async () => {
    const { handoverDir, home } = freshHome();
    unwrap(await appendHandRow({ home, nowIso: POSTED, row: { kind: "posted", step: handStep() } }));
    const { deps } = fakePrDeps({ bodies: new Map() });

    const built = await currencyDocument({ deps, handoverDir, home, nowIso: NOW });
    const { document } = built as Extract<typeof built, { kind: "built" }>;

    expect(document.schemaVersion).toBe(3);
    expect([document.sources.memory, document.sources.profile, document.sources.rulings]).toEqual([
      "0 memories read across 0 projects",
      "no owner profile recorded",
      "0 rulings read; 0 gates in force across 0 run journals",
    ]);
    expect(document.rows.map(({ fact, floorIso, key }) => ({ fact, floorIso, key }))).toEqual([
      {
        fact: { atIso: NOW, by: "the hand register still holding it", kind: "confirmed" },
        floorIso: POSTED,
        key: "hand:gcloud-signin",
      },
    ]);
  });

  it("covers a run waiting on the owner whose doc left the board, as the detached ask the Queue draws", async () => {
    const { handoverDir, home } = freshHome();
    const runsDir = stateHomePaths({ home }).runs;
    for (const event of [
      { atIso: "2026-10-02T10:00:00.000Z", branch: "b", docHash: "h", kind: "started" },
      { atIso: POSTED, kind: "question", question: "Ship it?" },
    ] satisfies RunEvent[]) {
      unwrap(appendRunEvent({ event, runsDir, slug: "doc-gone" }));
    }
    const { deps } = fakePrDeps({ bodies: new Map() });

    const built = await currencyDocument({ deps, handoverDir, home, nowIso: NOW });
    const { document } = built as Extract<typeof built, { kind: "built" }>;

    expect(built.kind).toBe("built");
    expect(document.rows.map(({ fact, floorIso, key }) => ({ fact, floorIso, key }))).toEqual([
      {
        fact: { kind: "not-confirmed", why: "nothing has re-confirmed it since it was asked" },
        floorIso: POSTED,
        key: "ask:doc-gone",
      },
    ]);
  });

  it("still writes the reading over a board file or run journals that will not read, none of which draws a card", async () => {
    const { handoverDir, home } = freshHome();
    writeFileSync(join(handoverDir, "broken.md"), "---\nslug: [\n---\n");
    writeFileSync(
      join(handoverDir, "proof-row.md"),
      quotedDoc({ slug: "proof-row", summary: "no pull request", words: "check it" }),
    );
    const runsDir = stateHomePaths({ home }).runs;
    mkdirSync(runsDir, { recursive: true });
    writeFileSync(runJournalPath({ runsDir, slug: "doc-gone" }), "{not json\n");
    writeFileSync(runJournalPath({ runsDir, slug: "proof-row" }), "{not json\n");
    const { deps } = fakePrDeps({ bodies: new Map() });

    const built = await currencyDocument({ deps, handoverDir, home, nowIso: NOW });

    expect(built.kind).toBe("built");
    expect((built as Extract<typeof built, { kind: "built" }>).document.rows).toEqual([]);
  });

  it("writes no reading at all when a card register passed over a line, rather than one missing that card", async () => {
    const { handoverDir, home } = freshHome();
    mkdirSync(join(home, "queue"), { recursive: true });
    writeFileSync(queueLogPath({ home }), "{not json\n");
    const { deps } = fakePrDeps({ bodies: new Map() });

    const built = await currencyDocument({ deps, handoverDir, home, nowIso: NOW });

    expect(built).toEqual({
      kind: "unreadable",
      why: "the held-reply queue passed over 1 line(s) it could not read, so a card may be missing",
    });
  });
});

describe("readIntakeHalves", () => {
  it("reads both halves from one floor, and a chair with no chain as reaching nothing back", () => {
    const { handoverDir, home } = freshHome();
    const halves = readIntakeHalves({
      docs: [],
      handoverDir,
      home,
      journals: new Map(),
      nowIso: NOW,
      sinceIso: "2026-10-01T12:00:00.000Z",
    });

    expect(halves.voice).toEqual({ kind: "read", relays: [] });
    expect(halves.intake).toMatchObject({
      finding: { coverage: { earliestIso: undefined, linksKnown: 0, reachesSince: false, unreadable: [] }, turns: [] },
      kind: "read",
    });
  });
});

describe("runHandoverCurrency", () => {
  it("prints its usage on --help", async () => {
    expect(await runHandoverCurrency(["node", "slopweaver", "handover", "currency", "--help"])).toBe(EXIT_OK);
  });

  it("refuses an unknown flag as a usage mistake", async () => {
    expect(await runHandoverCurrency(["node", "slopweaver", "handover", "currency", "--nope"])).toBe(EXIT_USAGE);
  });
});
