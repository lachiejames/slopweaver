/**
 * The briefing check every as-me Slack draft and send passes before it reads stdin, a token or the network — and the
 * receipt `slack voice-rules` writes once it has printed the brief. The pure verdict is `./briefReceipt.ts`; this is
 * the effectful shell around it: the owner's brief read fresh, the session read off the environment, one small file per
 * session under `$SLOPWEAVER_HOME/sessions/voice-brief-receipts/` (owner-only, holding a digest and never a word of
 * the brief).
 *
 * An unbriefed session is refused and SHOWN the brief in the same breath, and its receipt is written, so one refusal
 * leaves the session briefed: it redrafts from the brief and runs the same command again. The residue is stated:
 * this cannot stop a model composing a first body before it calls the verb, only that body parking or sending; and a
 * receipt proves the brief reached the session's context, not that every line was heeded.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import { writeFileAtomic } from "#lib/writeAtomic.js";

import { hatchFor } from "../../hatch/lookup.js";
import { hatchOpen } from "../../hatch/open.js";
import { hatchRefusalLines } from "../../hatch/render.js";
import { stateHomePaths } from "../../stateHome.js";
import { detectSupervisorSession } from "../../supervisor/session.js";
import {
  briefIsUnconfigured,
  briefingVerdict,
  decodeVoiceBriefReceipt,
  encodeVoiceBriefReceipt,
  type VoiceBriefReceipt,
  voiceBriefDigest,
} from "./briefReceipt.js";
import { loadVoiceRuleBrief, type VoiceRuleBrief } from "./briefStore.js";
import { voiceRuleBriefLines } from "./composerBrief.js";

/** The heading the refusal prints over the brief, so a reader can tell the policy lines from the owner's voice. */
export const BRIEF_FOLLOWS_HEADING = "THE OWNER'S VOICE BRIEF, in full — draft to this:";

/**
 * Where one session's receipt lives. The file is named by a hash of the session key, so an environment value never
 * becomes a path.
 *
 * @param home the Slopweaver home
 * @param session the `<host>:<id>` key
 * @returns the receipt's path
 */
export function voiceBriefReceiptPath({ home, session }: { home: string; session: string }): string {
  const name = createHash("sha256").update(session, "utf8").digest("hex").slice(0, 32);
  return join(stateHomePaths({ home }).voiceBriefReceipts, `${name}.json`);
}

/**
 * The receipt a session holds. No file, or a file that is not a receipt, is none: either way it is refused and
 * rewritten, never admitted.
 *
 * @param home the Slopweaver home
 * @param session the `<host>:<id>` key
 * @returns the receipt, `undefined` when there is none, or why the file could not be read at all
 */
function readReceipt({ home, session }: { home: string; session: string }): Result<VoiceBriefReceipt | undefined> {
  let bytes: Buffer;
  try {
    bytes = readFileSync(voiceBriefReceiptPath({ home, session }));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return ok(undefined);
    }
    return receiptFailure({ act: "read", error });
  }
  const text = bytes.toString("utf8");
  // Byte-equal, not string-equal: invalid UTF-8 decodes to U+FFFD, which no comparison of the decoded text can see.
  return ok(Buffer.from(text, "utf8").equals(bytes) ? decodeVoiceBriefReceipt({ text }) : undefined);
}

/**
 * Why a receipt file could not be read or written — one message for both, since a caller only ever prints it.
 *
 * @param act which half of the file's life failed
 * @param error what the filesystem threw
 * @returns the failure
 */
function receiptFailure({ act, error }: { act: "read" | "write"; error: unknown }): Result<never> {
  return err([`could not ${act} the voice-brief receipt: ${error instanceof Error ? error.message : String(error)}`]);
}

/**
 * Write one session's receipt, owner-only.
 *
 * @param home the Slopweaver home
 * @param receipt what to write
 * @returns `true`, or why it could not be written
 */
function writeReceipt({ home, receipt }: { home: string; receipt: VoiceBriefReceipt }): Result<true> {
  try {
    writeFileAtomic({
      contents: encodeVoiceBriefReceipt({ receipt }),
      dirMode: 0o700,
      exactMode: true,
      fileMode: 0o600,
      path: voiceBriefReceiptPath({ home, session: receipt.session }),
    });
    return ok(true);
  } catch (error) {
    return receiptFailure({ act: "write", error });
  }
}

/**
 * Record that this session has just been shown the brief — what `slack voice-rules` calls once it has printed it.
 *
 * @param brief the brief that was printed
 * @param env the environment the visible session is read from
 * @param home the Slopweaver home
 * @param nowIso the instant it was shown
 * @returns `recorded`, `no-session` when no single visible session can be named, or why the write failed
 */
export function recordVoiceBriefing({
  brief,
  env,
  home,
  nowIso,
}: {
  brief: VoiceRuleBrief;
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  nowIso: string;
}): Result<"recorded" | "no-session"> {
  const detection = detectSupervisorSession({ env });
  if (detection.kind !== "active" || briefIsUnconfigured({ brief })) {
    return ok("no-session");
  }
  const session = `${detection.session.host}:${detection.session.id}`;
  return writeReceipt({
    home,
    receipt: { briefDigest: voiceBriefDigest({ brief }), briefedAtIso: nowIso, session, version: 1 },
  }).map(() => "recorded" as const);
}

/**
 * The lines an unbriefed session is refused with, before its receipt is written: the registered four, then the whole
 * brief.
 *
 * @param brief the owner's current brief
 * @returns the lines, in print order
 */
function unbriefedRefusalLines({ brief }: { brief: VoiceRuleBrief }): readonly string[] {
  const { paragraphSpacing, rules, shape } = brief;
  return [
    ...hatchRefusalLines({ hatch: hatchFor({ id: "voice-briefing" }) }),
    "",
    BRIEF_FOLLOWS_HEADING,
    ...voiceRuleBriefLines({ paragraphSpacing, rules, shape }),
    "",
  ];
}

/**
 * What an unbriefed session is told once the brief is printed and its receipt write was attempted.
 *
 * @param receiptWritten whether the session now holds a receipt
 * @returns the one closing line
 */
function unbriefedNextStep({ receiptWritten }: { receiptWritten: boolean }): string {
  return receiptWritten
    ? "Nothing was parked or sent. This session now holds a receipt for the brief above: throw away what you drafted " +
        "without it, redraft from it, then run the same command again."
    : "Nothing was parked or sent, and the receipt could not be written either, so the same command will refuse again.";
}

/**
 * Whether an as-me draft or send may proceed in this session. Called after argv is parsed and before anything else.
 *
 * @param env the environment the visible session and the hatch grant are read from
 * @param home the Slopweaver home holding the owner's profile and the receipts
 * @param now the clock, read only when a session is named: a hatch grant's expiry and a new receipt are judged at it
 * @param print where an unbriefed session's brief goes, printed in full BEFORE its receipt is written, so a process
 *   killed between the two leaves no receipt for a brief it never showed
 * @returns `ok` when it may proceed, else the lines still to print before exiting non-zero
 */
export function admitVoiceBriefing({
  env,
  home,
  now,
  print,
}: {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  now: () => string;
  print: (line: string) => void;
}): Result<true> {
  const brief = loadVoiceRuleBrief({ home });
  if (brief.isErr()) {
    return err(
      brief.error.map(
        (problem) => `the owner's voice brief could not be read, so nothing was parked or sent: ${problem}`,
      ),
    );
  }
  const detection = detectSupervisorSession({ env });
  const session = detection.kind === "active" ? `${detection.session.host}:${detection.session.id}` : undefined;
  const receipt = session === undefined ? ok(undefined) : readReceipt({ home, session });
  if (receipt.isErr()) {
    return err(receipt.error);
  }
  const verdict = briefingVerdict({
    brief: brief.value,
    detection,
    hatchIsOpen: session !== undefined && hatchOpen({ env, home, id: "voice-briefing", nowIso: now() }),
    receipt: receipt.value,
  });
  if (verdict.kind === "admitted") {
    return ok(true);
  }
  if (verdict.kind === "ambiguous-session") {
    return err([
      ...hatchRefusalLines({
        detail: "both a Claude Code session id and a Codex thread id are set, so no one session can be named",
        hatch: hatchFor({ id: "voice-briefing" }),
      }),
    ]);
  }
  for (const line of unbriefedRefusalLines({ brief: brief.value })) {
    print(line);
  }
  const written = writeReceipt({
    home,
    receipt: { briefDigest: verdict.briefDigest, briefedAtIso: now(), session: verdict.session, version: 1 },
  });
  return err([unbriefedNextStep({ receiptWritten: written.isOk() })]);
}
