/**
 * `supervisor hand-off`'s argv, parsed into what `./chairHandOffRun.ts` acts on: the hand-off itself with its
 * overrides, or one of the three bodies it routes to (`hold`, `release`, `note`). Pure: no seam is reached here.
 */
import { err, ok, type Result } from "../../../lib/result.js";
import { nonNegativeIntegerFlag, parseFlagTail, requiredFlagValue, resolveHome } from "../../optionParsers.js";

/** How long the control plane waits for the outgoing chair's note, unless `--note-wait` says otherwise. */
export const DEFAULT_NOTE_WAIT_SECONDS = 600;

/** The flags the hand-off itself takes. */
const RUN_FLAG_SPEC = { boolean: ["now"], value: ["home", "plan", "reason", "note-wait"] } as const;

/** The flags `hand-off note` takes. */
const NOTE_FLAG_SPEC = { value: ["episode", "file", "home"] } as const;

/**
 * Every flag `supervisor hand-off` advertises across its forms, from the two specs above; `hold|release` take
 * `--reason` and `--home`, already in the run's. The help-truth sweep holds the usage to this list.
 */
export const CHAIR_HAND_OFF_FLAG_NAMES: readonly string[] = [
  ...new Set([...RUN_FLAG_SPEC.boolean, ...RUN_FLAG_SPEC.value, ...NOTE_FLAG_SPEC.value]),
].map((name) => `--${name}`);

/** What `supervisor hand-off` was asked to do, parsed. */
export type ChairHandOffInvocation =
  | { readonly kind: "help" }
  | { readonly kind: "hold"; readonly rest: readonly string[] }
  | { readonly kind: "release"; readonly rest: readonly string[] }
  | { readonly kind: "note"; readonly home: string; readonly episodeId: string; readonly file: string }
  | { readonly kind: "run"; readonly options: ChairHandOffOptions };

/** The options one hand-off runs with. */
export interface ChairHandOffOptions {
  readonly home: string;
  /** The `--home` the run was given, passed on to the note command it asks the chair to run. */
  readonly namedHome: string | undefined;
  /** `--plan <alias>`: the successor's plan instead of the watch's. */
  readonly plan: string | undefined;
  /** `--now --reason`: hand off whatever the watch says, on an app chair. */
  readonly now: string | undefined;
  /** `--reason` given beside `--plan` alone: why the plan was overridden. */
  readonly reason: string | undefined;
  readonly noteWaitSeconds: number;
}

/** What `--note-wait` parsed to. */
type NoteWait = ReturnType<typeof nonNegativeIntegerFlag>;

/** Parse `hand-off note`'s flags. */
function parseNote({ rest }: { rest: readonly string[] }): Result<ChairHandOffInvocation> {
  const parsed = parseFlagTail({ rest, spec: NOTE_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const episodeId = requiredFlagValue({
    missing: "note needs --episode <id>, as the hand-off request names it",
    name: "episode",
    parsed: parsed.value,
  });
  if (episodeId.isErr()) {
    return err(episodeId.error);
  }
  const file = requiredFlagValue({
    missing: "note needs --file <path>, as the hand-off request names it",
    name: "file",
    parsed: parsed.value,
  });
  if (file.isErr()) {
    return err(file.error);
  }
  return ok({
    episodeId: episodeId.value,
    file: file.value,
    home: resolveHome({ named: parsed.value.values["home"] }),
    kind: "note",
  });
}

/** Every usage problem in the run flags: `--now` needs a reason, a stray reason needs an override, a bad wait. */
function runProblems({
  now,
  plan,
  reason,
  wait,
}: {
  now: boolean;
  plan: string | undefined;
  reason: string | undefined;
  wait: NoteWait;
}): readonly string[] {
  const problems: string[] = [];
  const blankReason = reason === undefined || reason.trim() === "";
  if (now && blankReason) {
    problems.push('--now needs --reason "<why>": an override carries its reason');
  }
  const strayReason = !now && plan === undefined && reason !== undefined;
  if (strayReason) {
    problems.push("--reason goes with --now or --plan, the two overrides it explains");
  }
  if ("error" in wait) {
    problems.push(wait.error);
  }
  return problems;
}

/** The note wait in seconds: `--note-wait`'s value, else the default. */
function noteWaitOf({ wait }: { wait: NoteWait }): number {
  if ("value" in wait && wait.value !== undefined) {
    return wait.value;
  }
  return DEFAULT_NOTE_WAIT_SECONDS;
}

/** Parse the hand-off's own flags into its options. */
function parseRun({ rest }: { rest: readonly string[] }): Result<ChairHandOffInvocation> {
  const parsed = parseFlagTail({ rest, spec: RUN_FLAG_SPEC });
  if (parsed.isErr()) {
    return err(parsed.error);
  }
  const { flags, values } = parsed.value;
  const now = flags.has("now");
  const reason = values["reason"];
  const plan = values["plan"];
  const wait = nonNegativeIntegerFlag({ name: "note-wait", values });
  const problems = runProblems({ now, plan, reason, wait });
  if (problems.length > 0) {
    return err(problems);
  }
  const named = values["home"];
  return ok({
    kind: "run",
    options: {
      home: resolveHome({ named }),
      namedHome: named,
      noteWaitSeconds: noteWaitOf({ wait }),
      now: now ? reason : undefined,
      plan,
      reason: now ? undefined : reason,
    },
  });
}

/**
 * Parse `supervisor hand-off`'s tail into what it was asked to do.
 *
 * @param rest argv after `supervisor hand-off`
 * @returns the invocation, or every usage problem
 */
export function parseChairHandOffArgs({ rest }: { rest: readonly string[] }): Result<ChairHandOffInvocation> {
  if (rest.includes("--help") || rest.includes("-h")) {
    return ok({ kind: "help" });
  }
  const [first, ...after] = rest;
  if (first === "hold" || first === "release") {
    return ok({ kind: first, rest: after });
  }
  if (first === "note") {
    return parseNote({ rest: after });
  }
  return parseRun({ rest });
}
