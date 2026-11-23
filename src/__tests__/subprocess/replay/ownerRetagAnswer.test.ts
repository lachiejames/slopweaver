/**
 * REPLAY LANE — the owner re-tag, re-run against the answer it actually composed.
 *
 * The fixture (`fixtures/replay/owner-retag-28aug`) is the whole record set of the turn the owner opened
 * with two hard constraints: at most one review round, and an answer inside thirty minutes. It replaced an
 * attempt that had died at the admit door with `ANSWER_DOES_NOT_TAG_ASKER` after five rounds, because the
 * answer mentioned nobody at all.
 *
 * So the property this pins is the one that failed: the answer this thread landed **tags the person who
 * asked**, and the real gate that refused its predecessor admits it. The gate is
 * `src/admit/askerTagGate.ts`, run here on the frozen bytes — production code, not a restatement of it.
 *
 * **On the mention map.** A door resolves mention keys through the roster before this gate sees them. A
 * fixture carries no roster (the manifest's `excluded` says why), and it does not need one: the frozen
 * answer's `person` keys ARE Slack user ids, so the identity map is the honest resolution of them, and the
 * assertion stays about the ANSWER rather than about whose roster ingested whom.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { answerMustTagAsker, askerTagFindings } from "../../../admit/askerTagGate.js";
import { unwrap } from "../../../lib/result.js";
import { mentionedPeopleOfCard } from "../../../outbound/artifact/runs.js";
import { type AnswerFormAnswer, parseAnswerArm } from "../../../outbound/assistant/answerForm.js";
import { materialiseFixture } from "../../replayFixture.js";

const SLUG = "owner-retag-28aug";

/**
 * The single round cap the owner set, plus the one extra round this turn actually spent.
 *
 * The bar is what HAPPENED, not what was asked for: the turn took two rounds, so two is the number a
 * regression would have to beat to be a regression. Asserting the owner's `1` would be asserting a fix nobody has
 * made yet, and a test that has never passed teaches a reader nothing.
 */
const ROUND_CEILING = 2;

let workspace: string;
let home: string;
beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "slop-replay-owner-retag-"));
  home = join(workspace, "home");
});
afterEach(() => {
  rmSync(workspace, { force: true, recursive: true });
});

/** The composed answer this fixture froze, parsed by the real form schema. */
function frozenAnswer(): AnswerFormAnswer {
  const manifest = materialiseFixture({ into: home, slug: SLUG });
  return unwrap(
    parseAnswerArm({
      context: { repos: [] },
      raw: JSON.parse(readFileSync(join(home, "tmp", `answer-${manifest.ask.messageTs}.json`), "utf8")),
    }),
  );
}

/** The identity mention map — see this file's header for why a fixture resolves keys to themselves. */
function identityMentions({ answer }: { answer: AnswerFormAnswer }): ReadonlyMap<string, string> {
  return new Map(mentionedPeopleOfCard({ detail: answer.body, index: answer.index }).map((person) => [person, person]));
}

describe("replay: owner-retag-28aug", () => {
  it("the answer tags the person who asked", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const answer = frozenAnswer();
    expect(mentionedPeopleOfCard({ detail: answer.body, index: answer.index })).toContain(manifest.ask.askedBy);
  });

  it("passes the very gate that refused its predecessor", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const answer = frozenAnswer();
    // `ownerUserId: undefined` states the duty at its strictest — no exemption is claimed, so an answer that
    // stopped mentioning the asker would fire the finding rather than be excused by whose thread it is.
    expect(answerMustTagAsker({ askedBy: manifest.ask.askedBy, ownerUserId: undefined, surface: "channel" })).toEqual({
      askedBy: manifest.ask.askedBy,
      kind: "owed",
    });
    expect(
      askerTagFindings({
        answer,
        askedBy: manifest.ask.askedBy,
        mentions: identityMentions({ answer }),
        ownerUserId: undefined,
        surface: "channel",
      }),
    ).toEqual([]);
  });

  it("spent no more review rounds than it did on the day", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    expect(manifest.reviewRounds).toBeLessThanOrEqual(ROUND_CEILING);
  });

  it("materialises so the marker's own answerPath resolves inside the throwaway home", () => {
    const manifest = materialiseFixture({ into: home, slug: SLUG });
    const markerPath = join(
      home,
      "live",
      "slack",
      "turn-markers",
      `${manifest.ask.channel}-${manifest.ask.messageTs}.json`,
    );
    const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { kind: string; answerPath: string };
    expect(marker.kind).toBe("ready");
    // The freeze rewrote this path to `${SLOPWEAVER_HOME}/…` and renamed the answer off its worker-chosen
    // filename; both have to survive materialisation together, or the fixture points at a file it does not
    // carry. A `--poll` would be the richer proof and cannot be: this ask ended `answered`, so its dispatch
    // is superseded and no current-generation record exists to poll.
    expect(marker.answerPath).toBe(join(home, "tmp", `answer-${manifest.ask.messageTs}.json`));
    expect(existsSync(marker.answerPath)).toBe(true);
  });
});
