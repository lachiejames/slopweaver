/**
 * The pure half of `slopweaver profile`: what each verb's flags mean, and what every verb prints.
 *
 * Nothing here opens a connection, reads a file or looks at the clock, so the whole command surface is
 * decidable in a unit test — which matters more than usual for this noun, because the thing being proved
 * is what a session READS, and a renderer nobody can run is a renderer nobody can check.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import type { OwnerProfile } from "../../../store/profile/client.js";
import { judgementLines, voiceCohortLine } from "../../../store/profile/core.js";
import type { PersonJudgement, VoiceCohort } from "../../../store/profile/types.js";
import type { FlagSpec } from "../../parseFlags.js";
import { parseFlags } from "../../parseFlags.js";

/** The flags a read-only verb takes. */
const SHOW_FLAGS: FlagSpec = { boolean: ["json"] };

/** The flags a file-driven write takes. */
const WRITE_FLAGS: FlagSpec = { boolean: ["json"], string: ["file"] };

/** The flags `profile person` takes. */
const PERSON_FLAGS: FlagSpec = { boolean: ["json"], string: ["id", "name", "file"] };

/** The flags `profile harvest` takes. */
const HARVEST_FLAGS: FlagSpec = { boolean: ["apply", "json"], string: ["manifest"] };

/** Every flag one spec advertises, as a caller reads them in a usage line. */
function flagNames({ spec }: { spec: FlagSpec }): readonly string[] {
  const { boolean: booleanFlags = [], string: stringFlags = [] } = spec;
  return [...stringFlags, ...booleanFlags].map((name) => `--${name}`).toSorted();
}

/** The flags `profile show`, `profile voice` and `profile context` advertise. */
export const PROFILE_SHOW_FLAG_NAMES: readonly string[] = flagNames({ spec: SHOW_FLAGS });

/** The flags `profile set` advertises. */
export const PROFILE_WRITE_FLAG_NAMES: readonly string[] = flagNames({ spec: WRITE_FLAGS });

/** The flags `profile person` advertises. */
export const PROFILE_PERSON_FLAG_NAMES: readonly string[] = flagNames({ spec: PERSON_FLAGS });

/** The flags `profile harvest` advertises. */
export const PROFILE_HARVEST_FLAG_NAMES: readonly string[] = flagNames({ spec: HARVEST_FLAGS });

/** The verb tokens `profile` answers to, so a flag tail is cut after the right word. */
const VERB_TOKENS = new Set([
  "show",
  "set",
  "person",
  "voice",
  "context",
  "hook",
  "harvest",
  "words",
  "steers",
  "standing",
  "guidance",
]);

/**
 * The flag tail for a `profile` invocation, with the verb token dropped when one was spoken.
 *
 * @param argv the full process argv
 * @returns everything after `slopweaver profile [<verb>]`
 */
export function profileTail({ argv }: { argv: readonly string[] }): readonly string[] {
  const spoken = argv[3];
  return argv.slice(spoken !== undefined && VERB_TOKENS.has(spoken) ? 4 : 3);
}

/** A parsed `profile show` / `profile voice` read. */
export interface ProfileShowArgs {
  readonly json: boolean;
}

/**
 * Parse a read-only invocation that takes nothing but `--json`.
 *
 * @param rest the flag tail
 * @returns the output mode, or every reason it was refused
 */
export function parseProfileShowArgs({ rest }: { rest: readonly string[] }): Result<ProfileShowArgs> {
  const parsed = parseFlags({ args: rest, spec: SHOW_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  return ok({ json: parsed.value.values["json"] === true });
}

/** A parsed `profile set` or `profile voice --file` write. */
export interface ProfileWriteArgs {
  readonly file: string;
  readonly json: boolean;
}

/**
 * Parse a write invocation, which always names a file rather than taking the payload inline.
 *
 * A file rather than a `--json '<blob>'` flag on purpose: a self-description or a judgement payload is
 * prose a human edits, and a shell-quoted blob is how a payload acquires a mangled apostrophe nobody
 * notices until it is on a card.
 *
 * @param rest the flag tail
 * @param flag which flag names the file, since `harvest` calls it `--manifest`
 * @returns the path and output mode, or every reason it was refused
 */
export function parseProfileWriteArgs({
  rest,
  flag = "file",
}: {
  rest: readonly string[];
  flag?: string;
}): Result<ProfileWriteArgs> {
  const parsed = parseFlags({ args: rest, spec: { boolean: ["json"], string: [flag] } });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const file = parsed.value.values[flag];
  if (typeof file !== "string" || file.length === 0) {
    return err([`--${flag} <path> is required`]);
  }
  return ok({ file, json: parsed.value.values["json"] === true });
}

/** A parsed `profile person` invocation: who, and whether this is a write. */
export interface ProfilePersonArgs {
  /** The person's `person.id`, when the caller gave one. */
  readonly id: string | undefined;
  /** The display name to resolve, when the caller gave one instead. */
  readonly name: string | undefined;
  /** The payload file, when this is a write. */
  readonly file: string | undefined;
  readonly json: boolean;
}

/**
 * Parse a `profile person` invocation, refusing one that names nobody or names two people.
 *
 * `--id` and `--name` both refused together rather than one silently winning: the register holds people
 * whose display names collide, so a caller that passed both has two different beliefs about who they mean
 * and only one of them can be right.
 *
 * @param rest the flag tail
 * @returns the subject and mode, or every reason it was refused
 */
export function parseProfilePersonArgs({ rest }: { rest: readonly string[] }): Result<ProfilePersonArgs> {
  const parsed = parseFlags({ args: rest, spec: PERSON_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const id = stringFlag({ raw: parsed.value.values["id"] });
  const name = stringFlag({ raw: parsed.value.values["name"] });
  if (id === undefined && name === undefined) {
    return err(["name the person with --id <uuid> or --name <display name>"]);
  }
  if (id !== undefined && name !== undefined) {
    return err(["--id and --name name two different beliefs about who is meant; pass one"]);
  }
  return ok({
    file: stringFlag({ raw: parsed.value.values["file"] }),
    id,
    json: parsed.value.values["json"] === true,
    name,
  });
}

/** A flag's value when it was given as a string, `undefined` when it was absent or bare. */
function stringFlag({ raw }: { raw: string | boolean | undefined }): string | undefined {
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** A parsed `profile harvest` invocation. */
export interface ProfileHarvestArgs {
  readonly manifest: string;
  readonly apply: boolean;
  readonly json: boolean;
}

/**
 * Parse a harvest invocation, which is DRY unless `--apply` is typed.
 *
 * Dry by default rather than guarded by a confirmation: the whole value of the manifest is that a human
 * reads the plan before anything lands, and a verb whose default writes is a verb somebody runs once by
 * accident.
 *
 * @param rest the flag tail
 * @returns the manifest path and mode, or every reason it was refused
 */
export function parseProfileHarvestArgs({ rest }: { rest: readonly string[] }): Result<ProfileHarvestArgs> {
  const parsed = parseFlags({ args: rest, spec: HARVEST_FLAGS });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const manifest = stringFlag({ raw: parsed.value.values["manifest"] });
  if (manifest === undefined) {
    return err(["--manifest <path.json> is required"]);
  }
  return ok({
    apply: parsed.value.values["apply"] === true,
    json: parsed.value.values["json"] === true,
    manifest,
  });
}

/**
 * The owner row as lines, leading with what is always loaded.
 *
 * @param owner the validated owner row
 * @returns the report
 */
export function ownerLines({ owner }: { owner: OwnerProfile }): readonly string[] {
  const description = owner.selfDescription;
  let person = "not yet placed by identity resolution";
  if (owner.personId !== null) {
    person = owner.personId;
  }
  return [
    `owner: ${owner.displayName} (revision ${String(owner.revision)}, updated ${owner.updatedAt.toISOString()})`,
    `person: ${person}`,
    `always loaded (${String(description.alwaysLoaded.length)}):`,
    ...description.alwaysLoaded.map((entry) => `  - ${entry.text} [${entry.source}]`),
    `ways of working (${String(description.waysOfWorking.length)}):`,
    ...description.waysOfWorking.map((entry) => `  - ${entry.text} [${entry.source}]`),
    `other facts: ${String(description.facts.length)}, read with --json`,
  ];
}

/**
 * One person's judgement as lines, saying plainly when nothing is curated.
 *
 * @param judgement what the column holds, or `null` when it is uncurated
 * @returns the report
 */
export function personLines({
  displayName,
  judgement,
}: {
  displayName: string;
  judgement: PersonJudgement | null;
}): readonly string[] {
  if (judgement === null) {
    return [`${displayName}: nothing curated — the judgement column is null, which is not the same as no preferences`];
  }
  return [
    `${displayName} (revision ${String(judgement.revision)}, curated ${judgement.curatedAt.slice(0, 10)})`,
    ...judgementLines({ judgement }).map((line) => `  ${line}`),
  ];
}

/**
 * The measured register as lines, one per cohort.
 *
 * @param cohorts every cohort the register holds
 * @returns the report
 */
export function voiceLines({ cohorts }: { cohorts: readonly VoiceCohort[] }): readonly string[] {
  if (cohorts.length === 0) {
    return [
      "no length cohort has been measured — a Slack refresh measures their sent messages " +
        "(`slopweaver profile voice measure` by hand)",
    ];
  }
  return [
    `${String(cohorts.length)} measured cohort(s):`,
    ...cohorts.flatMap((cohort) => {
      const line = `  ${voiceCohortLine({ cohort })}`;
      return cohort.qualification.length > 0 ? [line, `    does not cover: ${cohort.qualification}`] : [line];
    }),
  ];
}
