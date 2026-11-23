/*
 * The backfill's derivation. Two duties: the line it writes says only what the record holds, and it REFUSES
 * rather than writing one that would still be unreadable — which is the half a reviewer would drop, because
 * a refusal looks like a gap until you see that the gap is the console saying "no plain-words line" instead
 * of showing the owner a slug with a full stop after it.
 */
import { describe, expect, it } from "vitest";

import { derivedSaid, isDerivedSaid, saidPatchFor } from "../../../autonomy/derivedSaid.js";
import { unparsableIn } from "../../../autonomy/said.js";
import { AUTONOMY_SAID_MAX } from "../../../autonomy/types.js";

describe("deriving a line from what the record holds", () => {
  it("opens a board row's slug out into the sentence somebody wrote", () => {
    const line = derivedSaid({
      kind: "open-internal-finding-pull-request",
      subject: "github-enqueue-dies-at-the-mutation-with-other-side-closed",
    })!;
    expect(line).toBe(
      "open internal finding pull request, on github enqueue dies at the mutation with other side closed. " +
        "Written from the record afterwards — the session that did it left no line in plain words, and the " +
        "fleet's own note is below.",
    );
  });

  it("names a pull request by the label both surfaces already show, never the raw URL", () => {
    const line = derivedSaid({
      kind: "press-merge-when-ready",
      subject: "https://github.com/acme/acme-admin/pull/16644",
    })!;
    expect(line).toContain("press merge when ready, on acme/acme-admin#16644.");
  });

  it("names a state reference as a file", () => {
    const line = derivedSaid({ kind: "rewrite-board-row", subject: "state:handovers/notes.md" })!;
    expect(line).toContain("rewrite board row, on the file handovers/notes.md.");
  });

  it("says in the line itself that it was written after the fact", () => {
    const line = derivedSaid({ kind: "press-merge-when-ready", subject: "state:notes.md" })!;
    expect(line).toContain("Written from the record afterwards");
    expect(line).toContain("the fleet's own note is below");
  });

  it("writes a line that passes the same criterion a session-authored one is held to", () => {
    const line = derivedSaid({
      kind: "open-internal-finding-pull-request",
      subject: "eight-of-the-workos-atlas-s-fourteen-declared",
    })!;
    expect(unparsableIn({ said: line })).toBe(undefined);
  });
});

describe("what it refuses to derive", () => {
  it("answers nothing for a subject the register cannot classify", () => {
    expect(derivedSaid({ kind: "press-merge-when-ready", subject: "just some prose" })).toBe(undefined);
  });

  // The class that reached the owner's cards: a turn reference SURVIVES the shared refusal, because the transform
  // destroys the hyphen the sense looks for. `291-8x` is refused at the door and `291 8x` is not, so the
  // laundered shape needs its own sense inside the transform. The first two assertions are the falsifiable
  // half — they feed the raw token in and prove the shared criterion sees it hyphenated and goes blind
  // once it is opened out, so this reddens if either end of that ever changes.
  it("answers nothing for a turn reference the separator transform would launder past the shared check", () => {
    const subject = "the-291-14-disaster-recovery-they-asked-for";
    expect(unparsableIn({ said: "the 291-14 disaster recovery they asked for" })!.name).toBe("rule-number");
    expect(unparsableIn({ said: subject.replaceAll("-", " ") })).toBe(undefined);
    expect(derivedSaid({ kind: "open-internal-finding-pull-request", subject })).toBe(undefined);
  });

  it("answers nothing when opening the slug out still leaves a session id in it", () => {
    const subject = "a-finding-the-fd64a339-session-left-on-the-drawer";
    // The input CARRIES what the refusal is about, so this reddens if the criterion stops seeing it.
    expect(unparsableIn({ said: subject.replaceAll("-", " ") })!.name).toBe("session-id");
    expect(derivedSaid({ kind: "open-internal-finding-pull-request", subject })).toBe(undefined);
  });

  it("answers nothing rather than a line past the register's own bound", () => {
    const long = Array.from({ length: 60 }, () => "word").join("-");
    expect(long.length).toBeGreaterThan(0);
    expect(derivedSaid({ kind: "open-internal-finding-pull-request", subject: long })).toBe(undefined);
  });

  it("keeps a line that fits exactly inside the bound", () => {
    const line = derivedSaid({ kind: "press-merge-when-ready", subject: "state:a.md" })!;
    expect(line.length).toBeLessThanOrEqual(AUTONOMY_SAID_MAX);
  });
});

describe("telling adoption's own line apart from a session's words", () => {
  it("recognises the line it just wrote, so a sharpened derivation can correct it", () => {
    const line = derivedSaid({ kind: "press-merge-when-ready", subject: "state:a.md" })!;
    expect(isDerivedSaid({ said: line })).toBe(true);
  });

  it("does not claim a line written in the owner's voice, even one naming the same act", () => {
    expect(
      isDerivedSaid({
        said: "I pressed merge when ready on a file of mine, because every check had already gone green.",
      }),
    ).toBe(false);
  });

  it("does not claim a line that merely MENTIONS being written afterwards", () => {
    expect(isDerivedSaid({ said: "Written from the record afterwards, by hand, because I was there." })).toBe(false);
  });
});

describe("what adoption does to a stored said", () => {
  const ROW = { kind: "press-merge-when-ready", subject: "state:a.md" } as const;

  it("writes a derived line onto a row that carries none", () => {
    const patch = saidPatchFor({ ...ROW, standing: undefined, steered: false });
    expect(patch.kind).toBe("write");
    expect(patch).toStrictEqual({ kind: "write", said: derivedSaid(ROW)! });
  });

  it("leaves a said a session wrote exactly where it is", () => {
    const ownVoice = "I pressed merge when ready on a file of mine, because every check had gone green.";
    expect(saidPatchFor({ ...ROW, standing: ownVoice, steered: false })).toStrictEqual({ kind: "leave" });
  });

  it("leaves its own line alone when the derivation still produces the same one", () => {
    expect(saidPatchFor({ ...ROW, standing: derivedSaid(ROW)!, steered: false })).toStrictEqual({ kind: "leave" });
  });

  // The thirteen laundered rows: a line adoption wrote, on a subject the sharpened derivation now refuses.
  // Under a two-answer shape this row was unreachable, so the assertion is `remove` and nothing weaker.
  it("takes back a line it wrote when the derivation has since been sharpened against that row", () => {
    const laundered = "open internal finding pull request, on the 291 14 disaster recovery they asked for. ";
    const stale = `${laundered}Written from the record afterwards — the session that did it left no line in plain words, and the fleet's own note is below.`;
    expect(isDerivedSaid({ said: stale })).toBe(true);
    expect(
      saidPatchFor({
        kind: "open-internal-finding-pull-request",
        standing: stale,
        steered: false,
        subject: "the-291-14-disaster-recovery-they-asked-for",
      }),
    ).toStrictEqual({ kind: "remove" });
  });

  it("leaves a steer row alone — there is no act on it to describe", () => {
    expect(saidPatchFor({ ...ROW, standing: undefined, steered: true })).toStrictEqual({ kind: "leave" });
  });

  it("leaves a row whose kind or subject is not a string for validation to refuse", () => {
    expect(saidPatchFor({ kind: 7, standing: undefined, steered: false, subject: "state:a.md" })).toStrictEqual({
      kind: "leave",
    });
    expect(
      saidPatchFor({ kind: "press-merge-when-ready", standing: undefined, steered: false, subject: null }),
    ).toStrictEqual({
      kind: "leave",
    });
  });

  it("leaves a row carrying no line when the derivation refuses it, rather than inventing a removal", () => {
    expect(
      saidPatchFor({ kind: "press-merge-when-ready", standing: undefined, steered: false, subject: "just prose" }),
    ).toStrictEqual({ kind: "leave" });
  });
});
