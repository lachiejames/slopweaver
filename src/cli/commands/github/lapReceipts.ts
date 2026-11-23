/**
 * Where a lap keeps its logs and receipt, `<home>/laps/<owner>-<repo>/<number>/<started>/`, and the read of every
 * receipt kept for one pull request, which `--land-only` holds a status's claim to. The file edges only; the
 * judgement is `landOnlyReceiptFindings` (`./lapVerdict.ts`).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { stateHomePaths } from "../../../stateHome.js";
import type { GithubLapArgs } from "./lapCore.js";
import { type LapReceiptEvidence, lapStepKey } from "./lapVerdict.js";

/** The fields of a written `lap.json` the read-back needs; any other field is the receipt's own business. */
const RECEIPT_EVIDENCE = z.object({
  baseTip: z.string(),
  headSha: z.string(),
  outcomes: z.array(z.object({ exitCode: z.number(), id: z.string() })),
  phase: z.string(),
  plan: z.array(z.object({ argv: z.array(z.string()), directory: z.string().optional(), id: z.string() })),
});

/**
 * The directory every lap of one pull request keeps its runs under, and every BATCH lap of a repository under its
 * own `batch` directory — never a member's, because `--land-only` holds a member's status to a receipt there, and
 * a green earned in combination is not one the member earned alone.
 *
 * @returns `<home>/laps/<owner>-<repo>/<number>`, or `<home>/laps/<owner>-<repo>/batch` for a batch
 */
export function lapRunsDirectory({ home, args }: { home: string; args: GithubLapArgs }): string {
  const leaf = args.batch === undefined ? String(args.number) : "batch";
  return join(stateHomePaths({ home }).laps, `${args.owner}-${args.repo}`, leaf);
}

/** One run directory's receipt, or nothing when it has none or it does not parse as one. */
function readOne({ path }: { path: string }): readonly LapReceiptEvidence[] {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const parsed = RECEIPT_EVIDENCE.safeParse(JSON.parse(readFileSync(path, "utf8")));
    if (!parsed.success) {
      return [];
    }
    const { baseTip, headSha, outcomes, phase, plan } = parsed.data;
    return [{ baseTip, headSha, outcomes, phase, plan: plan.map((step) => lapStepKey(step)) }];
  } catch {
    return [];
  }
}

/**
 * Every receipt this home keeps for the pull request. An unreadable or malformed file is not evidence a lap ran,
 * so it is left out rather than failing the read: `--land-only` refuses when nothing earns the head.
 *
 * @returns each run's evidence, in directory order
 */
export function readLapReceipts({ home, args }: { home: string; args: GithubLapArgs }): readonly LapReceiptEvidence[] {
  const root = lapRunsDirectory({ args, home });
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root).flatMap((run) => readOne({ path: join(root, run, "lap.json") }));
}
