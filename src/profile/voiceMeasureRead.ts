/**
 * The read edge of `profile voice measure`: whose messages, and the owner's Slack records out of bronze.
 *
 * Bronze is data-scale — the compacted Slack window alone can run to several GB (`../cli/commands/sessionStart/slackRead.ts`)
 * — so this STREAMS every file a line at a time through `readJsonlLines` and keeps only the records the owner authored. A
 * line not carrying the owner's id is never parsed. Files are read in canonical bronze order (`scanJsonl`, the compacted
 * file first), which the logical-latest collapse in the core depends on.
 *
 * Every way of measuring nothing is a named SKIP, and every way of measuring wrong is a typed error: a profile that
 * cannot be trusted, a file that cannot be read, a line naming the owner that will not parse. A measurement that silently
 * missed one of the owner's messages would overwrite a good cohort with a worse one and nothing would say so.
 */
import { statSync } from "node:fs";

import { corpusWalkJudgeFor, type OwnerProtectionResolver, protectionResolver } from "../corpus/bronzeProtection.js";
import { bronzeSourceDir } from "../corpus/corpusPaths.js";
import { parseRow } from "../corpus/corpusRowCore.js";
import { protectedSkipWarnings, readJsonlLines, scanJsonlGuarded } from "../corpus/corpusStore.js";
import type { CorpusRecord } from "../corpus/types.js";
import { err, ok, type Result } from "../lib/result.js";
import { safeFs } from "../lib/safeBoundary.js";
import { readProfile } from "../profileStore.js";

import { measureSlackVoice, type SlackVoiceMeasurement } from "./voiceMeasure.js";
import { type VoiceMeasureError, VoiceMeasureErrors } from "./voiceMeasureErrors.js";

/**
 * Why a measurement measured or kept nothing. None of these writes anything, and none is a failure. The last is the
 * write's own (`./voiceMeasureWrite.ts`): the register's rows hang off the owner's row by foreign key.
 *
 * @internal — named outside this module only through {@link VoiceMeasureSkipped}'s `reason`.
 */
export type VoiceMeasureSkipReason =
  "owner-user-id-absent" | "no-slack-bronze" | "no-eligible-messages" | "owner-row-absent";

/**
 * A measurement that measured nothing, the sentence saying why, and what the protect list kept out of the walk —
 * empty when the skip came before any walk, so every outcome past one says what it skipped.
 */
export interface VoiceMeasureSkipped {
  readonly kind: "skipped";
  readonly reason: VoiceMeasureSkipReason;
  readonly message: string;
  readonly notRead: readonly string[];
}

/** What reading the owner's Slack produced: a measurement with at least one cohort, or a named skip. */
export type VoiceMeasureReadOutcome =
  | {
      readonly kind: "measured";
      readonly measurement: SlackVoiceMeasurement;
      readonly filesRead: number;
      /** One line per path the owner's protect list kept out of the walk: the measurement is short by these. */
      readonly notRead: readonly string[];
    }
  | (VoiceMeasureSkipped & { readonly measurement?: SlackVoiceMeasurement });

/** The Slack bronze files a measurement reads, in canonical order, and what the protect list kept out of the walk. */
interface SlackBronzeFiles {
  readonly paths: readonly string[];
  readonly notRead: readonly string[];
}

/** The owner's Slack user id, a skip naming why there is none, or why the profile cannot be trusted. */
function ownerUserIdOf({ home }: { home: string }): Result<string | VoiceMeasureSkipped, VoiceMeasureError> {
  const profile = readProfile({ home });
  if (profile.isErr()) {
    return err(VoiceMeasureErrors.profileUnreadable({ detail: profile.error.message, path: profile.error.path }));
  }
  const ownerUserId = profile.value?.slackBot?.ownerUserId;
  if (ownerUserId === undefined || ownerUserId.length === 0) {
    return ok({
      kind: "skipped",
      message:
        "profile.json declares no `slackBot.ownerUserId`, so nothing can tell the owner's Slack messages from anybody else's",
      notRead: [],
      reason: "owner-user-id-absent",
    });
  }
  return ok(ownerUserId);
}

/**
 * The Slack bronze files in canonical order, a skip when there are none, or why the directory cannot be read. The
 * owner's protect list judges the directory before it is even statted and every step of the walk, so a protected
 * corpus is a refusal, never the skip an absent one is. A covered entry BELOW the directory is skipped and named in
 * `notRead`, so the measurement says what it is short by rather than missing it in silence.
 */
function slackBronzeFiles({
  home,
  protection,
}: {
  home: string;
  protection: OwnerProtectionResolver | undefined;
}): Result<SlackBronzeFiles | VoiceMeasureSkipped, VoiceMeasureError> {
  const dir = bronzeSourceDir({ home, source: "slack" });
  const noBronze = ({ notRead }: { notRead: readonly string[] }): VoiceMeasureSkipped => ({
    kind: "skipped",
    message: "this home holds no Slack corpus yet — a Slack refresh writes it",
    notRead,
    reason: "no-slack-bronze",
  });
  const judge = corpusWalkJudgeFor({
    operation: { target: "the owner's Slack voice", verb: "measure" },
    protection: protectionResolver({ home, protection }),
  }).andThen((walk) => walk.judge({ access: "list", path: dir }).map(() => walk));
  if (judge.isErr()) {
    return err(VoiceMeasureErrors.corpusProtected({ lines: judge.error }));
  }
  const statted = safeFs({ execute: () => statSync(dir).isDirectory(), operation: "voiceMeasure.stat", path: dir });
  if (statted.isErr()) {
    if (statted.error.code === "ENOENT") {
      return ok(noBronze({ notRead: [] }));
    }
    return err(VoiceMeasureErrors.corpusUnreadable({ detail: statted.error.message, path: dir }));
  }
  const scanned = scanJsonlGuarded({ dir, walk: judge.value });
  if (scanned.isErr()) {
    return err(VoiceMeasureErrors.corpusProtected({ lines: scanned.error }));
  }
  const scan = scanned.value;
  const [unreadable] = scan.unreadableDirs;
  if (unreadable !== undefined) {
    return err(VoiceMeasureErrors.corpusUnreadable({ detail: "the directory could not be listed", path: unreadable }));
  }
  const notRead = protectedSkipWarnings({ scan });
  if (scan.files.length === 0) {
    return ok(noBronze({ notRead }));
  }
  return ok({ notRead, paths: scan.files.map((file) => file.path) });
}

/** Stream one file, keeping every record naming the owner, or the first reason it could not be read whole. */
function collectFile({
  path,
  ownerUserId,
  into,
}: {
  path: string;
  ownerUserId: string;
  into: CorpusRecord[];
}): VoiceMeasureError | undefined {
  let malformed: VoiceMeasureError | undefined;
  const read = safeFs({
    execute: () => {
      readJsonlLines({
        onLine: ({ line, index }) => {
          // A `\u` escape can spell the owner's id without its bytes, so such a line is parsed too: bronze is written by
          // JSON.stringify, which escapes only control characters and lone surrogates, so these lines are rare.
          if (malformed !== undefined || !(line.includes(ownerUserId) || line.includes("\\u"))) {
            return;
          }
          const row = parseRow({ line, projection: "bronze" });
          if ("error" in row) {
            malformed = VoiceMeasureErrors.rowMalformed({ detail: row.error, line: index, path });
            return;
          }
          if (row.record.author === ownerUserId) {
            into.push(row.record);
          }
        },
        path,
      });
    },
    operation: "voiceMeasure.read",
    path,
  });
  if (read.isErr()) {
    return VoiceMeasureErrors.corpusUnreadable({ detail: read.error.message, path });
  }
  return malformed;
}

/**
 * Read the owner's Slack messages out of bronze and measure them.
 *
 * @param home the Slopweaver home whose profile and corpus are read
 * @param nowIso the instant the measurement is stamped with
 * @param protection an injected resolver, which a test supplies so it never reads the owner's own registry
 * @returns the measurement, a named skip, or why it could not be taken
 */
export function readSlackVoiceMeasurement({
  home,
  nowIso,
  protection,
}: {
  home: string;
  nowIso: string;
  protection?: OwnerProtectionResolver | undefined;
}): Result<VoiceMeasureReadOutcome, VoiceMeasureError> {
  const owner = ownerUserIdOf({ home });
  if (owner.isErr()) {
    return err(owner.error);
  }
  if (typeof owner.value !== "string") {
    return ok(owner.value);
  }
  const ownerUserId = owner.value;
  const files = slackBronzeFiles({ home, protection });
  if (files.isErr()) {
    return err(files.error);
  }
  if ("kind" in files.value) {
    return ok(files.value);
  }
  const { paths, notRead } = files.value;
  const records: CorpusRecord[] = [];
  for (const path of paths) {
    const failed = collectFile({ into: records, ownerUserId, path });
    if (failed !== undefined) {
      return err(failed);
    }
  }
  const measurement = measureSlackVoice({ nowIso, ownerUserId, records });
  if (measurement.cohorts.length === 0) {
    return ok({
      kind: "skipped",
      measurement,
      message: `none of the ${String(measurement.counts.ownerMessageVersions)} Slack message version(s) authored as the owner is one they typed with words in it`,
      notRead,
      reason: "no-eligible-messages",
    });
  }
  return ok({ filesRead: paths.length, kind: "measured", measurement, notRead });
}
