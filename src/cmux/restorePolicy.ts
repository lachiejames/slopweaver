/**
 * cmux's own restore policy — `terminal.autoResumeAgentSessions` in `~/.config/cmux/cmux.json` — read, and set
 * to `false` by the smallest edit that keeps every comment, line ending and byte of the owner's file that is not the edit.
 *
 * ## Why the fleet wants it off
 *
 * With the key at its default (`true`), reopening cmux relaunches every Claude seat as a bare
 * `claude --resume <id>` — no setup-token descriptor, in no particular order. Off, cmux restores panes as idle shells
 * and `slopweaver fleet resume` brings the seats back itself, the supervisor first, each on its routed plan's setup
 * token, or that plan's store where it holds none.
 *
 * ## Why a hand-written scanner
 *
 * The file is JSONC: the owner's runs to hundreds of lines, most of them `//` comments, and a parse-and-reserialise would
 * drop every one. A JSONC library would be a dependency bought for one key (the same call
 * `../monitor/filterInstall.ts` records for its own read of this file). So `scanJsonc` (`./restorePolicyJsonc.ts`)
 * yields the structural tokens with their offsets — skipping `//` and `/* *\/` comments and strings with escapes —
 * and the edit is a splice at those offsets.
 *
 * ## Exactly three edits, and a self-check on each
 *
 * A literal `true` flipped to `false`; the key inserted as the first member of an existing `terminal` object; or a
 * `terminal` object inserted as the first root member (`./restorePolicyEdits.ts`). Anything else — a duplicate key,
 * a value that is not a boolean, a `terminal` that is not an object, an unterminated string or comment — is refused
 * with the one line to add by hand. Before an edit is returned it is re-scanned: it must read `off`, and its token
 * stream must equal the input's except for exactly the inserted run or the one swapped literal
 * ({@link planRestorePolicyOff}).
 *
 * RESIDUE, stated: the scanner is lenient where strict JSON is not — a bare word such as `True` reads as one token,
 * and a raw tab or an escaped newline inside a string is passed over — so a few malformed files are edited rather
 * than refused. Each edit still keeps every byte outside its own run, so what was malformed stays exactly as it was.
 */
import { err, ok, type Result } from "#lib/result.js";

import {
  type Analysed,
  type CandidateEdit,
  flipEdit,
  type IntendedChange,
  insertKeyEdit,
  insertTerminalEdit,
  type PolicyLocation,
  RESUME_KEY,
  restorePolicyComment,
  TERMINAL_KEY,
} from "./restorePolicyEdits.js";
import { type RestorePolicyError, RestorePolicyErrors } from "./restorePolicyErrors.js";
import { type JsoncToken, parseValue, refusedAt, scanJsonc } from "./restorePolicyJsonc.js";

/** What cmux's restore policy reads as. */
export type RestorePolicyReading =
  { readonly kind: "off" } | { readonly kind: "on-default" } | { readonly kind: "on-explicit" };

/** What setting the policy off would do to the file. */
export type RestorePolicyPlan =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "edited";
      readonly configText: string;
      readonly how: "flipped" | "inserted-key" | "inserted-terminal";
    };

/** Find the root object, its `terminal` member and that object's policy key, refusing anything ambiguous. */
function locate({
  text,
  tokens,
}: {
  text: string;
  tokens: readonly JsoncToken[];
}): Result<PolicyLocation, RestorePolicyError> {
  const parsed = parseValue({ at: 0, text, tokens });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const root = parsed.value.node;
  if (root.kind !== "object") {
    return err(RestorePolicyErrors.shapeRefused({ reason: "the file's top level is not an object" }));
  }
  if (parsed.value.next !== tokens.length) {
    return err(refusedAt({ text, token: tokens[parsed.value.next], what: "content after the top-level object" }));
  }
  const terminals = root.members.filter((member) => member.key === TERMINAL_KEY);
  const [terminalMember, secondTerminal] = terminals;
  if (secondTerminal !== undefined) {
    return err(refusedAt({ text, token: tokens[secondTerminal.keyIndex], what: `a second "${TERMINAL_KEY}" key` }));
  }
  if (terminalMember === undefined) {
    return ok({ resume: undefined, root, terminal: undefined });
  }
  const terminal = terminalMember.value;
  if (terminal.kind !== "object") {
    return err(refusedAt({ text, token: tokens[terminalMember.keyIndex], what: `"${TERMINAL_KEY}" is not an object` }));
  }
  const [resume, secondResume] = terminal.members.filter((member) => member.key === RESUME_KEY);
  if (secondResume !== undefined) {
    return err(refusedAt({ text, token: tokens[secondResume.keyIndex], what: `a second "${RESUME_KEY}" key` }));
  }
  if (resume === undefined) {
    return ok({ resume: undefined, root, terminal });
  }
  const value = resume.value;
  const notBoolean = refusedAt({ text, token: tokens[resume.keyIndex], what: `"${RESUME_KEY}" is not true or false` });
  if (value.kind !== "scalar") {
    return err(notBoolean);
  }
  const raw = tokens[value.index]?.raw;
  if (raw !== "true" && raw !== "false") {
    return err(notBoolean);
  }
  return ok({ resume: { member: resume, valueIndex: value.index }, root, terminal });
}

/** Scan, parse and locate in one step. */
function analyse({ text }: { text: string }): Result<Analysed, RestorePolicyError> {
  const tokens = scanJsonc({ text });
  if (tokens.isErr()) {
    return err(tokens.error);
  }
  if (tokens.value.length === 0) {
    return err(RestorePolicyErrors.shapeRefused({ reason: "the file holds no JSON object" }));
  }
  const location = locate({ text, tokens: tokens.value });
  if (location.isErr()) {
    return err(location.error);
  }
  return ok({ location: location.value, tokens: tokens.value });
}

/** What a located policy reads as. */
function readingOf({ analysed }: { analysed: Analysed }): RestorePolicyReading {
  const { resume } = analysed.location;
  if (resume === undefined) {
    return { kind: "on-default" };
  }
  if (analysed.tokens[resume.valueIndex]?.raw === "false") {
    return { kind: "off" };
  }
  return { kind: "on-explicit" };
}

/**
 * Read cmux's restore policy out of its config text.
 *
 * @param configText the whole `cmux.json`, comments and all
 * @returns `off` when the key is `false`, `on-explicit` when it is `true`, `on-default` when it is absent (cmux's
 *   default is on) — or the refusal for a file this verb cannot read safely
 */
export function readRestorePolicy({
  configText,
}: {
  configText: string;
}): Result<RestorePolicyReading, RestorePolicyError> {
  const analysed = analyse({ text: configText });
  if (analysed.isErr()) {
    return err(analysed.error);
  }
  return ok(readingOf({ analysed: analysed.value }));
}

/** The token stream the intended change should produce, as kind/raw pairs. */
function expectedStream({
  before,
  change,
}: {
  before: readonly JsoncToken[];
  change: IntendedChange;
}): readonly string[] {
  const pairs = before.map((token) => `${token.kind}:${token.raw}`);
  if (change.kind === "swap") {
    pairs[change.index] = `word:${change.raw}`;
    return pairs;
  }
  pairs.splice(change.index, 0, ...change.run.map((token) => `${token.kind}:${token.raw}`));
  return pairs;
}

/** Hold a candidate edit to its claim: it reads `off`, and its tokens differ only by the intended change. */
function verifyEdit({
  before,
  candidate,
}: {
  before: readonly JsoncToken[];
  candidate: CandidateEdit;
}): Result<RestorePolicyPlan, RestorePolicyError> {
  const after = analyse({ text: candidate.configText });
  if (after.isErr()) {
    return err(
      RestorePolicyErrors.editUnverified({ detail: `the edited text does not parse: ${after.error.message}` }),
    );
  }
  if (readingOf({ analysed: after.value }).kind !== "off") {
    return err(RestorePolicyErrors.editUnverified({ detail: "the edited text does not read off" }));
  }
  const expected = expectedStream({ before, change: candidate.change });
  const actual = after.value.tokens.map((token) => `${token.kind}:${token.raw}`);
  const same = expected.length === actual.length && expected.every((pair, at) => actual[at] === pair);
  if (!same) {
    return err(RestorePolicyErrors.editUnverified({ detail: "the edit changed more than the one intended token run" }));
  }
  return ok({ configText: candidate.configText, how: candidate.how, kind: "edited" });
}

/**
 * Plan the edit that sets `terminal.autoResumeAgentSessions` to `false`, verified before it is returned.
 *
 * @param configText the whole `cmux.json`, comments and all; CRLF line endings and a leading BOM are kept in the
 *   plan, though `--apply` refuses to write over a file carrying a BOM
 * @param nowIso the instant of the edit, whose date the explanatory comment carries
 * @returns `unchanged` when the policy already reads off, the edited text and which of the three edits made it,
 *   or the refusal — a shape this verb will not edit, or an edit that failed its own self-check
 */
export function planRestorePolicyOff({
  configText,
  nowIso,
}: {
  configText: string;
  nowIso: string;
}): Result<RestorePolicyPlan, RestorePolicyError> {
  const analysed = analyse({ text: configText });
  if (analysed.isErr()) {
    return err(analysed.error);
  }
  const reading = readingOf({ analysed: analysed.value });
  if (reading.kind === "off") {
    return ok({ kind: "unchanged" });
  }
  const eol = configText.includes("\r\n") ? "\r\n" : "\n";
  const comment = restorePolicyComment({ nowIso });
  const { resume, terminal } = analysed.value.location;
  const shared = { analysed: analysed.value, comment, eol, text: configText };
  let candidate: CandidateEdit;
  if (resume !== undefined) {
    candidate = flipEdit({ ...shared, resume });
  } else if (terminal !== undefined) {
    candidate = insertKeyEdit({ ...shared, terminal });
  } else {
    candidate = insertTerminalEdit(shared);
  }
  return verifyEdit({ before: analysed.value.tokens, candidate });
}
