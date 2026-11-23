/**
 * `slopweaver atlas <platform> <verb>` — the platform is the third word, and this is where it is read.
 *
 * The noun is `atlas`, the platform names which one, and the verb says what to do with it. That ordering is
 * the owner's, and it is why nothing here takes a `--platform` flag: a platform is not an option a reader
 * supplies to a generic verb, it is the thing being addressed. `atlas slack`, `atlas slack-api` and
 * `atlas slack-drive` already read this way, so a second spelling would have been the odd one out.
 *
 * What a platform answers is read from its REGISTRATION (`src/atlas/registry.ts`): the kit verbs, which
 * are the four every platform has plus `reset` for every platform that declares a `readReset`, and the rows
 * the platform declares as its own. This file decides which of
 * those an argv names and is pure, so the dispatch is testable without argv or a process — the shell in
 * `platformRun.ts` reads argv, this decides, and the shell runs what was decided.
 */
import { type AtlasOwnVerb, atlasKitVerbsFor, atlasPlatformUsage as usageFor } from "../../../atlas/kit/verbs.js";
import type { AtlasPlatformRegistration } from "../../../atlas/registry.js";

/** The argv index a platform's own verb sits at — past the runtime, the script, `atlas` and the platform. */
const PLATFORM_VERB_INDEX = 4;

/** What one `atlas <platform> …` invocation asked for, decided purely from argv and the registration. */
export type AtlasPlatformDispatch =
  | { readonly kind: "kit"; readonly verb: string }
  | { readonly kind: "own"; readonly verb: AtlasOwnVerb }
  | { readonly kind: "fallback" }
  | { readonly kind: "help" }
  | { readonly kind: "needs-verb" }
  | { readonly kind: "unknown-verb"; readonly given: string };

/**
 * The usage block one platform prints when its verb is missing or unknown.
 *
 * @param registration the platform's row
 * @returns the usage block, ending without a trailing newline
 */
export function atlasPlatformUsage({ registration }: { registration: AtlasPlatformRegistration }): string {
  const { kitDescriptions } = registration.catalogue;
  return usageFor({
    hasReset: registration.readReset !== undefined,
    ownVerbs: registration.verbs,
    platform: registration.platform,
    ...(kitDescriptions === undefined ? {} : { kitDescriptions }),
  });
}

/**
 * Whether this invocation asked for help rather than a verb.
 *
 * @param argv the whole process argv
 * @returns true when `--help`/`-h` appears in the platform's own tail
 */
export function atlasPlatformWantsHelp({ argv }: { argv: readonly string[] }): boolean {
  const tail = new Set(argv.slice(PLATFORM_VERB_INDEX));
  return tail.has("--help") || tail.has("-h");
}

/**
 * Decide which verb an `atlas <platform> …` invocation names, against what the platform answers.
 *
 * A kit verb wins over an own verb of the same name because the kit verbs are the contract every platform
 * keeps; a registration cannot shadow `read`. WHICH kit verbs those are is per-platform, because `reset` is
 * conditional on the row declaring a `readReset` — so `atlasKitVerbsFor` is the list to ask, never the
 * constant. A tail that names no verb at all goes to the platform's `fallback` when it has one (Slack's map)
 * and is otherwise `needs-verb`; `--help` anywhere in a tail that names no verb the platform answers is
 * `help`. A verb the platform does not answer is `unknown-verb`, naming what was given, so the shell can say
 * so rather than print a bare usage block.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param registration the platform's row
 * @returns what to run, or what to explain
 */
export function atlasPlatformDispatch({
  argv,
  registration,
}: {
  argv: readonly string[];
  registration: AtlasPlatformRegistration;
}): AtlasPlatformDispatch {
  const given = argv[PLATFORM_VERB_INDEX];
  const kitVerbs = atlasKitVerbsFor({ hasReset: registration.readReset !== undefined });
  if (given !== undefined && kitVerbs.includes(given)) {
    return { kind: "kit", verb: given };
  }
  const own = registration.verbs.find((candidate) => candidate.verb === given);
  if (own !== undefined) {
    return { kind: "own", verb: own };
  }
  if (registration.fallback !== undefined) {
    return { kind: "fallback" };
  }
  if (atlasPlatformWantsHelp({ argv })) {
    return { kind: "help" };
  }
  if (given === undefined) {
    return { kind: "needs-verb" };
  }
  return { given, kind: "unknown-verb" };
}
