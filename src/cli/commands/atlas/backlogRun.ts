/**
 * `slopweaver atlas backlog` — the effectful shell of the refused-exclusion register.
 *
 * Thin by design: the ordering is `atlas/kit/backlog.ts`'s and the rendering is {@link ./backlogCore}'s.
 * What lives here is the gather — one descriptor read per registered atlas, no snapshot, no network call
 * and no credential, so the default run is as cheap as `atlas freshness` and safe on a schedule.
 *
 * **`--deferred` is the one part that reads the local store**, because the gate's third refused shape — a
 * kind left `deferred` — is a property of the published generation rather than of a descriptor
 * ({@link ../../../atlas/kit/deferredBacklog}). It is a flag rather than the default precisely so the cheap
 * property above survives, and `backlogRun.test.ts` pins it: the default path runs against a registry whose
 * `readSnapshot` REJECTS, so a change that started reading snapshots unconditionally fails there.
 *
 * **It always exits 0.** That is the rule expressed as code rather than
 * prose: the refused rows are a backlog to work down, never a gate on an atlas pull request. `slopweaver
 * atlas <platform> coverage` still exits 3 on the same rows, because its question is whether ONE atlas is
 * complete today; this verb's question is what to work on next, and a register that failed a run would be
 * a gate, which this verb is not.
 */
import { type AtlasBacklogRow, orderAtlasBacklog, refusedRowsOf } from "../../../atlas/kit/backlog.js";
import {
  type AtlasDeferredBacklog,
  type AtlasDeferredRow,
  type AtlasUnreadAtlas,
  orderAtlasDeferred,
} from "../../../atlas/kit/deferredBacklog.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  filterAtlasBacklog,
  filterAtlasDeferred,
  parseAtlasBacklogArgs,
  renderAtlasBacklog,
  renderAtlasDeferred,
} from "./backlogCore.js";
import { ATLAS_BACKLOG_USAGE } from "./backlogUsage.js";
import { refusedCoverage } from "./coverageCore.js";
import { atlasCommandErrorLines } from "./errors.js";

/** Where the flag tail starts: past the runtime, the script, the `atlas` noun and the `backlog` verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable with plain fakes. */
export interface AtlasBacklogDeps {
  readonly platforms: typeof atlasPlatforms;
  readonly find: typeof findAtlasPlatform;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to the process's own streams
 * @internal
 */
export function productionAtlasBacklogDeps(): AtlasBacklogDeps {
  return {
    find: findAtlasPlatform,
    platforms: atlasPlatforms,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Read every registered atlas's declaration and collect its refused rows.
 *
 * @param deps the injected edges
 * @returns every refused row this build declares, in registry order
 */
export async function gatherAtlasBacklogRows({
  deps,
}: {
  deps: AtlasBacklogDeps;
}): Promise<readonly AtlasBacklogRow[]> {
  const rows: AtlasBacklogRow[] = [];
  for (const platform of deps.platforms()) {
    const registration = deps.find({ platform });
    if (registration === null) {
      continue;
    }
    rows.push(...refusedRowsOf({ descriptor: await registration.readDescriptor(), platform }));
  }
  return rows;
}

/**
 * Read every registered atlas's published generation and collect the kinds it left `deferred`.
 *
 * The one place this verb touches the store, which is why it runs only under `--deferred`: a deferred cell
 * is a property of what was PUBLISHED, so there is nothing in a descriptor to read it off. An atlas whose
 * generation refuses becomes an `unread` row carrying that refusal's own message rather than a zero — see
 * `kit/deferredBacklog.ts` on why not-counted must never print as clear.
 *
 * @param deps the injected edges
 * @returns every deferred cell the sweep could read, and every atlas it could not
 */
export async function gatherAtlasDeferred({ deps }: { deps: AtlasBacklogDeps }): Promise<AtlasDeferredBacklog> {
  const rows: AtlasDeferredRow[] = [];
  const unread: AtlasUnreadAtlas[] = [];
  for (const platform of deps.platforms()) {
    const registration = deps.find({ platform });
    if (registration === null) {
      continue;
    }
    const snapshot = await registration.readSnapshot({});
    if (snapshot.isErr()) {
      unread.push({ because: snapshot.error.message, platform });
      continue;
    }
    rows.push(
      ...refusedCoverage({ snapshot: snapshot.value }).deferred.map((cell) => ({
        kind: cell.kind,
        platform,
        reason: cell.reason,
        scope: cell.scope,
        surface: cell.surface,
      })),
    );
  }
  return orderAtlasDeferred({ rows, unread });
}

/**
 * Run the verb.
 *
 * @param argv the whole process argv, as the CLI received it
 * @param deps the injected edges; omitted takes the production ones
 * @returns the process exit code — {@link EXIT_OK} unless the ARGUMENTS were wrong
 */
export async function runAtlasBacklog({
  argv,
  deps = productionAtlasBacklogDeps(),
}: {
  argv: readonly string[];
  deps?: AtlasBacklogDeps;
}): Promise<number> {
  const rest = argv.slice(VERB_ARG_OFFSET);
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ATLAS_BACKLOG_USAGE);
    return EXIT_OK;
  }
  const options = parseAtlasBacklogArgs({ rest });
  if (options.isErr()) {
    atlasCommandErrorLines({ error: options.error }).forEach((line) => {
      deps.writeDiagnostic(line);
    });
    deps.writeDiagnostic(ATLAS_BACKLOG_USAGE);
    return EXIT_USAGE;
  }

  const known = deps.platforms();
  const named = options.value.platform;
  if (named !== undefined && !known.includes(named)) {
    deps.writeDiagnostic(`no atlas for platform ${named} — this build has: ${known.join(", ")}`);
    return EXIT_USAGE;
  }

  const whole = orderAtlasBacklog({ rows: await gatherAtlasBacklogRows({ deps }) });
  const backlog = filterAtlasBacklog({ backlog: whole, options: options.value });
  let deferred: AtlasDeferredBacklog | undefined;
  if (options.value.deferred) {
    deferred = filterAtlasDeferred({ deferred: await gatherAtlasDeferred({ deps }), options: options.value });
  }

  if (options.value.json) {
    deps.writeOut(JSON.stringify(deferred === undefined ? backlog : { ...backlog, deferred }, null, 2));
    return EXIT_OK;
  }
  renderAtlasBacklog({ backlog }).forEach((line) => {
    deps.writeOut(line);
  });
  if (deferred !== undefined) {
    renderAtlasDeferred({ deferred }).forEach((line) => {
      deps.writeOut(line);
    });
  }
  return EXIT_OK;
}

export const atlasBacklogCommand = defineCommand({
  run: (argv) => runAtlasBacklog({ argv }),
});
