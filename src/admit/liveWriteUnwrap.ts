/**
 * The runners a migration or deploy usually hides behind — a package manager, a task runner, an env loader, a
 * container — peeled one layer at a time so the bot-turn live-write guard judges the program that actually
 * runs. `npx prisma migrate deploy`, `yarn workspace api db:migrate`, `dotenv -e .env.prod -- knex
 * migrate:latest` and `docker compose exec api rails db:migrate` are each one migration, spelled four ways.
 *
 * The OS-level wrappers (`env`, `sudo`, `nohup`, `timeout`, `uv run`, `poetry run`) are already peeled by
 * `./pythonWrappers.ts`'s `resolvePrograms`, which the walk calls first; this module is the layer above it.
 *
 * Pure: a program's name and argument words in, what it runs out.
 */
import { scriptRunsMigration } from "./liveWriteMigrations.js";

/** What a runner runs: a package script by name, another program, or a whole shell line. */
export type Unwrapped =
  | { readonly kind: "script"; readonly script: string }
  | { readonly kind: "program"; readonly words: readonly string[] }
  | { readonly kind: "line"; readonly line: string };

/** Skip leading options, consuming the next word after any listed in `values`, and return what remains. */
function afterOptions({ args, values }: { args: readonly string[]; values: readonly string[] }): readonly string[] {
  let index = 0;
  while (index < args.length && args[index]!.startsWith("-")) {
    if (args[index] === "--") return args.slice(index + 1);
    index += values.includes(args[index]!) ? 2 : 1;
  }
  return args.slice(index);
}

/** A runner that takes a script name or a program: `yarn migrate` is the script, `yarn prisma …` the program. */
function scriptOrProgram({ words }: { words: readonly string[] }): Unwrapped | undefined {
  const [first] = words;
  if (first === undefined) return undefined;
  return scriptRunsMigration({ script: first }) ? { kind: "script", script: first } : { kind: "program", words };
}

/** A script named after `run`, or undefined when no name follows it. */
function namedScript({ words }: { words: readonly string[] }): Unwrapped | undefined {
  const script = words.find((word) => !word.startsWith("-"));
  return script === undefined ? undefined : { kind: "script", script };
}

/** `yarn`/`pnpm`/`bun`: `run <script>`, `exec`/`dlx`/`x <program>`, `workspace <name> …`, or bare `<script|bin>`. */
function packageManager({ name, args }: { name: string; args: readonly string[] }): Unwrapped | undefined {
  const words = afterOptions({ args, values: ["--cwd", "--filter", "-F", "-C", "--dir"] });
  const [verb, ...rest] = words;
  if (verb === "run" || verb === "run-script") return namedScript({ words: rest });
  if (verb === "exec" || verb === "dlx" || verb === "x") {
    return { kind: "program", words: afterOptions({ args: rest, values: ["-p", "--package"] }) };
  }
  if (verb === "workspace") return unwrapRunner({ args: rest.slice(1), name });
  if (name === "npm") return undefined;
  return scriptOrProgram({ words });
}

/** `docker`/`podman` `exec|run [options] <target> <program…>` and their `compose` forms. */
function container({ args }: { args: readonly string[] }): Unwrapped | undefined {
  const values = [
    "-e",
    "--env",
    "-u",
    "--user",
    "-w",
    "--workdir",
    "--env-file",
    "--entrypoint",
    "-v",
    "--volume",
  ].concat(["--name", "-p", "--publish", "--network", "--platform", "-f", "--file", "--project-name"]);
  let words = afterOptions({ args, values });
  if (words[0] === "compose") words = afterOptions({ args: words.slice(1), values });
  const [verb, ...rest] = words;
  if (verb !== "exec" && verb !== "run") return undefined;
  const inner = afterOptions({ args: rest, values }).slice(1);
  return inner.length === 0 ? undefined : { kind: "program", words: inner };
}

/** `npx`/`bunx`/`pnpx` `[options] <program…>`, or the shell line `-c` carries. */
function executor({ args }: { args: readonly string[] }): Unwrapped | undefined {
  const call = args.findIndex((word) => word === "-c" || word === "--call");
  if (call !== -1 && call + 1 < args.length) return { kind: "line", line: args[call + 1]! };
  const words = afterOptions({ args, values: ["-p", "--package"] });
  return words.length === 0 ? undefined : { kind: "program", words };
}

/** `dotenv`, `env-cmd`, `cross-env`: load an environment, then run what follows. */
function envLoader({ name, args }: { name: string; args: readonly string[] }): Unwrapped | undefined {
  if (name === "cross-env") {
    const words = args.filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    return words.length === 0 ? undefined : { kind: "program", words };
  }
  const words = afterOptions({ args, values: ["-e", "-c", "-v", "-p", "-f", "--file", "--environments", "-r"] });
  return words.length === 0 ? undefined : { kind: "program", words };
}

/** Task runners whose targets are names: any target that reads as a migration is one. */
const TASK_RUNNERS = new Set(["make", "just", "task", "mise"]);

/** The runners that take a program word or two up front: `bundle exec`, `pipenv run`, or a task runner. */
function prefixedRunner({ name, args }: { name: string; args: readonly string[] }): Unwrapped | undefined {
  const execs = (name === "bundle" && args[0] === "exec") || (name === "pipenv" && args[0] === "run");
  if (execs) return args.length > 1 ? { kind: "program", words: args.slice(1) } : undefined;
  if (!TASK_RUNNERS.has(name)) return undefined;
  const target = args.find((word) => !word.startsWith("-") && scriptRunsMigration({ script: word }));
  return target === undefined ? undefined : { kind: "script", script: target };
}

/**
 * What one runner invocation runs, or `undefined` when the program is not a runner this module peels.
 *
 * @param name the program's own name (`programName`'s answer)
 * @param args the words after the program, redirections removed
 * @returns the script, program or shell line it runs
 */
export function unwrapRunner({ name, args }: { name: string; args: readonly string[] }): Unwrapped | undefined {
  if (["yarn", "pnpm", "bun", "npm"].includes(name)) return packageManager({ args, name });
  if (name === "docker" || name === "podman" || name === "docker-compose") {
    return container({ args: name === "docker-compose" ? ["compose", ...args] : args });
  }
  if (["npx", "bunx", "pnpx"].includes(name)) return executor({ args });
  if (["dotenv", "dotenv-cli", "env-cmd", "cross-env"].includes(name)) return envLoader({ args, name });
  return prefixedRunner({ args, name });
}
