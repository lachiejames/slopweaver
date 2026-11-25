/**
 * The staleness guard: a built CLI never answers once it stops describing the source it was built from.
 *
 * A built CLI is rebuilt on pull with a staleness guard that makes it impossible for an agent to test a stale
 * build. Two things follow from IMPOSSIBLE rather than unlikely, and they are the whole design:
 *
 * 1. The check lives INSIDE the artifact, ahead of any verb dispatch, so `node dist-cli/cli/index.js`
 *    reaches it exactly as the launcher does. A check in `bin/slopweaver` is one `node` away from being
 *    skipped, and it would cost a second process start to make — the emit exists to save ~640 ms per
 *    invocation, not to spend it twice.
 * 2. A stale tree never answers from its older JavaScript, and never hands the invocation anywhere silently.
 *    What it hands to is the EDITED code: the source of the very checkout its manifest names, under tsx's loader,
 *    announced by one stderr line naming that checkout (`./sourceRestart.ts`). The defect this guard exists for is
 *    old code answering as if it were the code being edited; the source is the code being edited, and the line
 *    says it is what ran.
 *
 * The invariant is exactly that: no verb is DISPATCHED from a stale build. `./invocationGuard.ts` decides which of
 * four things a stale invocation does instead. An ordinary caller restarts on its checkout's source. A child the
 * console launched waits out a rebuild in flight and restarts on the fresh build (`./consoleRebuildWait.ts`). A verb
 * that needs the built tree itself (`./sourceFallbackPolicy.ts`), or a checkout that cannot run its source, refuses
 * at once with the remedy. The `SLOPWEAVER_ALLOW_STALE_BUILD` hatch runs the stale build deliberately, and says so.
 * A manifest that is unreadable, or whose checkout is gone, refuses: nothing names a source to run.
 *
 * Running from SOURCE reaches none of this. There is no manifest beside `src/cli/`, so the guard answers
 * `ran: false` and the process continues — a checkout that has never built has no build to be stale, and a source
 * restart never re-enters the stale arm.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hatchFor } from "../hatch/lookup.js";
import { hatchRefusalLines } from "../hatch/render.js";
import { scanSourceStamps } from "./sourceScan.js";
import { BUILD_MANIFEST_FILE, parseBuildManifest, stalenessOf } from "./staleness.js";

/** @internal — the hatch a deliberate stale run opens; the row itself is in `src/hatch/registry.ts`. */
export const STALE_BUILD_HATCH_ID = "stale-build";

/** The ambient variable a deliberate stale run sets — the register owns the suffix, this names it once. */
export const STALE_BUILD_ENV = "SLOPWEAVER_ALLOW_STALE_BUILD";

/**
 * Whether an ambient hatch variable is open.
 *
 * Present-and-non-empty rather than equal to `"1"`: an operator who exported `=true` meant to open it, and
 * a hatch that quietly ignores the value typed is not a hatch that always works, and the owner wants hatches
 * that always work.
 *
 * @param value the environment variable as read, or undefined when it is unset
 * @returns whether the hatch is open
 */
export function hatchIsOpen({ value }: { value: string | undefined }): boolean {
  return value !== undefined && value !== "";
}

/**
 * @internal — a valid manifest whose checkout is there and whose source has moved, the one stale shape with somewhere
 * to go; named outside this file only as {@link GuardOutcome}'s `staleSource` field.
 */
export interface StaleSource {
  /** The manifest's text, which a console child's rebuild wait judges replacements against. */
  readonly manifestText: string;
  /** The checkout the manifest names, absolute — the only source a restart may run. */
  readonly root: string;
  /** The first difference, as {@link stalenessOf} words it. */
  readonly why: string;
}

/** What the guard did, so a caller can act on it and a test can assert on it. */
export interface GuardOutcome {
  /** Whether a built tree was found at all — false when running from source. */
  readonly ran: boolean;
  /** Whether the process should stop. False both when fresh and when the hatch is open. */
  readonly refuse: boolean;
  /** The lines to print. Empty on the ordinary fresh path, which says nothing. */
  readonly lines: readonly string[];
  /**
   * Set on ONE arm only: a refusal of a valid manifest whose checkout is there and whose source has moved — the
   * shape a rebuild in flight leaves, so the one a console child may wait out (`./consoleRebuildWait.ts`), and the
   * one an ordinary caller may restart on source from (`./sourceRestart.ts`). An unreadable manifest or a vanished
   * checkout proves no rebuild and names no source, and carries none.
   */
  readonly staleSource?: StaleSource;
}

/**
 * Judge one built tree against the source beside it.
 *
 * Split from {@link refuseStaleBuild} so the decision is testable without a process to exit: every branch
 * here is reachable from a `mkdtempSync` fixture.
 *
 * @param builtRoot the built tree's own directory, absolute — its parent is the repository root
 * @param hatchOpen whether the operator asked for a stale run deliberately
 * @returns what to print and whether to stop
 */
export function guardBuiltTree({ builtRoot, hatchOpen }: { builtRoot: string; hatchOpen: boolean }): GuardOutcome {
  const manifestPath = join(builtRoot, BUILD_MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    return { lines: [], ran: false, refuse: false };
  }
  const manifestText = readFileSync(manifestPath, "utf8");
  const manifest = parseBuildManifest({ text: manifestText });
  const hatch = hatchFor({ id: STALE_BUILD_HATCH_ID });
  if (manifest === undefined) {
    const detail = `${manifestPath} is not a build manifest, so what this tree was built from is unknown`;
    if (hatchOpen) {
      return { lines: [`slopweaver: [stale-build] override in force — ${detail}`], ran: true, refuse: false };
    }
    return { lines: hatchRefusalLines({ detail, hatch }), ran: true, refuse: true };
  }
  const root = manifest.root;
  if (!existsSync(root)) {
    const detail = `the checkout it was built from (${root}) is gone, so nothing can say whether it is current`;
    if (hatchOpen) {
      return { lines: [`slopweaver: [stale-build] override in force — ${detail}`], ran: true, refuse: false };
    }
    return { lines: hatchRefusalLines({ detail, hatch }), ran: true, refuse: true };
  }
  const staleness = stalenessOf({ current: scanSourceStamps({ root }), manifest });
  if (!staleness.stale) {
    return { lines: [], ran: true, refuse: false };
  }
  if (hatchOpen) {
    return {
      lines: [
        `slopweaver: [stale-build] override in force — ${staleness.why}.`,
        `slopweaver:   this answer comes from ${builtRoot}, built at ${manifest.builtAtIso}, NOT from ${root}/src.`,
      ],
      ran: true,
      refuse: false,
    };
  }
  const detail = `${staleness.why} — rebuild with \`slopweaver dev build\``;
  return {
    lines: hatchRefusalLines({ detail, hatch }),
    ran: true,
    refuse: true,
    staleSource: { manifestText, root, why: staleness.why },
  };
}

/**
 * Where this module is running from, and whether that is a built tree.
 *
 * The emit preserves the module structure, so this file lands at `<built>/builtCli/guard.js` and the manifest
 * one directory above it. Under `tsx` the same arithmetic names `src/`, where no manifest sits.
 *
 * @param moduleUrl `import.meta.url` of this module
 * @returns the directory the manifest would be in
 */
export function builtRootOf({ moduleUrl }: { moduleUrl: string }): string {
  return dirname(dirname(fileURLToPath(moduleUrl)));
}

/**
 * Whether a module is loaded from TypeScript source rather than the emit. The emit only ever writes `.js`, so a `.ts`
 * module URL is a tsx run — the one a stale build's source restart lands in, and the one that must never restart on
 * source again, whatever manifest sits beside `src/`.
 *
 * @param moduleUrl `import.meta.url` of the calling module
 * @returns true when that module is a `.ts` file
 */
export function runsFromSource({ moduleUrl }: { moduleUrl: string }): boolean {
  return fileURLToPath(moduleUrl).endsWith(".ts");
}
