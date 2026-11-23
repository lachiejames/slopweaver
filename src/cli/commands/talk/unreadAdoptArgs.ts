/**
 * What `slopweaver talk unread-adopt` ACCEPTS — its flag spec and pure parser. Every refusal is the `talk unread`
 * family's own union (`./unreadArgsErrors.ts`), since adopting moves the same cursor.
 */
import { parseStrictIsoInstantMs } from "#lib/date.js";

import { err, ok, type Result } from "../../../lib/result.js";
import { isAdoptDigest } from "../../../talk/unreadAdopt.js";
import { SUPERVISOR_UNREAD_CURSOR } from "../../../talk/unreadCursorStore.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";
import { flagNames, stringOf } from "./flagValues.js";
import { type UnreadArgsError, UnreadArgsErrors } from "./unreadArgsErrors.js";

/** The flags `talk unread-adopt` accepts. */
const UNREAD_ADOPT_FLAGS = {
  boolean: ["json"],
  string: ["before", "approve", "why", "cursor", "now", "home"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const TALK_UNREAD_ADOPT_FLAG_NAMES: readonly string[] = flagNames({ spec: UNREAD_ADOPT_FLAGS });

/** A parsed `talk unread-adopt` invocation. */
export interface UnreadAdoptArgs {
  /** Every call line stamped strictly before this instant is adopted. */
  readonly before: string;
  /** The digest a preview printed; absent, the verb previews and writes nothing. */
  readonly approve: string | undefined;
  /** Why these words count as read — bound into the digest and written on the receipt. */
  readonly why: string;
  /** The reader whose place moves — `supervisor` unless named. */
  readonly cursor: string;
  /** The instant judged as now: the new cursor's stamp, and the bound `before` may not pass. */
  readonly nowIso: string;
  readonly home: string | undefined;
  readonly json: boolean;
}

/**
 * A strict ISO instant, written back in the one canonical form `Date#toISOString` prints.
 *
 * @param value the candidate
 * @returns the canonical instant, or `undefined` for anything `parseStrictIsoInstantMs` refuses
 */
function canonicalInstant({ value }: { value: string }): string | undefined {
  const ms = parseStrictIsoInstantMs({ text: value });
  if (ms === undefined) {
    return undefined;
  }
  return new Date(ms).toISOString();
}

/**
 * Parse a `talk unread-adopt` invocation.
 *
 * @param rest the argv after the verb
 * @param clockIso the instant to judge as now when `--now` is absent
 * @returns the parsed arguments, or the first refusal
 */
export function parseUnreadAdoptArgs({
  rest,
  clockIso,
}: {
  rest: readonly string[];
  clockIso: string;
}): Result<UnreadAdoptArgs, UnreadArgsError> {
  const parsed = parseFlags({ allowPositionals: false, args: rest, spec: UNREAD_ADOPT_FLAGS });
  if (parsed.isErr()) {
    return err(UnreadArgsErrors.flagsInvalid({ messages: parsed.error }));
  }
  const { values } = parsed.value;
  const now = stringOf({ value: values["now"] });
  let nowIso = clockIso;
  if (now !== undefined) {
    const canonical = canonicalInstant({ value: now });
    if (canonical === undefined) {
      return err(UnreadArgsErrors.nowInvalid({ now }));
    }
    nowIso = canonical;
  }
  const typed = stringOf({ value: values["before"] });
  if (typed === undefined) {
    return err(UnreadArgsErrors.adoptBeforeInvalid());
  }
  const before = canonicalInstant({ value: typed });
  if (before === undefined) {
    return err(UnreadArgsErrors.adoptBeforeInvalid());
  }
  if (Date.parse(before) > Date.parse(nowIso)) {
    return err(UnreadArgsErrors.adoptBeforeFuture({ before, now: nowIso }));
  }
  const approve = stringOf({ value: values["approve"] });
  if (approve !== undefined && !isAdoptDigest({ approve })) {
    return err(UnreadArgsErrors.adoptApproveInvalid());
  }
  // Required on the preview too: the digest binds the reason, so the receipt carries exactly the words approved.
  const why = stringOf({ value: values["why"] });
  if (why === undefined || why.trim() === "") {
    return err(UnreadArgsErrors.adoptWhyMissing());
  }
  let cursor = SUPERVISOR_UNREAD_CURSOR;
  const named = stringOf({ value: values["cursor"] });
  if (named !== undefined) {
    cursor = named;
  }
  return ok({
    approve,
    before,
    cursor,
    home: stringOf({ value: values["home"] }),
    json: values["json"] === true,
    nowIso,
    why,
  });
}
