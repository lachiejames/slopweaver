/**
 * The help-truth tables' rows for `store`'s corpus-inspection verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { parseStoreBotsArgs, STORE_BOTS_FLAG_NAMES } from "../../../../cli/commands/store/bots.js";
import { parseStoreClassifyArgs, STORE_CLASSIFY_FLAG_NAMES } from "../../../../cli/commands/store/classifyCore.js";
import { parseDetectArgs } from "../../../../cli/commands/store/detect.js";
import { parseStoreEdgesArgs, STORE_EDGES_FLAG_NAMES } from "../../../../cli/commands/store/edges.js";
import { storeCommandErrorLines } from "../../../../cli/commands/store/errors.js";
import { parseExclusionArgs, STORE_EXCLUSION_FLAG_NAMES } from "../../../../cli/commands/store/exclusionCore.js";
import { parseStoreIdentityArgs, STORE_IDENTITY_FLAG_NAMES } from "../../../../cli/commands/store/identityArgs.js";
import { parseVerifyArgs } from "../../../../cli/commands/store/lifecycleArgs.js";
import { parseGroupsArgs, parseOpenArgs, parseProbeArgs } from "../../../../cli/commands/store/probeCore.js";
import { parseStoreCollectArgs, STORE_COLLECT_FLAG_NAMES } from "../../../../cli/commands/store/readCore.js";
import { parseSlackAsksArgs } from "../../../../cli/commands/store/slackAsksCore.js";
import { parseStoreStatusArgs, STORE_STATUS_FLAG_NAMES } from "../../../../cli/commands/store/statusCore.js";
import { parseStoreWatchQueueArgs } from "../../../../cli/commands/store/watchQueueRun.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  store: STORE_STATUS_FLAG_NAMES,
  "store identity": STORE_IDENTITY_FLAG_NAMES,
  "store exclusions": STORE_EXCLUSION_FLAG_NAMES,
  "store collect": STORE_COLLECT_FLAG_NAMES,
  "store status": STORE_STATUS_FLAG_NAMES,
  "store edges": STORE_EDGES_FLAG_NAMES,
  "store bots": STORE_BOTS_FLAG_NAMES,
  "store classify": STORE_CLASSIFY_FLAG_NAMES,
  "store slack-asks": ["--stranded", "--home", "--json"],
  // The progressive-disclosure ladder. Each takes a closed flag set off one pure parser, so every one of
  // them is guarded rather than listed as unguarded — see `src/cli/commands/store/probeCore.ts`.
  "store probe": [
    "--source",
    "--regex",
    "--enumerate-at-or-below",
    "--ids",
    "--include-bots",
    "--exclude-bots",
    "--json",
  ],
  "store groups": ["--term", "--shape", "--facet", "--limit", "--include-bots", "--exclude-bots", "--json"],
  "store open": ["--id", "--source", "--json"],
  "store detect": ["--term", "--recalled", "--variant", "--name", "--slots", "--ask", "--out", "--json"],
  "store verify": ["--workdir", "--home", "--json"],
  "store watch-queue": ["--home", "--json"],
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  store: {
    "--check": ["--check"],
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--source": ["--source", "slack"],
  },
  "store status": {
    "--check": ["--check"],
    "--full": ["--full"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--source": ["--source", "slack"],
  },
  "store edges": {
    "--batch": ["--batch", "500"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--keys-only": ["--keys-only"],
  },
  "store bots": {
    "--batch": ["--batch", "500"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "store classify": {
    "--batch": ["--batch", "500"],
    "--dry-run": ["--dry-run"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--sample": ["--sample", "10"],
  },
  "store identity": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--pull": ["--pull"],
  },
  "store probe": {
    "--enumerate-at-or-below": ["--enumerate-at-or-below", "40"],
    "--exclude-bots": ["--exclude-bots"],
    "--ids": ["--ids", "10"],
    "--include-bots": ["--include-bots"],
    "--json": ["--json"],
    "--regex": ["--regex", "pull/17000"],
    "--source": ["--source", "slack"],
  },
  "store groups": {
    "--exclude-bots": ["--exclude-bots"],
    "--facet": ["--facet", "container"],
    "--include-bots": ["--include-bots"],
    "--json": ["--json"],
    "--limit": ["--limit", "20"],
    "--shape": ["--shape", "exact"],
    "--term": ["--term", "barten"],
  },
  "store open": {
    "--id": ["--id", "a71ce9c5-f59a-45d7-b28c-3d31ff21b12a"],
    "--json": ["--json"],
    "--source": ["--source", "datadog"],
  },
  "store detect": {
    "--ask": ["--ask", "C0TEST/1789600000.000100"],
    "--json": ["--json"],
    "--name": ["--name", "barten"],
    "--out": ["--out", "/tmp/wave"],
    "--recalled": ["--recalled", "a recalled claim"],
    "--slots": ["--slots", "8"],
    "--term": ["--term", "barten"],
    // `--variant` carries its `--name` because a variant of nothing is refused by design — the probe is a
    // valid invocation of the flag, which is what this map states, not the flag in isolation.
    "--variant": ["--name", "barten", "--variant", "barton"],
  },
  "store slack-asks": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--stranded": ["--stranded"],
  },
  "store verify": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--workdir": ["--workdir", "/tmp"],
  },
  "store watch-queue": {
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
  },
  "store collect": {
    "--json": ["--json"],
    "--plan": ["--plan", "p.json"],
    "--replies": ["--replies", "r.json"],
  },
  "store embed": {
    "--coverage": ["--coverage"],
    "--head": ["--source", "slack", "--head", "10"],
    "--json": ["--coverage", "--json"],
    "--since": ["--source", "slack", "--since", "2026-09-08T00:00:00Z"],
    "--source": ["--source", "slack"],
  },
  // Every probe carries the sub-verb word, because the flags are parsed only after it: an invocation with
  // no `detect` or `purge` is refused before any flag is read, which would make every probe pass for the
  // wrong reason. `--apply` and `--delete-human-threads` both ride `purge`, since each is a deliberate
  // refusal on `detect`.
  "store exclusions": {
    "--apply": ["purge", "--apply"],
    "--delete-human-threads": ["purge", "--delete-human-threads"],
    "--home": ["purge", "--home", "/tmp"],
    "--json": ["purge", "--json"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  store: ({ fragment }) => parseStoreStatusArgs({ rest: [...fragment] }),
  // The fragment already opens with its own sub-verb word (see the GUARDED probes), so nothing is prefixed
  // here: a base `purge` in front of a fragment that starts with `detect` would parse the wrong verb.
  "store exclusions": ({ fragment }) =>
    parseExclusionArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store identity": ({ fragment }) => parseStoreIdentityArgs({ rest: [...fragment] }),
  "store collect": ({ fragment }) =>
    parseStoreCollectArgs({
      rest: dedupeFlags({ base: ["--plan", "p.json", "--replies", "r.json"], fragment }),
    }).mapErr((error) => storeCommandErrorLines({ error })),
  "store status": ({ fragment }) => parseStoreStatusArgs({ rest: [...fragment] }),
  "store edges": ({ fragment }) =>
    parseStoreEdgesArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store bots": ({ fragment }) =>
    parseStoreBotsArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store classify": ({ fragment }) =>
    parseStoreClassifyArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  // Each ladder verb is probed against its own required arguments plus the fragment under test, so a flag
  // that the usage advertises and the parser refuses fails here rather than in a detective's hands.
  "store probe": ({ fragment }) =>
    parseProbeArgs({ rest: ["barten", ...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store groups": ({ fragment }) =>
    parseGroupsArgs({
      rest: [...dedupeFlags({ base: ["--term", "barten", "--shape", "exact", "--facet", "source"], fragment })],
    }).mapErr((error) => storeCommandErrorLines({ error })),
  "store open": ({ fragment }) =>
    parseOpenArgs({ rest: [...dedupeFlags({ base: ["--id", "a71ce9c5"], fragment })] }).mapErr((error) =>
      storeCommandErrorLines({ error }),
    ),
  "store detect": ({ fragment }) =>
    parseDetectArgs({
      nowMs: 0,
      rest: ["a question", ...dedupeFlags({ base: ["--term", "barten"], fragment })],
      roots: { recordSet: "/tmp/live", unattached: "/tmp" },
    }).mapErr((error) => storeCommandErrorLines({ error })),
  "store slack-asks": ({ fragment }) => parseSlackAsksArgs({ rest: [...fragment] }),
  "store verify": ({ fragment }) => parseVerifyArgs({ rest: [...fragment] }),
  "store watch-queue": ({ fragment }) => parseStoreWatchQueueArgs({ rest: fragment }),
};

/** The rows for `store`'s corpus-inspection verbs. */
export const storeCorpusSlice: HelpTruthSlice = { guarded, probes, parsers };
