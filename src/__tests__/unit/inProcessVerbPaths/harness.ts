/**
 * What the split in-process path scanner tests share: the synthetic commands root and manifest, the tree builder,
 * the plain verb module most cases load, the real gate's import line, and the two readers that sort a scan's result.
 * Pure data and in-memory scans, no I/O. Moved here when the one test file was split by behaviour.
 */
import { scanInProcessPaths } from "../../inProcessVerbPaths.js";

export const ROOT = "/r/src/cli/commands";
const MANIFEST = "/r/src/cli/manifests/a.ts";

/**
 * A tree of files under `ROOT`, plus a manifest loading the verb modules named.
 *
 * @returns the manifest and every file keyed by its absolute path
 */
export function tree({
  files,
  loaded,
}: {
  files: Record<string, string>;
  loaded: readonly string[];
}): Map<string, string> {
  const manifest = loaded.map((name) => `lazy({ load: () => import("../commands/${name}.js") });`).join("\n");
  return new Map([
    [MANIFEST, manifest],
    ...Object.entries(files).map(([name, text]): [string, string] => [`${ROOT}/${name}.ts`, text]),
  ]);
}

export const TARGET = `
export async function runTarget(argv: readonly string[]): Promise<number> {
  return 0;
}
export function helper({ home }: { home: string }): number {
  return 1;
}
export const targetCommand = defineCommand({ run: (argv) => runTarget(argv) });
`;

/** The real gate's import, as a verb module directly under `ROOT` spells it. */
export const GATE_IMPORT = `import { refuseRunnerOnStandingRuling } from "../rulingGateDoor.js";\n`;

/**
 * Each reached body and the gate it opens with, sorted.
 *
 * @returns one `body: gate` line per reached body, the gate as JSON
 */
export function gatesOf({ files }: { files: Map<string, string> }): readonly string[] {
  return scanInProcessPaths({ commandsRoot: ROOT, files })
    .reached.map((body) => `${body.body}: ${JSON.stringify(body.gate)}`)
    .toSorted();
}

/**
 * The `importer -> body` pairs a scan finds, sorted.
 *
 * @returns one `importer -> body` line per path, the importer relative to `ROOT`
 */
export function pairs({ files }: { files: Map<string, string> }): readonly string[] {
  return scanInProcessPaths({ commandsRoot: ROOT, files })
    .paths.map((path) => `${path.importer.slice(ROOT.length + 1)} -> ${path.body}`)
    .toSorted();
}
