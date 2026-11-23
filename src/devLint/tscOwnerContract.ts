/**
 * The version-aware half of `tsc-heap-contract`: which shape a compiler script must take is decided by the
 * TypeScript version the tree pins, never by the script.
 *
 * **Two policies, one compiler at a time.** Under TypeScript 6 the compiler is a Node program, so a script
 * bounds it with ONE V8 flag on a direct `node` command (`./tscHeapContract.ts` judges that). Under TypeScript
 * 7 the compiler is a native binary that ignores TERM and INT and spends memory
 * no V8 flag reaches, so a script must run it under `scripts/tsc-owner.sh`, which owns its process group,
 * samples that group's resident memory and stops it at a named timeout or ceiling. Which policy applies is
 * {@link COMPILER_POLICIES} read at {@link TYPESCRIPT_PIN}; a pin naming neither is not judged at all. Reading
 * two policies in pure code is not a dual toolchain: the working tree installs only the pinned version.
 *
 * **Which manifests are subjects.** The V8 policy judges the root `package.json` alone, the one manifest whose
 * compiler it ever bounded. The owner policy judges every manifest that pins TypeScript
 * ({@link TYPESCRIPT_PIN_MANIFESTS}), desktop's `build` included. The site's `next build` starts the compiler
 * indirectly and names it nowhere, so no lexical reading selects it, and this gate does not claim to bound it.
 *
 * **Residue, stated.** This reads script TEXT. It proves a script names the owner with readable bounds, not
 * that the bounds are sufficient (the compile running green proves that) nor that the owner reaps (its
 * subprocess witnesses in `src/__tests__/subprocess/worktree/tscOwner.test.ts` prove that).
 */
import { posix } from "node:path";

import { err, ok, type Result } from "#lib/result.js";
import {
  assessTscHeapContract,
  mentionsCompiler,
  namesCompiler,
  readSimpleCommand,
  type TscHeapAssessment,
} from "./tscHeapContract.js";
import { TYPESCRIPT_PIN_MANIFESTS } from "./typescriptPin.js";

/** How a compiler script must bound the compiler: a V8 flag, or the native process owner. */
export type CompilerPolicy = "v8-heap" | "native-owner";

/** The policy each TypeScript version this repository has pinned is judged by. */
export const COMPILER_POLICIES: ReadonlyMap<string, CompilerPolicy> = new Map([
  ["6.0.3", "v8-heap"],
  ["7.1.0-beta", "native-owner"],
]);

/** The process owner, repo-relative. */
const OWNER_SCRIPT = "scripts/tsc-owner.sh";

/**
 * The largest grace the owner accepts. It refuses more itself, so a supervisor's fixed grace above it
 * (`SUPERVISOR_GRACE_SECONDS`, `src/worktree/shell.ts`) still outlasts the owner's reap.
 */
const OWNER_MAX_GRACE_SECONDS = 5;

/**
 * The longest value the owner accepts for any option. Bash's comparison of a number past its integer range
 * errors instead of firing, so a longer timeout or ceiling would be inert; the owner refuses one itself.
 */
const OWNER_MAX_VALUE_DIGITS = 9;

/**
 * The bounds the owner takes, each at most once. The first three are required; `--lock-timeout-seconds`, how long
 * the owner waits for the machine's compile lease, is optional because the owner defaults it (1200).
 */
const OWNER_OPTIONS = ["--timeout-seconds", "--grace-seconds", "--rss-ceiling-mib", "--lock-timeout-seconds"] as const;

/** The owner options a script must give. */
const REQUIRED_OWNER_OPTIONS = ["--timeout-seconds", "--grace-seconds", "--rss-ceiling-mib"] as const;

/** One owner option's name. */
type OwnerOption = (typeof OWNER_OPTIONS)[number];

/** What a compiler script running under the owner declares. */
export interface CompilerOwnerInvocation {
  /** The argv after `--`, compiler first. */
  readonly command: readonly string[];
  readonly graceSeconds: number;
  /** The compile-lease wait it gives, or `undefined` when it takes the owner's default. */
  readonly lockTimeoutSeconds: number | undefined;
  readonly rssCeilingMiB: number;
  readonly timeoutSeconds: number;
}

/** A command that is not one simple command, so no reader can say what it runs. */
export interface UnreadableCommandError {
  readonly code: "UNREADABLE_COMMAND";
  readonly message: string;
}

/** A command that does not run through the owner at the path its manifest reaches it by. */
export interface WrongOwnerError {
  readonly code: "WRONG_OWNER";
  readonly message: string;
}

/** An owner option that is missing, repeated, unknown or not a value the owner accepts. */
export interface InvalidOwnerOptionError {
  readonly code: "INVALID_OWNER_OPTION";
  readonly message: string;
  readonly option: string;
}

/** An owner whose command, after `--`, does not start with the compiler. */
export interface MissingCompilerError {
  readonly code: "MISSING_COMPILER";
  readonly message: string;
}

/** A V8 heap ceiling, which bounds nothing a native compiler spends. */
export interface WrongMemoryContractError {
  readonly code: "WRONG_MEMORY_CONTRACT";
  readonly message: string;
}

/** Why a compiler script does not meet the owner contract. */
export type TscOwnerContractError =
  InvalidOwnerOptionError | MissingCompilerError | UnreadableCommandError | WrongMemoryContractError | WrongOwnerError;

/** Builds each {@link TscOwnerContractError}, its message written to follow "runs the TypeScript compiler and". */
export const TscOwnerContractErrors = {
  invalidOwnerOption: ({ option, why }: { option: string; why: string }): InvalidOwnerOptionError => ({
    code: "INVALID_OWNER_OPTION",
    message: `its owner option \`${option}\` ${why}`,
    option,
  }),
  missingCompiler: (): MissingCompilerError => ({
    code: "MISSING_COMPILER",
    message: "the command after the owner's `--` does not start with the compiler, so the owner bounds something else",
  }),
  unreadableCommand: ({ why }: { why: string }): UnreadableCommandError => ({
    code: "UNREADABLE_COMMAND",
    message: why,
  }),
  wrongMemoryContract: ({ why }: { why: string }): WrongMemoryContractError => ({
    code: "WRONG_MEMORY_CONTRACT",
    message: why,
  }),
  wrongOwner: ({ expected }: { expected: string }): WrongOwnerError => ({
    code: "WRONG_OWNER",
    message: `it does not run as \`bash ${expected} …\`, the one owner that can stop a native compiler's process group`,
  }),
} as const;

/**
 * Whether a text names the V8 heap flag in either spelling V8 accepts, read with the shell's quotes,
 * backslashes AND whitespace removed — `--max-old-"space-size"=1` is the flag to a shell, and so is one split
 * by a backslash-newline the shell rejoins. Removing every whitespace character over-matches a
 * text no shell would read as the flag, which only ever refuses: every reader fails closed on a mention.
 *
 * @param text a command, or one string literal
 * @returns true when it carries `--max-old-space-size` or `--max_old_space_size`
 */
export function mentionsHeapFlag({ text }: { text: string }): boolean {
  return text
    .replaceAll(/["'\\\s]/gu, "")
    .replaceAll("_", "-")
    .includes("max-old-space-size");
}

/**
 * Whether a command means to run under the owner at all, by naming its script anywhere — so a misspelt or
 * mispathed owner is judged and refused rather than read as some other command.
 *
 * It reads the text with every quote and backslash removed, since the shell splices `tsc-"owner.sh"` into the
 * very name a plain substring test misses, compound command or not (Codex 8b r1, r2). Removing them can only
 * select MORE scripts, each then judged and refused unless it is one owner run, so the error fails closed.
 * It also selects on the `--rss-ceiling-mib` option itself: the owner refuses an argument it does not know, so
 * an RSS ceiling that takes effect carries that literal text, whereas a globbed path (`tsc-owne?.sh`) would
 * evade the name alone (Codex 8b r1). Residue, stated: a word built by expansion (`$'\x2d'`, a variable) is
 * invisible to any lexical reading.
 *
 * @param command the script's command text
 * @returns true when it names `tsc-owner.sh` or the owner's RSS option
 */
export function mentionsOwner({ command }: { command: string }): boolean {
  // A backslash-newline is a line continuation the shell deletes outright, so it goes first (Codex 8b r2).
  const unquoted = command.replaceAll("\\\n", "").replaceAll(/["'\\]/gu, "");
  return unquoted.includes(posix.basename(OWNER_SCRIPT)) || unquoted.includes("--rss-ceiling-mib");
}

/**
 * The path a manifest's script reaches the owner by: scripts run from the manifest's own directory.
 *
 * @param manifest the manifest, repo-relative
 * @returns `scripts/tsc-owner.sh` from the root, `../scripts/tsc-owner.sh` from `desktop/package.json`
 */
export function ownerPathFor({ manifest }: { manifest: string }): string {
  return posix.relative(posix.dirname(manifest), OWNER_SCRIPT);
}

/**
 * Read the owner options between the owner's path and `--`, exactly as the owner itself parses them.
 *
 * @param tokens the words after `bash <owner>`
 * @returns each option's value and the index of `--`, or the first option the owner would refuse
 */
function readOwnerOptions({
  tokens,
}: {
  tokens: readonly string[];
}): Result<{ readonly values: ReadonlyMap<OwnerOption, number>; readonly end: number }, InvalidOwnerOptionError> {
  const values = new Map<OwnerOption, number>();
  let index = 0;
  while (tokens[index] !== "--") {
    const name = tokens[index];
    if (name === undefined) {
      return err(TscOwnerContractErrors.invalidOwnerOption({ option: "--", why: "is missing, so no command follows" }));
    }
    const option = OWNER_OPTIONS.find((candidate) => candidate === name);
    if (option === undefined) {
      return err(TscOwnerContractErrors.invalidOwnerOption({ option: name, why: "is not one the owner takes" }));
    }
    if (values.has(option)) {
      return err(TscOwnerContractErrors.invalidOwnerOption({ option, why: "is given twice" }));
    }
    const raw = tokens[index + 1];
    if (raw === undefined || !/^[1-9]\d*$/u.test(raw)) {
      return err(TscOwnerContractErrors.invalidOwnerOption({ option, why: "is not a positive whole number" }));
    }
    if (raw.length > OWNER_MAX_VALUE_DIGITS) {
      // Past Bash's integer range the owner's comparison errors rather than firing, so the bound would be inert.
      return err(
        TscOwnerContractErrors.invalidOwnerOption({
          option,
          why: "is at most nine digits, which the owner itself enforces",
        }),
      );
    }
    values.set(option, Number(raw));
    index += 2;
  }
  return ok({ end: index, values });
}

/**
 * Read a compiler script that runs under the native process owner.
 *
 * @param command the script's command text exactly as the manifest holds it
 * @param manifest the manifest it sits in, repo-relative, which fixes the path the owner must be reached by
 * @returns the bounds and the compiler argv it declares, or the first thing the owner contract refuses
 */
export function readCompilerOwner({
  command,
  manifest,
}: {
  command: string;
  manifest: string;
}): Result<CompilerOwnerInvocation, TscOwnerContractError> {
  if (command.includes("NODE_OPTIONS") || mentionsHeapFlag({ text: command })) {
    return err(
      TscOwnerContractErrors.wrongMemoryContract({
        why: "it carries a V8 heap ceiling, which bounds nothing a native compiler spends — the owner's `--rss-ceiling-mib` is its bound",
      }),
    );
  }
  const reading = readSimpleCommand({ command });
  if (reading.kind === "unreadable") {
    return err(TscOwnerContractErrors.unreadableCommand({ why: reading.why }));
  }
  const expected = ownerPathFor({ manifest });
  const [shell, owner, ...rest] = reading.tokens;
  if (shell !== "bash" || owner !== expected) {
    return err(TscOwnerContractErrors.wrongOwner({ expected }));
  }
  return readOwnerOptions({ tokens: rest }).andThen(({ end, values }) => {
    const missing = REQUIRED_OWNER_OPTIONS.find((option) => !values.has(option));
    if (missing !== undefined) {
      return err(TscOwnerContractErrors.invalidOwnerOption({ option: missing, why: "is missing" }));
    }
    const graceSeconds = values.get("--grace-seconds")!;
    if (graceSeconds > OWNER_MAX_GRACE_SECONDS) {
      const why = `is at most ${String(OWNER_MAX_GRACE_SECONDS)}, which the owner itself enforces`;
      return err(TscOwnerContractErrors.invalidOwnerOption({ option: "--grace-seconds", why }));
    }
    const compiler = rest.slice(end + 1);
    const [first] = compiler;
    if (first === undefined || !namesCompiler({ token: first })) {
      return err(TscOwnerContractErrors.missingCompiler());
    }
    return ok({
      command: compiler,
      graceSeconds,
      lockTimeoutSeconds: values.get("--lock-timeout-seconds"),
      rssCeilingMiB: values.get("--rss-ceiling-mib")!,
      timeoutSeconds: values.get("--timeout-seconds")!,
    });
  });
}

/** One manifest's scripts map, named by its repo-relative path. */
export interface ManifestScripts {
  readonly path: string;
  readonly scripts: Readonly<Record<string, string>>;
}

/**
 * The manifests a policy judges.
 *
 * @param policy the policy the pinned version selects
 * @returns the root manifest under the V8 policy, every TypeScript-pinning manifest under the owner policy
 */
export function policyManifests({ policy }: { policy: CompilerPolicy }): readonly string[] {
  return policy === "v8-heap" ? ["package.json"] : TYPESCRIPT_PIN_MANIFESTS;
}

/**
 * How a finding names its script: bare in the root manifest, as the gate always has, and path-qualified
 * anywhere else.
 *
 * @param manifest the manifest, repo-relative
 * @param script the script key
 * @returns the label
 */
function scriptLabel({ manifest, script }: { manifest: string; script: string }): string {
  return manifest === "package.json" ? script : `${manifest}#${script}`;
}

/**
 * Judge every manifest a policy covers.
 *
 * @param manifests each manifest's scripts, every one {@link policyManifests} names
 * @param policy the policy the pinned version selects
 * @returns which scripts were subjects, and one finding per refusal, in manifest then script order
 */
export function assessCompilerContract({
  manifests,
  policy,
}: {
  manifests: readonly ManifestScripts[];
  policy: CompilerPolicy;
}): TscHeapAssessment {
  const parts = manifests.map(({ path, scripts }): TscHeapAssessment => {
    if (policy === "v8-heap") {
      const assessed = assessTscHeapContract({ scripts });
      const relabel = (script: string): string => scriptLabel({ manifest: path, script });
      return {
        compilerScripts: assessed.compilerScripts.map(relabel),
        findings: assessed.findings.map((finding) => ({ ...finding, script: relabel(finding.script) })),
      };
    }
    const subjects = Object.entries(scripts).filter(
      ([, command]) => mentionsCompiler({ command }) || mentionsOwner({ command }),
    );
    return {
      compilerScripts: subjects.map(([script]) => scriptLabel({ manifest: path, script })),
      findings: subjects.flatMap(([script, command]) => {
        const read = readCompilerOwner({ command, manifest: path });
        if (read.isOk()) {
          return [];
        }
        const label = scriptLabel({ manifest: path, script });
        return [
          { line: `\`${label}\` runs the TypeScript compiler and ${read.error.message}: ${command}`, script: label },
        ];
      }),
    };
  });
  return {
    compilerScripts: parts.flatMap((part) => part.compilerScripts),
    findings: parts.flatMap((part) => part.findings),
  };
}
