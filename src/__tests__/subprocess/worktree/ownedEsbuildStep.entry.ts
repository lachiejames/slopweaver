/**
 * The lap-chain witness's step (`tscOwnerLease.test.ts`): runs ONE owned esbuild emit through the production
 * `runOwnedEsbuild` — the spawn a lap's own `dev build` step makes — and prints what the owner said as one marked
 * JSON line on stdout, which the lap step writes into its own log. Not a test file: it is the process a real
 * `runLapStep` starts under `yarn tsx`, so the owner it spawns sits below a detached lap step exactly as a lap's
 * build does.
 */
import { runOwnedEsbuild } from "../../../cli/commands/dev/build.js";

const [root, source, outDir] = process.argv.slice(2);
if (root === undefined || source === undefined || outDir === undefined) {
  throw new Error("usage: ownedEsbuildStep <root> <source.ts> <outDir>");
}

process.stdout.write(`OWNED_ESBUILD ${JSON.stringify(runOwnedEsbuild({ files: [source], outDir, root }))}\n`);
