import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runTurnAnswer } from "../../../../../cli/commands/turn/run.js";
import { answerDigestOf } from "../../../../../live/turn/poster.js";
import type { AnswerFormAnswer } from "../../../../../outbound/assistant/answerForm.js";

const ANSWER: AnswerFormAnswer = {
  body: [],
  citations: [],
  documents: [],
  grounding: {
    evidence: {
      consultedEmpty: [],
      couldNotSee: { blindSpots: [], reason: "nothing else to check" },
      premiseChecks: [],
      read: [],
      substitutedForReal: [],
    },
    kind: "conversation",
    provenance: { model: "claude-opus-5", skillsLoaded: [], verbsLoaded: [] },
    reason: "context and judgement alone answer this",
  },
  images: [],
  index: [],
  kind: "answer",
  lead: "You have 3 open PRs.",
  measurements: [],
};

// Every fixture directory this file has minted, so `afterEach` can remove them.
const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

/** Write an answer file, returning its path. The bytes are PRETTY-printed, unlike what the door hashes. */
const answerFile = ({ body }: { body: string }): string => {
  const dir = mkdtempSync(join(tmpdir(), "slopweaver-digest-"));
  fixtureDirs.push(dir);
  const path = join(dir, "answer.json");
  writeFileSync(path, body, "utf8");
  return path;
};

const argv = ({ tail }: { tail: readonly string[] }): readonly string[] => ["node", "cli", "turn", "answer", ...tail];

describe("turn answer --print-digest", () => {
  it("exits clean without posting anything, given only an answer file", async () => {
    // `logger.out` writes with `writeSync` to fd 1 (a deliberate anti-truncation choice), so the printed
    // bytes are not capturable from inside the process. What this asserts is that the path runs to a clean
    // exit with NO brief, NO decision, NO token and no network — anything posting would have refused long
    // before here. The exact printed digest is proven through the real binary; see the PR's proof.
    const path = answerFile({ body: JSON.stringify(ANSWER, undefined, 2) });

    expect(await runTurnAnswer(argv({ tail: ["--answer", path, "--print-digest"] }))).toBe(0);
  });

  it("prints a digest that a hash of the FILE does not match — the trap this verb exists for", async () => {
    // The same answer, pretty-printed on disk. Hashing those bytes gives a different number, which the door
    // refuses as stale. Anyone reaching for `sha256sum` gets a sound review rejected.
    const compact = createHash("sha256").update(JSON.stringify(ANSWER)).digest("hex");
    const pretty = createHash("sha256")
      .update(JSON.stringify(ANSWER, undefined, 2))
      .digest("hex");

    expect(answerDigestOf({ answer: ANSWER })).toBe(`sha256:${compact}`);
    expect(compact).not.toBe(pretty);
  });

  it("REFUSES with a usage error when no --answer is given", async () => {
    expect(await runTurnAnswer(argv({ tail: ["--print-digest"] }))).toBe(2);
  });

  it("REFUSES an unreadable answer without printing a digest for it", async () => {
    const path = answerFile({ body: "not json" });

    expect(await runTurnAnswer(argv({ tail: ["--answer", path, "--print-digest"] }))).toBe(1);
  });
});
