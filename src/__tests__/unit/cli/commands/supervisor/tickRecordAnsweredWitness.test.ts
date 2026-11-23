/**
 * The witness for an answered-triage incident: the approved-draft tick gate re-run over the records it read at the
 * tick (`../../../../answeredTriageHome.ts`), where it printed the draft line with the owner's emphatic yes bare and
 * listed `slack draft approve` first. It now prints the voice's needs-more-info question and the relay's verdict
 * beside the owner's words, and leads with the hold.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  approvedDraftRefusalLines,
  readApprovedDraftsLive,
} from "../../../../../cli/commands/supervisor/tickRecordApprovedDrafts.js";
import { judgeApprovedDrafts } from "../../../../../supervisor/approvedDraftGate.js";
import {
  ANSWERED_CALL,
  ANSWERED_QUESTION,
  ANSWERED_QUESTION_SEGMENT,
  ANSWERED_TURN,
  ANSWERED_WORDS,
  writeAnsweredTriageHome,
} from "../../../../answeredTriageHome.js";

/** The tick that let the chair approve it. */
const TICK = "2026-10-14T00:00:11.000Z";

const TURN = ANSWERED_TURN;

const HEAD = `  post:sd-ffab16e8 — the owner said "${ANSWERED_WORDS}" at talk:${TURN} (2026-10-13T23:38:51.584Z)`;

const QUESTION = `    answering the voice's "${ANSWERED_QUESTION}" (talk-call:${ANSWERED_CALL}#${ANSWERED_QUESTION_SEGMENT})`;

const DRAFT = "    on sd-ffab16e8, recorded 2026-10-13T11:02:10.240Z";

const homes: string[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { force: true, recursive: true });
  }
});

/** The incident's records written into a throwaway home. */
function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), "answered-witness-"));
  homes.push(home);
  writeAnsweredTriageHome({ home });
  return home;
}

/** The gate's refusal over a home, from the landing's own line to the end. */
function landingLines({ home }: { home: string }): readonly string[] {
  const read = readApprovedDraftsLive({ home });
  const verdict = judgeApprovedDrafts({ read, startedIso: TICK });
  expect(read.kind).toBe("read");
  expect(verdict.kind).toBe("refused");
  const lines = approvedDraftRefusalLines({
    answers: (read as Extract<typeof read, { kind: "read" }>).answers,
    verdict: verdict as Exclude<typeof verdict, { kind: "clean" }>,
  });
  return lines.slice(lines.indexOf(HEAD));
}

describe("the approved-draft gate over the bare-yes call (incident C0SYN000001)", () => {
  it("prints the voice's question beside the owner's words, says the verdict was never recorded, and leads with the hold", () => {
    expect(landingLines({ home: fixtureHome() }).slice(0, 6)).toStrictEqual([
      HEAD,
      QUESTION,
      "    triage verdict: NOT RECORDED — the relay predates stored verdicts; read row talk-a00000250000's text for " +
        "one before treating the owner's words as a yes",
      DRAFT,
      '    not: slopweaver slack draft hold sd-ffab16e8 --reason not-owner-yes --why "<what they meant>"',
      "    yes: not at this anchor — the relay recorded no verdict, so `slack draft approve` refuses this anchor; only " +
        "a newer yes from the owner, at its own anchor, approves it",
    ]);
  });

  it("prints the stored needs-more-info verdict a relay now writes, naming it on the hold it leads with", () => {
    const home = fixtureHome();
    const path = join(home, "talk", "turns", `${TURN}.json`);
    // A relay on current main writes its ruling on the turn; the incident's own turn predates that (README).
    const turn = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(
      path,
      `${JSON.stringify({ ...turn, triageRuling: { feedback: "no-receipts", verdict: "needs-more-info" } })}\n`,
    );

    expect(landingLines({ home }).slice(0, 6)).toStrictEqual([
      HEAD,
      QUESTION,
      "    triage verdict needs-more-info: The owner's triage verdict on this card: needs more info — find what is " +
        "missing and put it on the card. What was wrong: it made a claim with no receipt — no link to where the " +
        "owner can see it, no screenshot of it.",
      DRAFT,
      "    not: slopweaver slack draft hold sd-ffab16e8 --reason not-owner-yes --why " +
        '"relay verdict needs-more-info: <what they meant>"',
      "    yes: not at this anchor — the relay stored needs-more-info, so `slack draft approve` refuses this anchor; " +
        "only a newer yes from the owner, at its own anchor, approves it",
    ]);
  });

  it("leads with approve only when the relay stored send-it", () => {
    const home = fixtureHome();
    const path = join(home, "talk", "turns", `${TURN}.json`);
    const turn = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, `${JSON.stringify({ ...turn, heardTailCut: false, triageRuling: { verdict: "send-it" } })}\n`);

    expect(landingLines({ home }).slice(3, 6)).toStrictEqual([
      DRAFT,
      `    yes: slopweaver slack draft approve sd-ffab16e8 --anchor talk:${TURN}`,
      '    not: slopweaver slack draft hold sd-ffab16e8 --reason not-owner-yes --why "<what they meant>"',
    ]);
  });

  // A send-it on words not stated whole put the approve route first.
  it("leads with the hold when that send-it was stored on words not stated whole", () => {
    const home = fixtureHome();
    const path = join(home, "talk", "turns", `${TURN}.json`);
    const turn = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    writeFileSync(path, `${JSON.stringify({ ...turn, heardTailCut: true, triageRuling: { verdict: "send-it" } })}\n`);

    expect(landingLines({ home })[4]!.startsWith("    not: ")).toBe(true);
  });
});
