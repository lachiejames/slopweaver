/**
 * `orgHealth/investigationRead.ts` — the registers `org-health status`'s findings pointer is judged against, read the way the
 * Queue reads them: a notice draws no card, and a card the owner's spoken words landed on is held off.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { appendHandRow } from "../../../hand/store.js";
import { unwrap } from "../../../lib/result.js";
import { readInvestigations } from "../../../orgHealth/investigationRead.js";
import { appendCardLanding } from "../../../talk/cardLandingStore.js";
import { orgIncident } from "./orgIncidentFixture.js";

/** INC-98 with the channel its note's id is minted from. */
const INC_34 = orgIncident({ over: { channelId: "C0SYNINC34CHAN" } });

/** The row investigating INC-98, seated and running. */
const SLUG = "incident-inc-98-checkout";

describe("readInvestigations", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "org-health-investigation-"));
    mkdirSync(join(home, "handovers"));
    mkdirSync(join(home, "runs"));
    writeFileSync(
      join(home, "handovers", `${SLUG}.md`),
      [
        "---",
        `slug: ${SLUG}`,
        "kind: ask",
        `summary: "Why checkout fails: ${INC_34.homepageUrl} is investigated."`,
        "status: ready",
        "askedIso: 2026-10-04T08:10:00.000Z",
        "blockedBy: []",
        "artifact: null",
        "doneWhen: []",
        "---",
        "",
        "# checkout",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(home, "runs", `${SLUG}.jsonl`),
      `${JSON.stringify({ atIso: "2026-10-04T08:30:00.000Z", branch: "b", docHash: "abc", kind: "started" })}\n`,
    );
  });
  afterEach(() => {
    rmSync(home, { force: true, recursive: true });
  });

  /** Post the incident's note on the row, as `incident note` would — or as a notice, which the Queue never draws. */
  const postNote = async ({ notice }: { notice: boolean }): Promise<void> => {
    unwrap(
      await appendHandRow({
        home,
        nowIso: "2026-10-04T08:40:00.000Z",
        row: {
          kind: "posted",
          step: {
            id: "inc-c0syninc34chan-r1",
            postedBy: "unnamed-session",
            postedIso: "2026-10-04T08:40:00.000Z",
            row: SLUG,
            unblocks: "the INC-98 write-up reaching the incident channel",
            url: "http://localhost:3000/view?src=%2Fapi%2Fpage%2Finc-98-receipts%2Findex.html&back=%2Fqueue",
            what: "Share the incident's write-up in its thread (INC-98)?",
            witness: "slopweaver hand done inc-c0syninc34chan-r1",
            ...(notice ? { notice: true as const } : {}),
          },
        },
      }),
    );
  };

  const investigation = (): unknown => readInvestigations({ home, open: [INC_34] }).get("INC-98");

  it("reads the incident's note up on the row as findings on its hand card", async () => {
    await postNote({ notice: false });
    expect(investigation()).toMatchObject({ open: "hand:inc-c0syninc34chan-r1", slug: SLUG, state: "findings" });
  });

  it("never reads a notice as findings, since the Queue draws no card for one", async () => {
    await postNote({ notice: true });
    expect(investigation()).toMatchObject({ lastMovedIso: "2026-10-04T08:30:00.000Z", state: "looking" });
  });

  it("reads the note as lined up once the owner's spoken words land on its card", async () => {
    await postNote({ notice: false });
    unwrap(
      appendCardLanding({
        home,
        row: {
          anchor: "talk:a0000004-0000-4000-8000-000000000004",
          atIso: "2026-10-04T08:50:00.000Z",
          cardKey: "hand:inc-c0syninc34chan-r1",
          decidedIso: "2026-10-04T08:50:00.000Z",
          kind: "landed",
          source: "transcript",
          words: "share it",
          workSlug: "card-share-it",
        },
      }),
    );
    expect(investigation()).toMatchObject({ slug: SLUG, state: "lined-up" });
  });
});
