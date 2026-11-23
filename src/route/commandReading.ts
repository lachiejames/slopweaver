/**
 * A capability row that names a command nothing can run is refused, instead of being printed as the way to
 * reach a source.
 *
 * ## The failure this closes
 *
 * MEASURED on the live install: `capability-profile.json`'s `telemetry` row declared
 * `availability: available` and `command: ["yarn", "work-console", "datadog", "reach", "--about",
 * "{question}", "--json"]`, and its own `freshness.detail` advertised a `--drill` flag as "a separate live
 * metered act". There is no `work-console` script in this repository's `package.json`, no `work-console`
 * executable anywhere on the host, and `slopweaver datadog` has never carried a `reach` verb or a `--drill`
 * flag. Nothing noticed, because a row's `availability` was a field the row asserted about itself.
 *
 * `turn brief` prints the winning row's argv into the brief as the way to reach that source, so the argv was
 * not decoration — two of the owner's own asks were dispatched that day telling a worker to spend a `--drill`
 * that does not exist. Both workers corrected it themselves and reached Datadog through the `slopweaver`
 * verbs, which is the only reason it cost a turn rather than an answer. Reproduce the class on any install:
 *
 * ```bash
 * slopweaver turn brief --contracts --text "datadog log retention" | grep -B4 'yarn work-console'
 * ```
 *
 * ## Why the grading is three-way, and why that is the design rather than caution
 *
 * A refusal is only safe where the namespace it searched was COMPLETE. Two of the shapes are: the three
 * places Yarn itself looks are the whole of what `yarn <token>` can run, and the filesystem is the whole of
 * what an ABSOLUTE path can be. `PATH` is NOT the whole of what a bare name resolves to in the host's own
 * shell, and that gap is measured rather than theoretical — on this very install `rg` is on none of the 25
 * `PATH` entries and there is no ripgrep binary anywhere, because Claude Code defines `rg` as a shell
 * FUNCTION. The profile's `claude-artifact-index` row runs `rg …` and works every time a session runs it.
 * Refusing it would have deleted a working history leg to close a hole it was not in. A RELATIVE path is the
 * same shape of doubt for a different reason: it resolves against the cwd of whoever runs the row.
 *
 * So `missing` refuses the row and `unprovable` keeps it and says so out loud in its own coverage. The
 * measured failure class lands in `missing` — `yarn work-console` names no script, no `node_modules/.bin`
 * entry and no Yarn command, and those three together are the complete answer to that question.
 *
 * ## A row is graded on EVERY key it depends on, including inside a `bash -c` string
 *
 * A row whose command is `["bash", "-c", "…"]` used to grade on `bash` alone, and the same install carried
 * one of those — `github-vulnerability-evidence` — wrapping two `yarn work-console` calls this grading could
 * not see. It planned as `available` for live vulnerability questions while being unable to run a line of
 * itself, which is the identical failure the `telemetry` row above produced, one indirection further down.
 *
 * So a shell head's `-c` argument is read for `yarn <token>` pairs, and each one is graded by the exact rule
 * already written for that shape. This needs no shell parser and buys no new namespace: `yarn <token>` is
 * one of the two shapes above whose namespace is already COMPLETE, so a hit inside the string can be refused
 * on the same evidence a hit at the head is refused on, and everything else in the string stays ungraded.
 * One row therefore yields SEVERAL keys, and the worst verdict among them decides the row.
 *
 * ## What is still outside it, stated rather than discovered
 *
 * Four things, and each is a shape whose namespace this module cannot complete rather than an oversight:
 *
 * - **A `-c` script that changes directory or carries a heredoc.** Both unsettle what the `yarn` hits in it
 *   even mean — the first moves the tree they resolve against, the second makes them data rather than
 *   commands — so such a script yields no keys at all and its row grades on the head alone, exactly as it
 *   did before this grading existed. {@link SCRIPT_UNREADABLE} carries why a false refusal is worse here
 *   than the silence it replaced.
 * - **Anything in the shell string that is not `yarn <token>` in command position.** The retired row also
 *   piped through `python3`; a bare name is `unprovable` even at the head, so reading it here would add doubt
 *   rather than evidence. (That particular one is refused by a different gate — the admit check inside `scripts/pretooluse.sh`, under the
 *   no-Python rule.) A `yarn` call this module's own separator class does not recognise —
 *   `VAR=1 yarn build` — is missed the same way, deliberately: {@link YARN_IN_SHELL_SCRIPT} carries why a
 *   false NEGATIVE is the side to err on here.
 * - **A `yarn` token carrying a shell expansion** — `yarn "$SCRIPT"` names something only the run knows, so
 *   it is skipped rather than graded on its literal text.
 * - **A verb or flag the resolvable executable does not accept.** An argv headed by `slopweaver` grades on
 *   the launcher alone, so the nonexistent verb and flag in the `telemetry` row would have been invisible
 *   here had that row named the launcher rather than a script nothing declares.
 */
import type { SourceCapability } from "./profile.js";

/** The argv head whose SECOND element names the thing that has to exist, rather than the head itself. */
export const YARN_EXECUTABLE = "yarn";

/**
 * The argv heads whose `-c` argument is a SCRIPT rather than an argument, and so is read for `yarn` pairs.
 *
 * Deliberately the three POSIX-shell heads a capability row realistically carries, not every interpreter
 * that happens to accept `-c`: a head absent from this set grades as itself and its arguments stay unread,
 * which is the pre-existing behaviour rather than a new silence.
 */
const SHELL_EXECUTABLES: ReadonlySet<string> = new Set(["bash", "sh", "zsh"]);

/**
 * `yarn <token>` in COMMAND POSITION inside a shell script.
 *
 * The leading class is a separator that really does start a command — the beginning of the script, `;`, a
 * newline, `&`, `|`, `(`, `{` or a backtick — and NOT a bare space, which is the whole point. A space would
 * match `echo "regenerate with yarn build"` and refuse a row on a word inside a message, and a refusal
 * manufactured out of prose is worse than the blind spot it closes: `unprovable` exists in this module
 * precisely because it will not refuse on evidence that does not settle the question. It deliberately admits
 * `(` so the measured shape — `EVJSON=$(yarn work-console …)` — is read.
 *
 * The cost is stated rather than discovered: a real command this misses is simply ungraded, exactly like
 * everything else in the string that is not `yarn <token>`. `VAR=1 yarn build` and `if …; then yarn build`
 * are the shapes that lands on. The token stops at the first shell metacharacter, so
 * `yarn work-console github …)` yields `work-console` rather than swallowing the rest of the line.
 */
const YARN_IN_SHELL_SCRIPT = /(?:^|[;&|(\n{`])[ \t]*yarn[ \t]+([^\s;&|(){}<>'"`]+)/g;

/**
 * Two shapes that make a whole `-c` script's `yarn` hits unreadable, so NONE of them is graded.
 *
 * A **directory change** in command position moves the tree the `yarn` after it resolves against, while
 * `./commandReadings.ts` only ever resolves a `yarn <script>` pair against the ONE tree it was handed. The
 * completeness premise a `missing` verdict rests on — the namespace searched is the whole answer to the
 * question — is then false, and so is the refusal it licenses: `bash -c "cd ../acme-admin && yarn evidence"`
 * runs perfectly and would be rewritten `unavailable` with its command cleared. A **heredoc** introduces a
 * BODY rather than commands, so a line reading `yarn work-console foo` inside one is data being passed to
 * another program, and refusing a row on it is the prose refusal {@link YARN_IN_SHELL_SCRIPT}'s separator
 * class exists to prevent, arriving one line down instead of one space along.
 *
 * Both fall back to the head alone — the silence that stood before this grading existed — because a false
 * NEGATIVE is the side this module errs on, and a row refused for a reason that is not true is the inverse
 * of the failure the grading was opened for rather than a smaller version of it.
 */
const SCRIPT_UNREADABLE = /(?:^|[;&|(\n{`])[ \t]*(?:cd|pushd|popd)\b|<</;

/** What the lookup established about one executable. */
type CommandResolution = "resolved" | "missing" | "unprovable";

/**
 * How bad each verdict is, so the worst key on a multi-key row decides that row.
 *
 * A `Record` keyed by the union rather than a `switch`: a fourth resolution fails to compile here, which is
 * the same exhaustiveness an assign-to-`never` default buys, without a branch that cannot be tested.
 */
const RESOLUTION_SEVERITY: Readonly<Record<CommandResolution, number>> = {
  missing: 2,
  resolved: 0,
  unprovable: 1,
};

/** Whether the executable one capability row names can actually be run from this host. */
export interface CommandRouteReading {
  /** The executable key this grades — one of {@link commandExecutableKeysOf}'s outputs, not a raw argv element. */
  readonly executable: string;
  readonly resolution: CommandResolution;
  /** One sentence naming what was looked for and where, printed unchanged rather than paraphrased. */
  readonly because: string;
}

/** The script a shell head would run, when the command is a `-c` invocation of one. */
function shellScriptOf({ command }: { command: readonly string[] }): string | undefined {
  const flagIndex = command.indexOf("-c");
  if (flagIndex === -1) {
    return undefined;
  }
  return command[flagIndex + 1];
}

/**
 * Every `yarn <token>` key a shell script names, in the order it names them.
 *
 * A token carrying a shell expansion is skipped rather than graded on its literal text — `yarn "$SCRIPT"`
 * names something only the run knows, and grading it would manufacture a refusal out of a variable name.
 * A script matching {@link SCRIPT_UNREADABLE} yields NOTHING at all rather than its readable half: one `cd`
 * or one heredoc anywhere in it unsettles which tree the hits belong to, and half a reading is the wrong
 * half to keep when the verdict it feeds can refuse the row.
 *
 * @param script the `-c` argument, unparsed
 * @returns the keys to grade, possibly empty
 */
function yarnKeysInShellScript({ script }: { script: string }): readonly string[] {
  if (SCRIPT_UNREADABLE.test(script)) {
    return [];
  }
  const keys: string[] = [];
  for (const match of script.matchAll(YARN_IN_SHELL_SCRIPT)) {
    const token = match[1];
    if (token === undefined || token.includes("$")) {
      continue;
    }
    if (token.startsWith("-")) {
      keys.push(YARN_EXECUTABLE);
      continue;
    }
    keys.push(`${YARN_EXECUTABLE} ${token}`);
  }
  return keys;
}

/**
 * Every executable key a capability row depends on, taken from the command it would run.
 *
 * `yarn <script>` is keyed as a PAIR because `yarn` itself resolving proves nothing: every row on the live
 * install that could not run named `yarn` as its head and a script that does not exist as its second element.
 * A shell head contributes its own key PLUS one per `yarn <token>` its `-c` script names, so a row that can
 * only fail from inside that string is graded on what really has to exist.
 *
 * @param capability the row to inspect
 * @returns the keys to grade, deduplicated and empty when the row declares no command at all
 */
export function commandExecutableKeysOf({ capability }: { capability: SourceCapability }): readonly string[] {
  const head = capability.command[0];
  if (head === undefined) {
    return [];
  }
  if (head === YARN_EXECUTABLE) {
    const script = capability.command[1];
    if (script === undefined || script.startsWith("-")) {
      return [head];
    }
    return [`${YARN_EXECUTABLE} ${script}`];
  }
  if (!SHELL_EXECUTABLES.has(head)) {
    return [head];
  }
  const script = shellScriptOf({ command: capability.command });
  if (script === undefined) {
    return [head];
  }
  return [...new Set([head, ...yarnKeysInShellScript({ script })])];
}

/** The readings sharing the harshest verdict present, so a refusal names every key that earned it. */
function decidingReadings({ readings }: { readings: readonly CommandRouteReading[] }): readonly CommandRouteReading[] {
  const worst = readings.reduce(
    (severity, reading) => Math.max(severity, RESOLUTION_SEVERITY[reading.resolution]),
    RESOLUTION_SEVERITY.resolved,
  );
  return readings.filter((reading) => RESOLUTION_SEVERITY[reading.resolution] === worst);
}

/**
 * Rewrite one capability row from what the lookup established about the executables it names.
 *
 * A `missing` row is made `unavailable` and its command is CLEARED, because `sourceCapabilitySchema` refuses
 * an unavailable row that still carries a runnable command — and because the cleared argv is precisely what
 * stopped being printable into a worker's brief. An `unprovable` row keeps both, and carries the doubt in its
 * own coverage so a reader sees it rather than inferring it from silence. Where a row names several keys the
 * worst verdict decides it, and every key holding that verdict is named in the sentence: a `bash -c` row
 * chaining two dead scripts should say both, not the first one it happened to look at.
 *
 * @param capability the row as declared
 * @param readings the gradings for the executables it names; empty when nothing graded any of them
 * @returns the row to plan with
 * @internal
 */
export function deriveCommandCapability({
  capability,
  readings,
}: {
  capability: SourceCapability;
  readings: readonly CommandRouteReading[];
}): SourceCapability {
  if (readings.length === 0 || capability.availability.kind === "unavailable") {
    return capability;
  }
  const deciding = decidingReadings({ readings });
  const because = deciding.map((reading) => reading.because).join("; ");
  const [first] = deciding;
  if (first === undefined) {
    return capability;
  }
  switch (first.resolution) {
    case "resolved": {
      return capability;
    }
    case "unprovable": {
      return {
        ...capability,
        coverage: { ...capability.coverage, detail: `${capability.coverage.detail}; ${because}` },
      };
    }
    case "missing": {
      return {
        ...capability,
        availability: { kind: "unavailable", reason: `the command this row names cannot run here: ${because}` },
        command: [],
        coverage: { detail: because, kind: "unknown" },
      };
    }
    default: {
      const unhandled: never = first.resolution;
      throw new Error(`command grading has no rule for resolution ${String(unhandled)}`);
    }
  }
}

/**
 * Apply {@link deriveCommandCapability} to every row in a table that names a command.
 *
 * @param capabilities the merged capability table
 * @param readings one grading per executable key, keyed by {@link commandExecutableKeysOf}'s outputs
 * @returns the table with every unrunnable row refused and every unprovable one annotated
 */
export function deriveCommandCapabilities({
  capabilities,
  readings,
}: {
  capabilities: readonly SourceCapability[];
  readings: ReadonlyMap<string, CommandRouteReading>;
}): readonly SourceCapability[] {
  return capabilities.map((capability) => {
    const graded = commandExecutableKeysOf({ capability })
      .map((key) => readings.get(key))
      .filter((reading) => reading !== undefined);
    return deriveCommandCapability({ capability, readings: graded });
  });
}
