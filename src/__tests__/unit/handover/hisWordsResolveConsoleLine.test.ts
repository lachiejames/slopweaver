/*
 * A chair turn the console typed is never the owner's words. A relay's delivery line wraps what they said in the console's own
 * instructions, so a `transcript:` anchor at one is refused — never quoted, and never read through to the relay, whose
 * own `talk:` anchor the refusal points at. The chair transcript is written as Claude Code writes one, and a relay is
 * claimed into the throwaway home by the real store, so a refusal is not just the relay being absent.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveHisWords } from "../../../handover/hisWordsResolve.js";
import { unwrap, unwrapErr } from "../../../lib/result.js";
import { stateHomePaths } from "../../../stateHome.js";
import { chairWakeLine } from "../../../talk/chairWake.js";
import { formRelayDraft, relaySlug } from "../../../talk/relayDraft.js";
import { relayLineHead, relayLineVerify } from "../../../talk/relayLine.js";
import { claimTurn, readTurn } from "../../../talk/relayStore.js";

const TURN = "a0000015-0000-4000-8000-000000000016";
const SLUG = relaySlug({ turnId: TURN });
const SESSION = "29b5a8a6-2f6e-4b95-a16e-5092d762a399";
const LINE = "a0000005-0000-4000-8000-000000000005";
const CALL = "a0000037-c03e-4c6b-95fb-9e0a4b3c2d64";
const ANCHOR = `transcript:${SESSION}#${LINE}`;

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "owner-words-console-"));
  const draft = unwrap(
    formRelayDraft({
      about: "",
      heard: "ship it",
      picture: { kind: "none", reason: "screen-not-shared" },
      readsAfter: [],
      say: "the voice's paraphrase, never quoted",
      triageRuling: undefined,
      turnId: TURN,
      typed: false,
      wordsAlone: false,
    }),
  );
  unwrap(claimTurn({ draft, home, nowIso: "2026-09-28T06:03:54.584Z" }));
});

afterEach(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The chair transcript, holding one turn whose text is `text`, recorded as typed. */
function chairTurn({ text }: { text: string }): void {
  mkdirSync(join(home, "projects", "-repo"), { recursive: true });
  const line = JSON.stringify({
    cwd: "/repo",
    message: { content: [{ text, type: "text" }], role: "user" },
    promptSource: "typed",
    timestamp: "2026-09-28T06:04:10.000Z",
    type: "user",
    uuid: LINE,
  });
  writeFileSync(join(home, "projects", "-repo", `${SESSION}.jsonl`), `${line}\n`);
}

/** The delivery line the console types for the relay at {@link TURN}: the owner's words inside the console's instructions. */
const DELIVERY = `${relayLineHead({ slug: SLUG })}they said: "ship it" — act on it, then reply in one line${relayLineVerify({ slug: SLUG })}`;

function resolve(): ReturnType<typeof resolveHisWords> {
  return resolveHisWords({ anchor: ANCHOR, home, projectsDir: join(home, "projects") });
}

const NOT_OWNERS = `${ANCHOR} is a line the console typed into the chair, not words the owner wrote — anchor on`;

/** The refusal naming the claimed relay's exact anchor, though the relay is on disk and holds the owner's words. */
const EXACT = `${NOT_OWNERS} the relay it delivered, talk:${TURN}`;

describe("resolveHisWords at a chair turn the console typed", () => {
  it("refuses a relay's delivery line, naming the exact talk: anchor of the relay it delivered, which resolves", () => {
    chairTurn({ text: DELIVERY });

    const error = unwrapErr(resolve());
    const suggested = error.message.slice(error.message.lastIndexOf(" ") + 1);
    const followed = unwrap(resolveHisWords({ anchor: suggested, home, projectsDir: join(home, "projects") }));

    expect([error.code, error.message, followed.words]).toEqual(["TURN_CONSOLE_LINE", EXACT, "ship it"]);
  });

  it("refuses a delivery line inside a paste wrapper, and one with the first lines' older tail, naming the relay alike", () => {
    chairTurn({ text: `<pasted_content id="p1">${DELIVERY}</pasted_content>` });
    const pasted = unwrapErr(resolve()).message;
    chairTurn({
      text: `${relayLineHead({ slug: SLUG })}they said: "ship it" — row ${SLUG} carries all of it; verify with slopweaver talk log.`,
    });
    const older = unwrapErr(resolve()).message;

    expect([pasted, older]).toEqual([EXACT, EXACT]);
  });

  it("refuses a turn opening with the relay marker that names no delivery, still naming the relay its head names", () => {
    chairTurn({ text: `${relayLineHead({ slug: SLUG })}why did this not go out?` });

    expect(unwrapErr(resolve()).message).toBe(EXACT);
  });

  it("names the slug alone when no turn file on disk carries it", () => {
    const stranger = "talk-0123456789ab";
    chairTurn({ text: `${relayLineHead({ slug: stranger })}they said: "x"${relayLineVerify({ slug: stranger })}` });

    expect(unwrapErr(resolve()).message).toBe(
      `${NOT_OWNERS} relay ${stranger}'s own turn (talk:<turn>; the slug picks out no one readable turn on disk), ` +
        "which `slopweaver profile words` lists",
    );
  });

  it("names the slug alone when a second file shares it, though that file will not read", () => {
    const collider = `${TURN.slice(0, 14)}0000-0000-000000000000`;
    writeFileSync(join(stateHomePaths({ home }).talkTurns, `${collider}.json`), "not a turn");
    chairTurn({ text: DELIVERY });

    expect([relaySlug({ turnId: collider }), unwrapErr(resolve()).message]).toEqual([
      SLUG,
      `${NOT_OWNERS} relay ${SLUG}'s own turn (talk:<turn>; the slug picks out no one readable turn on disk), ` +
        "which `slopweaver profile words` lists",
    ]);
  });

  it("names the slug alone when the one file carrying it reads but is no v4 id, so no talk: anchor would resolve", () => {
    const notV4 = `${TURN.slice(0, 14)}1${TURN.slice(15)}`;
    const turns = stateHomePaths({ home }).talkTurns;
    const record = readFileSync(join(turns, `${TURN}.json`), "utf8");
    writeFileSync(join(turns, `${notV4}.json`), record.replaceAll(TURN, notV4));
    rmSync(join(turns, `${TURN}.json`));
    chairTurn({ text: DELIVERY });

    expect([readTurn({ home, turnId: notV4 }).isOk(), unwrapErr(resolve()).message]).toEqual([
      true,
      `${NOT_OWNERS} relay ${SLUG}'s own turn (talk:<turn>; the slug picks out no one readable turn on disk), ` +
        "which `slopweaver profile words` lists",
    ]);
  });

  it("stays a console-line refusal when the turn files will not list, naming the slug and why", () => {
    const turns = stateHomePaths({ home }).talkTurns;
    rmSync(turns, { force: true, recursive: true });
    writeFileSync(turns, "a file where the directory belongs");
    chairTurn({ text: DELIVERY });

    const error = unwrapErr(resolve());

    expect(error.code).toBe("TURN_CONSOLE_LINE");
    expect(error.message).toContain(
      `${NOT_OWNERS} relay ${SLUG}'s own turn (talk:<turn>; the turn files would not list: `,
    );
  });

  it("reads a dangling symlink where the turn files belong as unlistable, never as no turns at all", () => {
    const turns = stateHomePaths({ home }).talkTurns;
    rmSync(turns, { force: true, recursive: true });
    symlinkSync(join(home, "nowhere"), turns);
    chairTurn({ text: DELIVERY });

    const error = unwrapErr(resolve());

    expect(error.code).toBe("TURN_CONSOLE_LINE");
    expect(error.message).toContain(
      `${NOT_OWNERS} relay ${SLUG}'s own turn (talk:<turn>; the turn files would not list: `,
    );
  });

  it("refuses a chair wake line with the generic route, since its head names no relay", () => {
    chairTurn({ text: chairWakeLine({ callId: CALL }) });

    expect(unwrapErr(resolve()).message).toBe(
      `${NOT_OWNERS} the relay itself (talk:<turn>) or the call words a wake points at (talk-call:<call>#<segment>), ` +
        "which `slopweaver profile words` lists",
    );
  });

  it("still quotes a turn the owner typed that merely mentions a relay", () => {
    chairTurn({ text: `what happened to ${relayLineHead({ slug: SLUG })}?` });

    expect(unwrap(resolve()).words).toBe(`what happened to [voice relay ${SLUG}] ?`);
  });
});
