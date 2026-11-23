/**
 * The installed desktop app as `checkout console` reads it: the bundle's stamp, then git over the app's own paths.
 * The decisions are pure in `./installedApp.ts`; this runs them over the reader's seams (`./consoleBuildDeps.ts`).
 */
import type { ConsoleBuildDeps } from "./consoleBuildDeps.js";
import { forkShaOf, type InstalledApp, installedStampOf, shellDiffArgs } from "./installedApp.js";

/**
 * The installed desktop app, and whether its source differs from the upstream tip's. Git runs only for a clean
 * stamp, and the fork point only when the source differs — the page places the build by it to list what changed.
 * The bundle is read with no upstream too, so a bundle that will not read is a problem line, never silence.
 *
 * @param deps the reader's seams, of which only the bundle read and git are used
 * @param root the checkout, whose object store holds the stamped commit when the app was built from it or a branch
 * @param upstream the tip this reading read (never the ref again) and the ref's name, for a problem sentence;
 *   `undefined` when it could not be read, which compares nothing
 * @param problems collects every read that failed
 * @returns the app as this reading saw it
 */
export function readInstalledApp({
  deps,
  problems,
  root,
  upstream,
}: {
  deps: Pick<ConsoleBuildDeps, "git" | "installedPlist">;
  problems: string[];
  root: string;
  upstream: { readonly ref: string; readonly sha: string } | undefined;
}): InstalledApp {
  const read = installedStampOf({ read: deps.installedPlist() });
  if (read.kind === "absent") {
    return read;
  }
  if (read.kind === "unreadable") {
    problems.push(read.why);
    return read;
  }
  const { stamp } = read;
  if (stamp.tree === "dirty" || upstream === undefined) {
    return { forkSha: undefined, kind: "read", shellDiffers: undefined, stamp };
  }
  const { ref, sha: upstreamSha } = upstream;
  const diff = deps.git({ args: shellDiffArgs({ from: stamp.sha, to: upstreamSha }), cwd: root });
  if (diff === undefined) {
    problems.push(
      `whether ${ref} changes the installed app could not be read — its commit ${stamp.sha.slice(0, 9)} may not be in this checkout`,
    );
    return { forkSha: undefined, kind: "read", shellDiffers: undefined, stamp };
  }
  if (diff === "") {
    return { forkSha: undefined, kind: "read", shellDiffers: false, stamp };
  }
  const base = deps.git({ args: ["merge-base", stamp.sha, upstreamSha], cwd: root });
  let forkSha: string | undefined;
  if (base !== undefined) {
    forkSha = forkShaOf({ text: base });
  }
  if (forkSha === undefined) {
    // The diff already proved a new version; only where the build sits, so which landings it lacks, is unknown.
    problems.push(
      `where the installed app ${stamp.sha.slice(0, 9)} forked from ${ref} could not be read — which landings it lacks are not listed`,
    );
  }
  return { forkSha, kind: "read", shellDiffers: true, stamp };
}
