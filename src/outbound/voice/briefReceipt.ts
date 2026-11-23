/**
 * Whether a visible session drafting in the owner's name has had their complete voice brief put in front of it — the pure half.
 *
 * A session drafting a message for the owner without access to their voice rules is a P0, the same as an agent not
 * loading the owner's profile. The console voice is minted with the brief (`../../talk/mintVoiceBrief.ts`) and the Codex comparison is
 * handed it (`../../codex/slackDraft.ts`), but a Claude Code or Codex seat drafting through `slack draft record --as me`
 * was only TOLD to run `slack voice-rules` first. A receipt makes that checkable: `slack voice-rules` writes one naming
 * the session and the digest of the brief it printed, and an as-me draft or send from a session holding none for the
 * CURRENT brief is refused with the brief printed (`./briefingAdmission.ts`).
 *
 * The digest is over the RENDERED brief (`./composerBrief.ts`), so a changed shape, rule, spacing setting or renderer
 * all invalidate an old receipt. A receipt stores no word of the brief itself.
 *
 * Pure: hashing is a function of its input.
 */
import { createHash } from "node:crypto";

import { isRecord } from "#lib/parsers.js";

import type { SupervisorSessionDetection } from "../../supervisor/session.js";
import type { VoiceRuleBrief } from "./briefStore.js";
import { voiceRuleBriefLines } from "./composerBrief.js";

/** One session's proof it was briefed: who, on which brief, when. */
export interface VoiceBriefReceipt {
  readonly version: 1;
  /** `<host>:<id>` of the visible session, as `supervisorSessionKey` spells it. */
  readonly session: string;
  /** `sha256:<hex>` of the rendered brief the session was shown. */
  readonly briefDigest: string;
  readonly briefedAtIso: string;
}

/** The version tag mixed into the digest, so a change to what is hashed retires every older receipt. */
const DIGEST_VERSION = "voice-brief-v1";

/** A digest as a receipt carries it. */
const DIGEST_SHAPE = /^sha256:[0-9a-f]{64}$/;

/**
 * Whether this installation configured no voice at all, so there is nothing a draft could be briefed on.
 *
 * @param brief what `loadVoiceRuleBrief` read
 * @returns true when there is no shape, no rule and no spacing rule
 */
export function briefIsUnconfigured({ brief }: { brief: VoiceRuleBrief }): boolean {
  return brief.shape === null && brief.rules.length === 0 && !brief.paragraphSpacing;
}

/**
 * The digest of the brief exactly as a composer is shown it.
 *
 * @param brief what `loadVoiceRuleBrief` read
 * @returns `sha256:<64 hex>`
 */
export function voiceBriefDigest({ brief }: { brief: VoiceRuleBrief }): string {
  const { paragraphSpacing, rules, shape } = brief;
  const rendered = voiceRuleBriefLines({ paragraphSpacing, rules, shape }).join("\n");
  return `sha256:${createHash("sha256").update(`${DIGEST_VERSION}\n${rendered}`, "utf8").digest("hex")}`;
}

/**
 * Whether `text` is an instant exactly as `toISOString` writes one: `Date.parse` alone also takes `"0"` or `"2026"`.
 *
 * @param text the receipt's `briefedAtIso`
 * @returns true only for the writer's own spelling
 */
function isExactIsoInstant({ text }: { text: string }): boolean {
  const ms = Date.parse(text);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === text;
}

/**
 * The exact bytes a receipt file holds: its four fields in a fixed order, one line.
 *
 * @param receipt the receipt to write
 * @returns the file's contents, newline-terminated
 */
export function encodeVoiceBriefReceipt({ receipt }: { receipt: VoiceBriefReceipt }): string {
  const { briefDigest, briefedAtIso, session, version } = receipt;
  return `${JSON.stringify({ version, session, briefDigest, briefedAtIso })}\n`;
}

/**
 * A receipt's own bytes read back, strictly: anything but what the writer would write is no receipt.
 *
 * @param text the file's contents
 * @returns the receipt, or `undefined` when the text is not one
 */
export function decodeVoiceBriefReceipt({ text }: { text: string }): VoiceBriefReceipt | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const { briefDigest, briefedAtIso, session, version } = value;
  if (
    version !== 1 ||
    typeof session !== "string" ||
    session.length === 0 ||
    typeof briefDigest !== "string" ||
    !DIGEST_SHAPE.test(briefDigest) ||
    typeof briefedAtIso !== "string" ||
    !isExactIsoInstant({ text: briefedAtIso })
  ) {
    return undefined;
  }
  const receipt: VoiceBriefReceipt = { briefDigest, briefedAtIso, session, version };
  // Byte-equal to the writer's own output: an extra key, a duplicate key or any other byte is not a receipt, so no
  // word of the brief can ride in one.
  return encodeVoiceBriefReceipt({ receipt }) === text ? receipt : undefined;
}

/** What the briefing check concluded for one as-me draft or send. */
export type BriefingVerdict =
  | { readonly kind: "admitted"; readonly via: "unconfigured" | "no-session" | "receipt" | "hatch" }
  | { readonly kind: "ambiguous-session" }
  | { readonly kind: "unbriefed"; readonly session: string; readonly briefDigest: string };

/**
 * Whether this draft may proceed, from what was read.
 *
 * No visible session is ADMITTED, and that is `AGENTS.md` rule 2 rather than a hole: no model runs headless here, so a
 * process with neither id is a person's shell or the console server carrying words the console voice wrote under
 * its minted brief (`site/app/api/talk/draft/route.ts`). Two ids at once is a process two harnesses leaked into, and
 * it is refused rather than guessed, exactly as a hatch grant is (`../../hatch/grantSession.ts`).
 *
 * @param brief the owner's current brief
 * @param detection which visible session this process belongs to
 * @param receipt the receipt that session holds, if any
 * @param hatchIsOpen whether the journalled `voice-briefing` hatch is open for this session
 * @returns the verdict
 */
export function briefingVerdict({
  brief,
  detection,
  receipt,
  hatchIsOpen,
}: {
  brief: VoiceRuleBrief;
  detection: SupervisorSessionDetection;
  receipt: VoiceBriefReceipt | undefined;
  hatchIsOpen: boolean;
}): BriefingVerdict {
  if (briefIsUnconfigured({ brief })) {
    return { kind: "admitted", via: "unconfigured" };
  }
  if (detection.kind === "missing") {
    return { kind: "admitted", via: "no-session" };
  }
  if (detection.kind === "ambiguous") {
    return { kind: "ambiguous-session" };
  }
  const session = `${detection.session.host}:${detection.session.id}`;
  const briefDigest = voiceBriefDigest({ brief });
  if (receipt?.session === session && receipt.briefDigest === briefDigest) {
    return { kind: "admitted", via: "receipt" };
  }
  if (hatchIsOpen) {
    return { kind: "admitted", via: "hatch" };
  }
  return { briefDigest, kind: "unbriefed", session };
}
