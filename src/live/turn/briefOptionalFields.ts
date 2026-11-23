/**
 * The brief's OPTIONAL fields — each absent on an older or simpler brief, each refused by name when present
 * but malformed. Split out of `./brief.ts`'s one decoder so that decoder stays a list of required checks, and
 * each optional field's own rule (why absence is valid, why malformation is not) sits beside its parser.
 */
import { z } from "zod";

import { isRecord } from "../../lib/parsers.js";
import { err, ok, type Result } from "../../lib/result.js";
import type { StartedChecklist } from "../ask/checklist.js";
import type { InFlightAsk } from "./brief.js";
import { type BriefParseError, BriefParseErrors } from "./errors.js";

/** The brief's `started` field, when present — absent is valid; present-but-malformed is refused. */
function startedField({
  raw,
}: {
  raw: Readonly<Record<string, unknown>>;
}): Result<StartedChecklist | undefined, BriefParseError> {
  const value = raw["started"];
  if (value === undefined) {
    return ok(undefined);
  }
  if (!isRecord(value) || typeof value["turnId"] !== "string" || typeof value["workingTs"] !== "string") {
    return err(BriefParseErrors.invalidStarted());
  }
  return ok({ turnId: value["turnId"], workingTs: value["workingTs"] });
}

/** The brief's `ridesOn`, when present — another message's non-empty ts; absent is valid, anything else refused. */
function ridesOnField({
  raw,
}: {
  raw: Readonly<Record<string, unknown>>;
}): Result<string | undefined, BriefParseError> {
  const value = raw["ridesOn"];
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || value.trim().length === 0 || value === raw["messageTs"]) {
    return err(BriefParseErrors.invalidRidesOn({ value }));
  }
  return ok(value);
}

/**
 * The brief's `unprompted`, when present — `true` alone, written by `turn brief` for an ask `witness help`
 * opened. Absent is a tag; anything else is refused, because a worker misreading which it is either answers a
 * question nobody asked it or opens a tagged answer on "nobody tagged me".
 */
function unpromptedField({
  raw,
}: {
  raw: Readonly<Record<string, unknown>>;
}): Result<true | undefined, BriefParseError> {
  const value = raw["unprompted"];
  if (value === undefined || value === true) {
    return ok(value);
  }
  return err(BriefParseErrors.invalidUnprompted({ value }));
}

/**
 * The brief's `stoodDown`, when present — `true` alone, written by `turn brief` when somebody in the ask's
 * thread stood the bot down earlier. Absent is a thread that never did; anything else is refused, because a
 * worker misreading it either answers a steer it was told to leave or ignores a question it owes.
 */
function stoodDownField({
  raw,
}: {
  raw: Readonly<Record<string, unknown>>;
}): Result<true | undefined, BriefParseError> {
  const value = raw["stoodDown"];
  if (value === undefined || value === true) {
    return ok(value);
  }
  return err(BriefParseErrors.invalidStoodDown({ value }));
}

/** One in-flight ask by the same asker, as the brief carries it — `../ask/burst.ts`'s own `ActiveAsk` shape. */
const activeAskSchema = z.object({
  channel: z.string(),
  messageTs: z.string(),
  state: z.string(),
  threadTs: z.string(),
  userId: z.string(),
});

/**
 * The brief's `otherActiveAsks` field, when present — absent is valid (an older brief, or an asker with
 * nothing else running); present-but-malformed is refused rather than silently dropped, because a judge that
 * cannot see a live holder is exactly the double-work this field exists to prevent.
 */
function otherActiveAsksField({
  raw,
}: {
  raw: Readonly<Record<string, unknown>>;
}): Result<readonly InFlightAsk[] | undefined, BriefParseError> {
  const value = raw["otherActiveAsks"];
  if (value === undefined) {
    return ok(undefined);
  }
  const parsed = z.array(activeAskSchema).safeParse(value);
  if (!parsed.success) {
    return err(BriefParseErrors.invalidCapabilityArray({ field: "otherActiveAsks" }));
  }
  return ok(parsed.data);
}

/**
 * Every optional field the brief carries, decoded — ready to spread onto the parsed brief, with an absent
 * field absent rather than `undefined`.
 *
 * @param raw the decoded brief object
 * @returns the present optional fields, or the first one that is malformed
 */
export function briefOptionalFields({ raw }: { raw: Readonly<Record<string, unknown>> }): Result<
  {
    readonly otherActiveAsks?: readonly InFlightAsk[];
    readonly ridesOn?: string;
    readonly started?: StartedChecklist;
    readonly stoodDown?: true;
    readonly unprompted?: true;
  },
  BriefParseError
> {
  return startedField({ raw }).andThen((started) =>
    otherActiveAsksField({ raw }).andThen((otherActiveAsks) =>
      ridesOnField({ raw }).andThen((ridesOn) =>
        unpromptedField({ raw }).andThen((unprompted) =>
          stoodDownField({ raw }).map((stoodDown) => ({
            ...(otherActiveAsks === undefined ? {} : { otherActiveAsks }),
            ...(started === undefined ? {} : { started }),
            ...(ridesOn === undefined ? {} : { ridesOn }),
            ...(unprompted === undefined ? {} : { unprompted }),
            ...(stoodDown === undefined ? {} : { stoodDown }),
          })),
        ),
      ),
    ),
  );
}
