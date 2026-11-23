/**
 * `slack draft revise | restore`'s flags: the rewritten words or the version to put back, and what they said asking for
 * it (`../../../outbound/slack/draftRevision.ts`). Split out of `./draftCore.ts`, which routes the sub-commands. Pure.
 */
import { err, ok } from "../../../lib/result.js";
import { carriesWords } from "../../../outbound/slack/carriesWords.js";
import {
  REVISION_HEARD_MAX_CHARS,
  REVISION_READING_MAX_CHARS,
  REVISION_READING_MAX_ITEMS,
} from "../../../outbound/slack/draftRevision.js";
import { SlackArgumentErrors, type SlackParsed } from "./argumentErrors.js";
import type { DraftShared, SlackDraftOptions } from "./draftCore.js";

/** The value flags only `revise` and `restore` read, spread into `slack draft`'s flag spec. */
export const DRAFT_REVISION_FLAGS = ["text", "heard", "reading", "version"] as const;

/** What a revision and a restore both record beside the words: their words, the voice's reading, and where. */
export interface DraftRevisionVoice {
  /** their words asking for it — `--heard`. */
  readonly heard?: string | undefined;
  /** The voice's reading of them, one checklist line each — `--reading '<json array>'`. */
  readonly reading?: readonly string[] | undefined;
  /** Where they said it — `--anchor`, a `talk:<turn>` or any anchor a reader can open. */
  readonly anchor?: string | undefined;
}

/** `slack draft revise`, parsed: new words for a held as-me row. */
export interface DraftReviseOptions extends DraftShared, DraftRevisionVoice {
  readonly mode: "revise";
  readonly id: string;
  /** The `--text` value as typed: the words themselves, or `-` for stdin. */
  readonly textSource: string;
}

/** `slack draft restore`, parsed: an earlier version's words put back. */
export interface DraftRestoreOptions extends DraftShared, DraftRevisionVoice {
  readonly mode: "restore";
  readonly id: string;
  readonly version: number;
}

/** Either of the two, as `slack draft` routes them. */
export type DraftRevisionOptions = DraftReviseOptions | DraftRestoreOptions;

/**
 * Build a `revise` or `restore`, or every reason it was refused.
 *
 * @param id the row the sub-command names
 * @param shared the flags every sub-command carries
 * @param sub which of the two
 * @param values the parsed string flags
 * @returns the parsed invocation, or its refusals
 */
export function parseDraftRevision({
  id,
  shared,
  sub,
  values,
}: {
  id: string;
  shared: DraftShared;
  sub: "revise" | "restore";
  values: Readonly<Record<string, string>>;
}): SlackParsed<SlackDraftOptions> {
  const problems: string[] = [];
  const voice = revisionVoiceOf({ problems, values });
  if (sub === "revise") {
    const textSource = values["text"];
    if (textSource === undefined || !carriesWords({ text: textSource })) {
      problems.push("slack draft revise needs --text <the whole rewritten message|->");
    }
    if (textSource === undefined || problems.length > 0) {
      return err(SlackArgumentErrors.argumentsRefused({ reasons: problems }));
    }
    return ok({ id, mode: "revise", textSource, ...voice, ...shared });
  }
  const given = values["version"];
  const version = given === undefined ? Number.NaN : Number(given);
  if (!Number.isInteger(version) || version < 1) {
    problems.push(`slack draft restore needs --version <n>, the version to put back (1 is the parked words)`);
  }
  if (problems.length > 0) {
    return err(SlackArgumentErrors.argumentsRefused({ reasons: problems }));
  }
  return ok({ id, mode: "restore", version, ...voice, ...shared });
}

/** `--heard`, `--reading` and `--anchor`, each checked as the register will read it back. */
function revisionVoiceOf({
  problems,
  values,
}: {
  problems: string[];
  values: Readonly<Record<string, string>>;
}): DraftRevisionVoice {
  const { anchor, heard } = values;
  if (heard !== undefined && (!carriesWords({ text: heard }) || heard.length > REVISION_HEARD_MAX_CHARS)) {
    problems.push(`--heard carries their words, at most ${String(REVISION_HEARD_MAX_CHARS)} characters`);
  }
  if (anchor !== undefined && !carriesWords({ text: anchor })) {
    problems.push("--anchor names where they said it");
  }
  const reading = readingOf({ given: values["reading"], problems });
  return {
    ...(heard === undefined ? {} : { heard }),
    ...(reading === undefined ? {} : { reading }),
    ...(anchor === undefined ? {} : { anchor }),
  };
}

/** `--reading`'s JSON array of checklist lines, or `undefined` when absent or refused. */
function readingOf({ given, problems }: { given: string | undefined; problems: string[] }): string[] | undefined {
  if (given === undefined) {
    return undefined;
  }
  const refusal =
    `--reading is a JSON array of 1-${String(REVISION_READING_MAX_ITEMS)} short lines, each at most ` +
    `${String(REVISION_READING_MAX_CHARS)} characters: --reading '["cut the second paragraph","tag Ari"]'`;
  let parsed: unknown;
  try {
    parsed = JSON.parse(given);
  } catch {
    problems.push(refusal);
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > REVISION_READING_MAX_ITEMS) {
    problems.push(refusal);
    return undefined;
  }
  const lines: string[] = [];
  for (const line of parsed) {
    if (typeof line !== "string" || !carriesWords({ text: line }) || line.length > REVISION_READING_MAX_CHARS) {
      problems.push(refusal);
      return undefined;
    }
    lines.push(line);
  }
  return lines;
}
