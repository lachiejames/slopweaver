/**
 * `slopweaver atlas doctor` — the effectful shell.
 *
 * Thin by design: the grading is `atlas/kit/answerable.ts`'s and the rendering is {@link ./doctorCore}'s.
 * What lives here is the sweep — walk the registry, read each atlas through the SAME guarded path a reader
 * gets, and turn each refusal into a row.
 *
 * It makes **no network call**. That is the whole point of it being cheap enough to run on every atlas pull
 * request: the question is not "is the provider up", it is "can what we shipped be read back".
 */
import { gradeAtlasAnswerability } from "../../../atlas/kit/answerable.js";
import { estateNotEstablishedKinds } from "../../../atlas/kit/estateEvidence.js";
import { type AtlasReadError, AtlasReadErrors } from "../../../atlas/kit/read.js";
import { atlasSidecarErrorLines } from "../../../atlas/kit/sidecarErrors.js";
import { repairSingleFileGeneration } from "../../../atlas/kit/singleFileRepair.js";
import { atlasPathsFor } from "../../../atlas/platformPaths.js";
import { atlasPlatforms, findAtlasPlatform } from "../../../atlas/registry.js";
import { logger } from "../../../lib/logger.js";
import { err, ok, type Result } from "../../../lib/result.js";
import { defineCommand } from "../../defineCommand.js";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE } from "../../exitCodes.js";
import {
  ATLAS_DOCTOR_USAGE,
  type AtlasDoctorRow,
  atlasDoctorFailures,
  atlasDoctorJson,
  parseAtlasDoctorArgs,
  renderAtlasDoctor,
} from "./doctorCore.js";
import { atlasCommandErrorLines } from "./errors.js";

/** Where the flag tail starts: past the runtime, the script, the `atlas` noun and the `doctor` verb. */
const VERB_ARG_OFFSET = 4;

/** The injected edges, so the shell is testable with plain fakes. */
export interface AtlasDoctorDeps {
  readonly platforms: typeof atlasPlatforms;
  readonly find: typeof findAtlasPlatform;
  readonly repair: typeof repairSingleFileGeneration;
  readonly now: () => string;
  readonly writeOut: (line: string) => void;
  readonly writeDiagnostic: (line: string) => void;
}

/**
 * The real edges.
 *
 * @returns the production dependencies, writing to the process's own streams
 * @internal
 */
export function productionAtlasDoctorDeps(): AtlasDoctorDeps {
  return {
    find: findAtlasPlatform,
    now: () => new Date().toISOString(),
    platforms: atlasPlatforms,
    repair: repairSingleFileGeneration,
    writeDiagnostic: (line) => process.stderr.write(`${line}\n`),
    writeOut: (line) => {
      logger.out({ line });
    },
  };
}

/**
 * Grade one atlas, repairing a legacy on-disk layout first when asked.
 *
 * @param deps the injected edges
 * @param platform the atlas to grade
 * @param home the state home to read from, when the caller passed one
 * @param repair whether to rewrite a pre-`.jsonl` generation before grading
 * @returns the row for this atlas
 */
export async function gradeOneAtlas({
  deps,
  platform,
  home,
  repair,
}: {
  deps: AtlasDoctorDeps;
  platform: string;
  home: string | undefined;
  repair: boolean;
}): Promise<AtlasDoctorRow> {
  const repairedKinds = repair ? repairFirst({ deps, home, platform }) : [];
  const registration = deps.find({ platform });
  if (registration === null) {
    return {
      ...blankRow({ platform, repairedKinds }),
      because: AtlasReadErrors.platformUnknown({ known: deps.platforms(), platform }).message,
      grade: "unreadable",
    };
  }
  const snapshot = await registration.readSnapshot(home === undefined ? {} : { home });
  if (snapshot.isOk()) {
    // Computed HERE rather than inside `gradeAtlasAnswerability`, because it needs the DESCRIPTOR and that
    // function's input deliberately excludes one so a test can grade a state without building a whole
    // atlas. This shell has the whole snapshot, so it is the cheap place to ask.
    return {
      ...gradeAtlasAnswerability({ snapshot: snapshot.value }),
      estateNotEstablishedKinds: estateNotEstablishedKinds({
        descriptor: snapshot.value.descriptor,
        kinds: snapshot.value.kinds,
      }),
      repairedKinds,
    };
  }
  return rowFromRefusal({ error: snapshot.error, platform, repairedKinds });
}

/**
 * Repair this atlas's legacy on-disk layout before it is graded, reporting a stopped repair rather than
 * failing the whole sweep — a repair that cannot run is worth saying out loud, and the grade below still
 * tells the reader what state the atlas is actually in.
 *
 * @param deps the injected edges
 * @param platform the atlas to repair
 * @param home the state home, when the caller passed one
 * @returns the kinds rewritten, empty when there was nothing to do or the repair stopped
 */
function repairFirst({
  deps,
  platform,
  home,
}: {
  deps: AtlasDoctorDeps;
  platform: string;
  home: string | undefined;
}): readonly string[] {
  const paths = atlasPathsFor({ home, platform });
  if (paths === null) {
    return [];
  }
  const done = deps.repair({ nowIso: deps.now(), paths });
  if (done.isErr()) {
    deps.writeDiagnostic(`${platform}: repair stopped — ${atlasSidecarErrorLines({ error: done.error }).join("; ")}`);
    return [];
  }
  return done.value.map((entry) => entry.kind);
}

/**
 * A row carrying nothing but its identity, for the grades that have no counts to report.
 *
 * **The four reachability lists are empty here, and that is a real limit rather than a default.** Three are
 * computed by `gradeAtlasAnswerability` from a SNAPSHOT and the fourth by `kit/estateEvidence.ts` from a
 * snapshot's descriptor, and every grade that reaches this function is one
 * where the guarded read handed back an error instead of one — so there is nothing to compute them from.
 * For `unpublished` and `unreadable` that is simply true: nothing was read. For `dark` it means an atlas
 * whose manifest DOES carry a permission block reports none while it is dark, because
 * `AtlasReadErrors.generationDark` carries the dark kinds and not the kinds' statuses. That is the safe
 * direction — darkness is files the reader cannot open, which is unambiguously a defect and never a
 * permission boundary, so the row reports the defect rather than a boundary it cannot see — but a reader
 * should not take an empty list on a failing atlas as evidence that nothing is fenced. Closing it properly
 * means an unguarded second read in the refusal path, which is a change to `registry.ts`'s one door.
 */
function blankRow({ platform, repairedKinds }: { platform: string; repairedKinds: readonly string[] }): AtlasDoctorRow {
  return {
    because: "",
    darkKinds: [],
    estateNotEstablishedKinds: [],
    gapKinds: [],
    grade: "unreadable",
    notAttemptedKinds: [],
    permissionBlockedKinds: [],
    platform,
    productAbsentKinds: [],
    readable: 0,
    repairedKinds,
    vouchedFor: 0,
  };
}

/**
 * Turn a read refusal into the row that names WHICH way this atlas cannot answer.
 *
 * The three codes are three different situations for a reader — nothing synced here, a generation that
 * cannot be read back, and a store that will not open at all — and collapsing them would put an atlas
 * nobody has synced in the same column as a corrupt one.
 *
 * @param error what the guarded read refused with
 * @param platform the atlas being graded
 * @param repairedKinds what a repair rewrote before the read, if any
 * @returns the graded row
 */
function rowFromRefusal({
  error,
  platform,
  repairedKinds,
}: {
  error: AtlasReadError;
  platform: string;
  repairedKinds: readonly string[];
}): AtlasDoctorRow {
  if (error.code === "ATLAS_GENERATION_UNPUBLISHED") {
    return { ...blankRow({ platform, repairedKinds }), because: error.message, grade: "unpublished" };
  }
  if (error.code === "ATLAS_GENERATION_DARK") {
    return {
      ...blankRow({ platform, repairedKinds }),
      because: error.message,
      darkKinds: error.darkKinds,
      grade: "dark",
      readable: error.readable,
      vouchedFor: error.vouchedFor,
    };
  }
  return { ...blankRow({ platform, repairedKinds }), because: error.message, grade: "unreadable" };
}

/**
 * Run the verb.
 *
 * @param deps the injected edges
 * @param rest the argv tail after `atlas doctor`
 * @returns the process exit code
 */
export async function runAtlasDoctor({
  deps,
  rest,
}: {
  deps: AtlasDoctorDeps;
  rest: readonly string[];
}): Promise<number> {
  if (rest.includes("--help") || rest.includes("-h")) {
    deps.writeOut(ATLAS_DOCTOR_USAGE);
    return EXIT_OK;
  }
  const parsed = parseAtlasDoctorArgs({ rest });
  if (parsed.isErr()) {
    for (const line of [...atlasCommandErrorLines({ error: parsed.error }), ATLAS_DOCTOR_USAGE]) {
      deps.writeDiagnostic(line);
    }
    return EXIT_USAGE;
  }
  const options = parsed.value;
  const targets = resolveTargets({ known: deps.platforms(), platform: options.platform });
  if (targets.isErr()) {
    deps.writeDiagnostic(targets.error.message);
    return EXIT_USAGE;
  }
  const named = options.platform !== undefined;
  const rows: AtlasDoctorRow[] = [];
  for (const platform of targets.value) {
    // Serially rather than in parallel: every atlas is a synchronous whole-directory read, and the widest
    // generation here is 93.1 MiB, so a fan-out would hold every one of them in memory at once.
    // eslint-disable-next-line no-await-in-loop
    rows.push(await gradeOneAtlas({ deps, home: options.home, platform, repair: options.repair }));
  }
  const lines = options.json ? [JSON.stringify(atlasDoctorJson({ named, rows }))] : renderAtlasDoctor({ named, rows });
  for (const line of lines) {
    deps.writeOut(line);
  }
  return atlasDoctorFailures({ named, rows }).length > 0 ? EXIT_ERROR : EXIT_OK;
}

/**
 * Which atlases this invocation grades.
 *
 * @param platform the one the caller named, or `undefined` for a sweep
 * @param known every platform this build has
 * @returns the platforms to grade, or why the named one cannot be
 */
function resolveTargets({
  platform,
  known,
}: {
  platform: string | undefined;
  known: readonly string[];
}): Result<readonly string[], AtlasReadError> {
  if (platform === undefined) {
    return ok(known);
  }
  if (!known.includes(platform)) {
    return err(AtlasReadErrors.platformUnknown({ known, platform }));
  }
  return ok([platform]);
}

export const atlasDoctorCommand = defineCommand({
  run: (argv) => runAtlasDoctor({ deps: productionAtlasDoctorDeps(), rest: argv.slice(VERB_ARG_OFFSET) }),
});
