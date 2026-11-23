/**
 * A relay typed into the supervisor's chat — the target, the composer refusal, the line, and the whole
 * delivery driven against a hand-built fake client with no socket and no clock.
 *
 * The composer grids are the REAL frozen `terminal.replay` captures under `src/__tests__/fixtures/composer/`,
 * for the reason `unit/cmux/reach.test.ts` gives: the typed/placeholder distinction is a drawing attribute,
 * and a hand-built grid would test the refusal against a shape the terminal never produced.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CmuxClient, CmuxWorkspaceSummary } from "../../../cmux/client.js";
import { CmuxErrors } from "../../../cmux/errors.js";
import { pastesWhole, RELAY_INLINE_MAX_CHARS } from "../../../cmux/relayFile.js";
import { type CmuxRenderGrid, parseRenderGrid } from "../../../cmux/renderGrid.js";
import { err, ok, unwrap } from "../../../lib/result.js";
import { composerRefusal, deliveryOfDisposition, listRefusalOf, sendFailureOf } from "../../../talk/deliveryOutcome.js";
import {
  deliverRelayToSupervisor,
  type RelayLineInput,
  relayTurnLine,
  supervisorTargetOf,
} from "../../../talk/supervisorDelivery.js";

import { hostOverFake, INSTANT_WAITS } from "../sessionHarness/fakeCmux.js";
import { SHOT, SPOKEN, TURN, VOICE_TURN } from "./relayLineFixture.js";

const FIXTURES = join(import.meta.dirname, "../../fixtures/composer");
const AT = "2026-09-23T13:10:00.000Z";
const IDLE_SCREEN = ["❯ ", "  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← 3 agents"].join("\n");
/** What a typed line says: no voice turn preceded it, so the verdict alone. */
const TYPED_ANSWER = " — triage verdict: none";

/** One frozen capture, parsed by the real parser. */
function grid({ shape }: { shape: string }): CmuxRenderGrid {
  const value: unknown = JSON.parse(readFileSync(join(FIXTURES, `${shape}.json`), "utf8"));
  return unwrap(parseRenderGrid({ value }));
}

/** A workspace summary with only the fields the target cares about set. */
function workspace({ ref, pinned, title }: { ref: string; pinned: boolean; title: string }): CmuxWorkspaceSummary {
  return {
    currentDirectory: "/tmp",
    description: undefined,
    latestConversationMessage: undefined,
    latestSubmittedAtIso: undefined,
    latestSubmittedMessage: undefined,
    pinned,
    selected: false,
    title,
    windowId: "window-1",
    workspaceId: `id-${ref}`,
    workspaceRef: ref,
  };
}

const CHAIR = workspace({ pinned: true, ref: "workspace:1", title: "/slopweaver:supervisor" });
const WORKER = workspace({ pinned: false, ref: "workspace:7", title: "a worker" });

/** A fake client over a workspace list and one composer grid, recording every line sent, as the host surface. */
function fakeClient({
  workspaces,
  composer,
}: {
  workspaces: readonly CmuxWorkspaceSummary[];
  composer: CmuxRenderGrid;
}): {
  readonly client: ReturnType<typeof hostOverFake>;
  readonly sent: string[];
} {
  const sent: string[] = [];
  const client = {
    close: () => undefined,
    closeWorkspace: () => Promise.resolve(ok(undefined)),
    createWorkspace: () =>
      Promise.resolve(ok({ surfaceId: "s", surfaceRef: "surface:1", workspaceId: "w", workspaceRef: "workspace:1" })),
    identify: () =>
      Promise.resolve(
        ok({ surfaceId: undefined, surfaceRef: undefined, workspaceId: undefined, workspaceRef: undefined }),
      ),
    interruptTurn: () => Promise.resolve(ok(undefined)),
    listWorkspaces: () => Promise.resolve(ok(workspaces)),
    pinWorkspace: () => Promise.resolve(ok(undefined)),
    processTree: () => Promise.resolve(ok([])),
    workspaceTop: () => Promise.resolve(ok({ surfaces: 1, trees: [], ttys: [], unattributedTtyPids: [] })),
    readResumeBinding: () => Promise.resolve(ok(undefined)),
    readScreen: () => Promise.resolve(ok(IDLE_SCREEN)),
    readScreenGrid: () => Promise.resolve(ok(composer)),
    renameWorkspace: () => Promise.resolve(ok(undefined)),
    resolveWorkspace: () =>
      Promise.resolve(err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "n/a", method: "workspace.list" }))),
    sendLine: ({ text }: { text: string }) => {
      sent.push(text);
      return Promise.resolve(ok(undefined));
    },
    submitComposer: () => Promise.resolve(ok(undefined)),
    unpinWorkspace: () => Promise.resolve(ok(undefined)),
    listWorkspacesStrict: () => Promise.resolve(ok([])),
    topologyStrict: () => Promise.resolve(ok({ surfacePids: [], workspaceRefs: [] })),
    workspaceSurface: () =>
      Promise.resolve(err(CmuxErrors.callFailed({ cmuxCode: "not_found", message: "n/a", method: "pane.list" }))),
  } satisfies CmuxClient;
  return { client: hostOverFake({ client }), sent };
}

describe("supervisorTargetOf", () => {
  it("finds the one workspace that is pinned AND titled the supervisor", () => {
    expect(supervisorTargetOf({ workspaces: [WORKER, CHAIR] })).toEqual({ kind: "one", workspace: CHAIR });
  });

  it("finds none when the pinned workspace carries another title", () => {
    const pinnedWorker = workspace({ pinned: true, ref: "workspace:3", title: "a worker" });
    expect(supervisorTargetOf({ workspaces: [pinnedWorker] })).toEqual({
      kind: "none",
      refusal: "no-pinned-supervisor",
      why: "no workspace is the pinned supervisor",
    });
  });

  it("refuses to pick between two claimants", () => {
    const second = workspace({ pinned: true, ref: "workspace:9", title: "/slopweaver:supervisor" });
    expect(supervisorTargetOf({ workspaces: [CHAIR, second] })).toEqual({
      kind: "none",
      refusal: "multiple-pinned-supervisors",
      why: "2 workspaces claim to be the pinned supervisor (workspace:1, workspace:9)",
    });
  });
});

describe("composerRefusal", () => {
  it("refuses a box holding the owner's unsent words", () => {
    expect(composerRefusal({ composer: { kind: "typed", text: "half a thought" } })).toEqual({
      refusal: "composer-busy",
      why: "the owner has unsent words in the supervisor's box, and a paste would splice into them",
    });
  });

  it("refuses a box it could not read", () => {
    expect(composerRefusal({ composer: { kind: "unreadable", reason: "no cursor" } })).toEqual({
      refusal: "composer-unreadable",
      why: "the supervisor's box could not be read (no cursor), and an unread box is not an empty one",
    });
  });

  it("types into an empty box, a placeholder or a machine suggestion", () => {
    expect(composerRefusal({ composer: { kind: "empty" } })).toBe(undefined);
    expect(composerRefusal({ composer: { kind: "placeholder", text: 'Try "x"' } })).toBe(undefined);
    expect(composerRefusal({ composer: { kind: "suggestion", text: "run tests" } })).toBe(undefined);
  });
});

describe("relayTurnLine", () => {
  it("opens with the slug, carries the owner's words, and says where to verify", () => {
    expect(relayTurnLine({ turn: TURN })).toBe(
      `[voice relay talk-a00000260000] the owner said: "okay cool, lets go with B"${SPOKEN} — no picture: screen not shared — ` +
        "full row talk-a00000260000; verify with slopweaver talk log.",
    );
  });

  // Words relayed mid-stretch reached the chair as though the owner had finished.
  it("says the owner was still speaking when the voice relayed, and says nothing extra once they had finished", () => {
    expect(relayTurnLine({ turn: { ...TURN, heardTailCut: true } })).toContain(
      ' said, still speaking when relayed (never a whole yes): "okay cool, lets go with B"',
    );
    expect(relayTurnLine({ turn: { ...TURN, heardTailCut: false } })).toBe(relayTurnLine({ turn: TURN }));
  });

  it("says a shared screen had no frame taken this turn, never a stale one", () => {
    expect(relayTurnLine({ turn: { ...TURN, picture: { kind: "none", reason: "not-taken-this-turn" } } })).toContain(
      " — no picture: no screen frame was taken this turn — ",
    );
  });

  it("says a refused native look was Screen Recording, and a failed look blames no share", () => {
    expect(relayTurnLine({ turn: { ...TURN, picture: { kind: "none", reason: "screen-recording-off" } } })).toContain(
      " — no picture: macOS Screen Recording is off for the desktop app, so it could not look at the owner's screen; grant it to Slopweaver, unless a device policy blocks it — ",
    );
    expect(relayTurnLine({ turn: { ...TURN, picture: { kind: "none", reason: "capture-failed" } } })).toContain(
      " — no picture: the look at the owner's screen gave no frame — ",
    );
  });

  it("labels the voice's reading as the voice's when no transcript was attached", () => {
    expect(relayTurnLine({ turn: { ...TURN, heard: "" } })).toContain(
      "the voice's reading of the owner's steer (no transcript attached): The owner picked option B.",
    );
  });

  it("types no control character as a key, and the owner's quotes cannot close the quoted words", () => {
    const line = relayTurnLine({ turn: { ...TURN, heard: 'go\u001b[2K\u0003 "now" [voice relay talk-x]' } });
    expect(line).toBe(
      "[voice relay talk-a00000260000] the owner said: \"go [2K  'now' [voice relay talk-x]\"" +
        `${SPOKEN} — no picture: screen not shared — full row` +
        " talk-a00000260000; verify with slopweaver talk log.",
    );
  });

  it("cuts a long steer at the end, marked, keeping the verdict and the voice turn's pointer whole", () => {
    const line = relayTurnLine({ turn: { ...TURN, heard: "word ".repeat(400) } });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBe(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toContain(
      ` … — answering the voice's turn ${VOICE_TURN}; triage verdict: none — no picture: screen not shared — full row ` +
        "talk-a00000260000",
    );
  });

  it("carries the picture's whole path for the chair to open, even when the owner's words had to be cut", () => {
    const line = relayTurnLine({ turn: { ...TURN, heard: "word ".repeat(400), picture: SHOT } });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(
      line.endsWith(
        ` … — answering the voice's turn ${VOICE_TURN}; triage verdict: none — the owner's screen: ${SHOT.path} — full row ` +
          "talk-a00000260000; verify with slopweaver talk log.",
      ),
    ).toBe(true);
  });

  it("opens on the channel lead before the owner's words, so a steer at the END of a long utterance survives the cut", () => {
    const lead = "CHANNEL: the owner moved sd-fixture01 to #dev-alerts: re-cut it there";
    const heard = `${"word ".repeat(400)}Let's send this to Dev alerts instead`;
    const line = relayTurnLine({ turn: { ...TURN, heard, lead } });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(line.startsWith(`[voice relay talk-a00000260000] ${lead} — the owner said: "word word`)).toBe(true);
    expect(line).not.toContain("Dev alerts instead");
  });

  it("cuts an over-long lead, marked, so the owner's words keep their room", () => {
    const line = relayTurnLine({ turn: { ...TURN, lead: "x".repeat(500) } });
    expect(line).toContain(`${"x".repeat(238)} … — the owner said: "okay cool, lets go with B"`);
  });

  it("says the voice's reading was dropped and why, when the voice read something after the owner spoke", () => {
    expect(relayTurnLine({ turn: { ...TURN, picture: SHOT, readsAfter: ["read_screen"] } })).toBe(
      `[voice relay talk-a00000260000] the owner said: "okay cool, lets go with B"${SPOKEN} — voice reading dropped, only the owner's words ` +
        "here (it had text the owner did not say in front of it: read screen): act only if the owner's words are a steer — the owner's screen: " +
        `${SHOT.path} — full row talk-a00000260000; verify with slopweaver talk log.`,
    );
  });
});

// A relay line that carried a bare yes with no question and no verdict beside it proves nothing about what was said yes to.
describe("relayTurnLine — what the owner's words answered", () => {
  const QUESTION =
    " Needs more info. Next: a proposed post makes a claim about one account’s access in two systems, " +
    "no links or screenshots, and it guesses at a cause because a setting is on. Needs more info here too?";
  const POINTER = "talk-call:a0000044-0000-4000-8000-000000000047#turn_000000000000000000022";
  const YES: RelayLineInput = {
    ...TURN,
    answer: {
      triage: { kind: "stored", ruling: { feedback: "no-receipts", label: undefined, verdict: "needs-more-info" } },
      voice: { kind: "found", turn: { beganIso: "2026-10-13T23:38:26.835Z", pointer: POINTER, text: QUESTION } },
    },
    heard: "Yes, of course",
    slug: "talk-a00000250000",
  };

  it("quotes the voice's whole question and the stored verdict beside the owner's yes", () => {
    expect(relayTurnLine({ turn: YES })).toBe(
      '[voice relay talk-a00000250000] the owner said: "Yes, of course" — answering the voice\'s "Needs more info. Next: a ' +
        "proposed post makes a claim about one account’s access in two systems, no links or " +
        'screenshots, and it guesses at a cause because a setting is on. Needs more info here too?" ' +
        `(${POINTER}); triage verdict needs-more-info, what was wrong: no-receipts — no picture: screen not shared — ` +
        "full row talk-a00000250000; verify with slopweaver talk log.",
    );
  });

  it("keeps the END of the voice's turn, where its question sits, when the owner's words leave less room", () => {
    const line = relayTurnLine({ turn: { ...YES, heard: `Yes, of course. ${"and ".repeat(110)}` } });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBe(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toContain(` — answering the voice's "… is on. Needs more info here too?" (${POINTER}); triage`);
    expect(line).not.toContain("Needs more info. Next:");
  });

  it("says the voice turn was not found and why, rather than guess one, and still carries the verdict", () => {
    const line = relayTurnLine({
      turn: { ...YES, answer: { triage: { kind: "none" }, voice: { kind: "not-found", why: "no relay line yet" } } },
    });
    expect(line).toContain(
      'the owner said: "Yes, of course" — the voice turn the owner answered was not found (no relay line yet); triage verdict: none —',
    );
  });

  it("carries why a tail-only turn names no voice turn, the longest reason this repo writes", () => {
    const why = "kept only the tail of the owner's words, so where they began cannot be told; read the call";
    const line = relayTurnLine({
      turn: { ...YES, answer: { triage: { kind: "none" }, voice: { kind: "not-found", why } } },
    });
    expect([line.includes(`was not found (${why}); triage verdict: none`), pastesWhole({ line })]).toStrictEqual([
      true,
      true,
    ]);
  });

  const CROWDED: RelayLineInput = {
    ...YES,
    lead: "L".repeat(239),
    picture: { ...SHOT, path: `/${"p".repeat(294)}.png` },
    readsAfter: ["r"],
  };
  const LONGEST_RULING = {
    kind: "stored",
    ruling: { feedback: "not-at-a-glance", label: "waiting-on-them", verdict: "needs-more-info" },
  } as const;

  // A long lead, a long why and a long verdict once left the owner's "YES" cut to "the owner …".
  it("cuts why no voice turn was named shorter before it cuts the owner's words, when nothing else is left to shorten", () => {
    const line = relayTurnLine({
      turn: {
        ...CROWDED,
        answer: { triage: LONGEST_RULING, voice: { kind: "unreadable", why: "w".repeat(160) } },
        heard: "X".repeat(1_000),
      },
    });
    expect([
      // What is left of the body's room once the fixed clauses, `the owner said: "` and the cut mark ` …` are paid.
      line.includes(`the owner said: "${"X".repeat(36)} …`),
      line.includes(`could not be read (${"w".repeat(87)}…); triage verdict needs-more-info`),
      pastesWhole({ line }),
    ]).toStrictEqual([true, true, true]);
  });

  // Beside the longest lead, verdict and tail, a tail-only turn's reason was once dropped for the owner's words.
  it("still says why a tail-only turn names no voice turn, beside the longest lead, verdict and tail", () => {
    const why = "kept only the tail of the words, so where they began cannot be told; read the call";
    const line = relayTurnLine({
      turn: { ...CROWDED, answer: { triage: LONGEST_RULING, voice: { kind: "not-found", why } }, heard: "YES" },
    });
    expect([
      line.includes('the owner said: "YES"'),
      line.includes(`was not found (${why});`),
      pastesWhole({ line }),
    ]).toStrictEqual([true, true, true]);
  });

  it("names a turn that predates stored verdicts by its row", () => {
    const line = relayTurnLine({
      turn: { ...YES, answer: { ...YES.answer, triage: { kind: "not-recorded", slug: "talk-a00000250000" } } },
    });
    expect(line).toContain(`(${POINTER}); triage verdict: NOT RECORDED (read row talk-a00000250000) — no picture`);
  });

  it("cuts a slug no budget can shrink, and still carries the owner's words, the question and the verdict", () => {
    const line = relayTurnLine({ turn: { ...YES, slug: "s".repeat(400) } });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(
      line.startsWith(`[voice relay ${"s".repeat(39)}…] the owner said: "Yes, of course" — answering the voice's "`),
    ).toBe(true);
    expect(line).toContain(
      `Needs more info here too?" (${POINTER}); triage verdict needs-more-info, what was wrong: no-receipts`,
    );
    expect(line.endsWith(` — full row ${"s".repeat(39)}…; verify with slopweaver talk log.`)).toBe(true);
  });

  it("stays bounded with every field a hand-edited record can stretch at its longest, the owner's words cut last", () => {
    const pointer = "p".repeat(400);
    const line = relayTurnLine({
      turn: {
        ...YES,
        answer: {
          triage: { kind: "not-recorded", slug: "s".repeat(400) },
          voice: { kind: "found", turn: { beganIso: "2026-10-13T23:38:26.835Z", pointer, text: "q".repeat(2000) } },
        },
        heard: `Yes, of course. ${"and ".repeat(500)}`,
        lead: "l".repeat(1000),
        picture: { ...SHOT, path: "/".repeat(1000) },
        readsAfter: ["r".repeat(1000)],
        slug: "s".repeat(400),
      },
    });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toContain('the owner said: "Yes, of course');
    expect(line).toContain(
      ` — answering the voice's turn ${"p".repeat(95)}…; triage verdict: NOT RECORDED (read row ${"s".repeat(39)}…) — `,
    );
  });
});

describe("relayTurnLine — words alone", () => {
  it("says the voice's reading was not carried because a first relay was refused", () => {
    expect(relayTurnLine({ turn: { ...TURN, picture: SHOT, words: "", wordsAlone: true } })).toBe(
      `[voice relay talk-a00000260000] the owner said: "okay cool, lets go with B"${SPOKEN} — voice reading not carried (a first ` +
        "relay was refused): act only if the owner's words are a steer — the owner's screen: " +
        `${SHOT.path} — full row talk-a00000260000; verify with slopweaver talk log.`,
    );
  });
});

describe("relayTurnLine — typed on the console", () => {
  it("says the owner typed it, and names the image they attached", () => {
    expect(
      relayTurnLine({ turn: { ...TURN, heard: 'fix the "queue"\nplease', picture: SHOT, typed: true, words: "" } }),
    ).toBe(
      "[voice relay talk-a00000260000] the owner typed on the console: \"fix the 'queue' please\"" +
        `${TYPED_ANSWER} — the owner's image: ` +
        `${SHOT.path} — full row talk-a00000260000; verify with slopweaver talk log.`,
    );
  });

  it("reads the record's exact bytes through the typed normaliser, so edge blanks never reach the owner's chat", () => {
    expect(
      relayTurnLine({
        turn: { ...TURN, heard: "  fix it  \r\n\r\n\r\n", picture: SHOT, typed: true, words: "" },
      }),
    ).toBe(
      `[voice relay talk-a00000260000] the owner typed on the console: "fix it"${TYPED_ANSWER} — the owner's image: ` +
        `${SHOT.path} — full row talk-a00000260000; verify with slopweaver talk log.`,
    );
  });

  it("says no image was attached when the owner attached none", () => {
    expect(
      relayTurnLine({
        turn: { ...TURN, heard: "fix it", picture: { kind: "none", reason: "not-attached" }, typed: true, words: "" },
      }),
    ).toBe(
      `[voice relay talk-a00000260000] the owner typed on the console: "fix it"${TYPED_ANSWER} — no image attached — ` +
        "full row talk-a00000260000; verify with slopweaver talk log.",
    );
  });
});

// A typed turn after a call continues from what the owner said on it.
describe("relayTurnLine — a typed steer after a call", () => {
  const CALL_ID = "a0000041-0000-4000-8000-000000000044";
  const TYPED = { ...TURN, heard: "and bring the deck", typed: true, words: "" };
  const UNREAD = { callId: CALL_ID, kind: "unread", newest: ["meet at the cafe", "at 3pm"], stretches: 3 } as const;

  it("names the call it follows, how much of it is unread, and the owner's newest words on it", () => {
    expect(relayTurnLine({ turn: { ...TYPED, callContext: UNREAD } })).toBe(
      `[voice relay talk-a00000260000] the owner typed on the console: "and bring the deck"${TYPED_ANSWER} — this follows the owner's call ` +
        `${CALL_ID}, 3 stretch(es) of the owner's you have not read (slopweaver talk unread); newest the owner said: ` +
        "'meet at the cafe' / 'at 3pm' — no picture: screen not shared — full row talk-a00000260000; verify " +
        "with slopweaver talk log.",
    );
  });

  it("says when the owner's call words could not be read, rather than leaving the call out", () => {
    const line = relayTurnLine({
      turn: { ...TYPED, callContext: { kind: "unavailable", why: "call file c-1 is gone" } },
    });
    expect(line).toContain(
      " — this may follow a call: the owner's call words could not be read (call file c-1 is gone); check slopweaver talk unread — ",
    );
  });

  it("keeps the owner's typed words and cuts the call's quotes from the front, keeping the newest", () => {
    const newest = [`${"a".repeat(300)} oldest`, `${"b".repeat(300)} NEWEST`];
    const line = relayTurnLine({ turn: { ...TYPED, callContext: { ...UNREAD, newest } } });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBe(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toContain(
      `the owner typed on the console: "and bring the deck"${TYPED_ANSWER} — this follows the owner's call`,
    );
    expect(line).toContain("(slopweaver talk unread); newest the owner said: … ");
    expect(line).toContain(" NEWEST' — no picture: screen not shared — full row talk-a00000260000;");
  });

  // 600 typed characters fit the line whole without the clause, so the clause never costs them one.
  it("leaves the call clause out rather than cut a single character of the owner's words for it", () => {
    const heard = "x".repeat(600);
    const line = relayTurnLine({ turn: { ...TYPED, callContext: UNREAD, heard } });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toContain(`"${heard}"`);
    expect(line).not.toContain("this follows the owner's call");
  });

  // A long image path left the clause no room beside the owner's words, and the words were the ones dropped.
  it("leaves the call clause out rather than the owner's words when a long image path takes the room", () => {
    const path = `/tmp/${Array.from({ length: 8 }, () => "d".repeat(70)).join("/")}`;
    const line = relayTurnLine({
      turn: { ...TYPED, callContext: UNREAD, heard: "x", picture: { ...SHOT, path } },
    });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toBe(
      `[voice relay talk-a00000260000] the owner typed on the console: "x"${TYPED_ANSWER} — the owner's image: ${path} — full row ` +
        "talk-a00000260000; verify with slopweaver talk log.",
    );
  });

  // A path longer than the line itself used to carry the line past its bound.
  it("names an over-long picture path by the row rather than overflow the line", () => {
    const path = `/tmp/${Array.from({ length: 13 }, () => "d".repeat(70)).join("/")}`;
    const line = relayTurnLine({
      turn: { ...TYPED, callContext: UNREAD, heard: "x", picture: { ...SHOT, path } },
    });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toContain(`the owner typed on the console: "x"`);
    expect(line).toContain(
      "— the owner's image's path is too long for this line, so read it off the row — full row talk-a00000260000;",
    );
    expect(line).not.toContain("d".repeat(70));
  });

  // A list of reads is input too, and a long one used to carry the line past its bound.
  it("names an over-long list of reads by the row rather than overflow the line", () => {
    const line = relayTurnLine({
      turn: { ...TYPED, callContext: UNREAD, heard: "a", readsAfter: ["x".repeat(1000)] },
    });
    expect(pastesWhole({ line })).toBe(true);
    expect(line.length).toBeLessThanOrEqual(RELAY_INLINE_MAX_CHARS - 1);
    expect(line).toContain(
      " — voice reading dropped, only the owner's words here: act only if the owner's words are a steer",
    );
    expect(line).not.toContain("x".repeat(100));
  });

  it("says nothing of calls on a spoken relay — the call is where it came from", () => {
    expect(relayTurnLine({ turn: { ...TURN, callContext: UNREAD } })).not.toContain("this follows the owner's call");
  });
});

describe("deliveryOfDisposition", () => {
  it("never calls a strand typed", () => {
    const kindOf = ({ disposition }: { disposition: "stranded" | "resubmitted" | "queued" | "unknown" }): string =>
      deliveryOfDisposition({ atIso: AT, disposition, via: "direct", workspaceRef: "workspace:1" }).kind;
    expect(kindOf({ disposition: "stranded" })).toBe("stranded");
    expect(kindOf({ disposition: "resubmitted" })).toBe("typed");
    expect(kindOf({ disposition: "queued" })).toBe("queued");
    expect(kindOf({ disposition: "unknown" })).toBe("unconfirmed");
  });

  it("names the process that typed it", () => {
    expect(
      deliveryOfDisposition({ atIso: AT, disposition: "submitted", via: "courier", workspaceRef: "workspace:1" }),
    ).toEqual({
      atIso: AT,
      detail: "typed into the supervisor's chat (workspace:1) as a turn from the owner",
      kind: "typed",
      via: "courier",
    });
  });
});

describe("listRefusalOf", () => {
  it("classes cmux's refusal of a process it did not start as access denied", () => {
    const error = CmuxErrors.accessDenied({
      refusal: "Access denied - only processes started inside cmux can connect",
      socketPath: "/tmp/cmux.sock",
    });
    expect(listRefusalOf({ error })).toBe("cmux-access-denied");
  });

  it("classes any other socket failure as unreachable", () => {
    const error = CmuxErrors.socketUnavailable({ detail: "connect ENOENT", socketPath: "/tmp/cmux.sock" });
    expect(listRefusalOf({ error })).toBe("cmux-unreachable");
  });
});

describe("sendFailureOf", () => {
  it.each([
    [
      "a connection lost",
      CmuxErrors.socketUnavailable({ detail: "the connection closed", socketPath: "/tmp/cmux.sock" }),
    ],
    ["a call timed out", CmuxErrors.timedOut({ method: "surface.send_key", timeoutMs: 5_000 })],
    [
      "a reply it could not read",
      CmuxErrors.malformedReply({ detail: "a success frame with no result", method: "surface.send_key" }),
    ],
  ])("records %s mid-send as unconfirmed, never as only reaching the board", (_, error) => {
    expect(sendFailureOf({ atIso: AT, error, via: "direct" })).toEqual({
      atIso: AT,
      detail: `cmux lost the line mid-send, so it may or may not be in the supervisor's chat: ${error.message}`,
      kind: "unconfirmed",
      via: "direct",
    });
  });

  it("records cmux answering that it did not take the call as failed", () => {
    const error = CmuxErrors.callFailed({
      cmuxCode: "invalid_params",
      message: "no such surface",
      method: "surface.send_text",
    });
    expect(sendFailureOf({ atIso: AT, error, via: "courier" })).toEqual({
      atIso: AT,
      detail: `cmux refused the line: ${error.message}`,
      kind: "failed",
      refusal: "cmux-send-failed",
      via: "courier",
    });
  });
});

describe("deliverRelayToSupervisor", () => {
  it("types the line into an empty supervisor box", async () => {
    const { client, sent } = fakeClient({ composer: grid({ shape: "placeholder" }), workspaces: [WORKER, CHAIR] });
    const delivery = await deliverRelayToSupervisor({
      client,
      nowIso: () => AT,
      turn: TURN,
      via: "direct",
      waits: INSTANT_WAITS,
    });
    expect(sent).toEqual([relayTurnLine({ turn: TURN })]);
    expect(delivery.kind).toBe("typed");
  });

  it("types nothing into a box holding the owner's unsent words", async () => {
    const { client, sent } = fakeClient({ composer: grid({ shape: "typed" }), workspaces: [CHAIR] });
    const delivery = await deliverRelayToSupervisor({
      client,
      nowIso: () => AT,
      turn: TURN,
      via: "courier",
      waits: INSTANT_WAITS,
    });
    expect(sent).toEqual([]);
    expect(delivery).toEqual({
      atIso: AT,
      detail: "not typed: the owner has unsent words in the supervisor's box, and a paste would splice into them",
      kind: "skipped",
      refusal: "composer-busy",
      via: "courier",
    });
  });

  it("types nothing when no supervisor is pinned", async () => {
    const { client, sent } = fakeClient({ composer: grid({ shape: "placeholder" }), workspaces: [WORKER] });
    const delivery = await deliverRelayToSupervisor({
      client,
      nowIso: () => AT,
      turn: TURN,
      via: "direct",
      waits: INSTANT_WAITS,
    });
    expect(sent).toEqual([]);
    expect(delivery).toEqual({
      atIso: AT,
      detail: "not typed: no workspace is the pinned supervisor",
      kind: "skipped",
      refusal: "no-pinned-supervisor",
      via: "direct",
    });
  });
});
