/**
 * The help-truth tables' rows for `store`'s read verbs — merged by `./allTables.ts` and swept by `../helpTruth.test.ts`,
 * whose header says what each table proves.
 */

import { STORE_CITE_FLAG_NAMES, STORE_CITE_FLAG_SPEC } from "../../../../cli/commands/store/cite.js";
import {
  parseStoreDetailArgs,
  parseStoreFacetArgs,
  parseStoreReadArgs,
  STORE_DETAIL_FLAG_NAMES,
  STORE_FACET_FLAG_NAMES,
  STORE_QUERY_FLAG_NAMES,
} from "../../../../cli/commands/store/core.js";
import { storeCommandErrorLines } from "../../../../cli/commands/store/errors.js";
import { parseAroundArgs, parseHitsArgs, parsePeekArgs } from "../../../../cli/commands/store/probeCore.js";
import { STORE_READ_FLAG_NAMES, STORE_READ_FLAG_SPEC } from "../../../../cli/commands/store/read.js";
import { parseStoreQuestionArgs } from "../../../../cli/commands/store/shell.js";
import { type HelpTruthSlice } from "./mergeSlices.js";
import { dedupeFlags } from "./sharedProbes.js";

const guarded: NonNullable<HelpTruthSlice["guarded"]> = {
  "store detail": STORE_DETAIL_FLAG_NAMES,
  "store facets": STORE_FACET_FLAG_NAMES,
  "store query": STORE_QUERY_FLAG_NAMES,
  "store read": STORE_READ_FLAG_NAMES,
  "store cite": STORE_CITE_FLAG_NAMES,
  "store hits": ["--term", "--shape", "--source", "--limit", "--offset", "--include-bots", "--exclude-bots", "--json"],
  "store peek": ["--id", "--match", "--chars", "--source", "--json"],
  "store around": ["--id", "--mode", "--before", "--after", "--chars", "--json"],
};

const probes: NonNullable<HelpTruthSlice["probes"]> = {
  "store query": {
    "--contains": ["--contains", "17000"],
    "--like": ["--like", "%staging%"],
    "--assignee": ["--assignee", "someone", "--source", "linear"],
    "--author": ["--author", "a"],
    "--channel": ["--channel", "C1", "--source", "slack"],
    "--container": ["--container", "slack/c-one"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "message"],
    "--limit": ["--limit", "10"],
    "--offset": ["--offset", "0"],
    "--repo": ["--repo", "owner/name", "--source", "github"],
    "--state": ["--state", "open", "--source", "github"],
    "--team": ["--team", "TEAM", "--source", "linear"],
    "--thread": ["--thread", "C1:1000000000.000001", "--source", "slack"],
    "--search": ["--search", "text"],
    "--since": ["--since", "2026-09-01T00:00:00Z"],
    "--source": ["--source", "slack"],
    "--until": ["--until", "2026-09-08T00:00:00Z"],
    "--visibility": ["--visibility", "public"],
    "--person": ["--person", "someone"],
  },
  "store facets": {
    "--contains": ["--contains", "17000"],
    "--like": ["--like", "%staging%"],
    "--assignee": ["--assignee", "someone", "--source", "linear"],
    "--author": ["--author", "a"],
    "--home": ["--home", "/tmp"],
    "--person": ["--person", "someone"],
    "--channel": ["--channel", "C1", "--source", "slack"],
    "--container": ["--container", "slack/c-one"],
    "--json": ["--json"],
    "--kind": ["--kind", "message"],
    "--limit": ["--limit", "10"],
    "--offset": ["--offset", "0"],
    "--search": ["--search", "text"],
    "--since": ["--since", "2026-09-01T00:00:00Z"],
    "--source": ["--source", "slack"],
    "--until": ["--until", "2026-09-08T00:00:00Z"],
    "--visibility": ["--visibility", "public"],
    "--facet": ["--facet", "container"],
    "--repo": ["--repo", "owner/name", "--source", "github"],
    "--state": ["--state", "open", "--source", "github"],
    "--team": ["--team", "TEAM", "--source", "linear"],
    "--thread": ["--thread", "C1:1000000000.000001", "--source", "slack"],
  },
  "store detail": {
    "--home": ["--home", "/tmp"],
    "--id": ["--id", "c-one:1.2"],
    "--json": ["--json"],
    "--source": ["--source", "slack"],
  },
  "store hits": {
    "--exclude-bots": ["--exclude-bots"],
    "--include-bots": ["--include-bots"],
    "--json": ["--json"],
    "--limit": ["--limit", "25"],
    "--offset": ["--offset", "0"],
    "--shape": ["--shape", "exact"],
    "--source": ["--source", "slack"],
    "--term": ["--term", "barten"],
  },
  "store peek": {
    "--chars": ["--chars", "320"],
    "--id": ["--id", "a71ce9c5-f59a-45d7-b28c-3d31ff21b12a"],
    "--json": ["--json"],
    "--match": ["--match", "17000"],
    "--source": ["--source", "datadog"],
  },
  "store around": {
    "--after": ["--after", "5"],
    "--before": ["--before", "5"],
    "--chars": ["--chars", "320"],
    "--id": ["--id", "a71ce9c5-f59a-45d7-b28c-3d31ff21b12a"],
    "--json": ["--json"],
    "--mode": ["--mode", "conversation"],
  },
  "store cite": {
    "--contains": ["a question", "--contains", "17000"],
    "--like": ["a question", "--like", "%staging%"],
    "--assignee": ["--assignee", "someone", "--source", "linear"],
    "--author": ["--author", "a"],
    "--channel": ["--channel", "C1", "--source", "slack"],
    "--container": ["--container", "slack/c-one"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "message"],
    "--limit": ["--limit", "10"],
    "--person": ["--person", "someone"],
    "--repo": ["--repo", "owner/name", "--source", "github"],
    "--search": ["--search", "text"],
    "--since": ["--since", "2026-09-01T00:00:00Z"],
    "--source": ["--source", "slack"],
    "--state": ["--state", "open", "--source", "github"],
    "--team": ["--team", "TEAM", "--source", "linear"],
    "--thread": ["--thread", "C1:1000000000.000001", "--source", "slack"],
    "--until": ["--until", "2026-09-08T00:00:00Z"],
    "--visibility": ["--visibility", "public"],
  },
  "store read": {
    "--contains": ["a question", "--contains", "17000"],
    "--like": ["a question", "--like", "%staging%"],
    "--assignee": ["--assignee", "someone", "--source", "linear"],
    "--author": ["--author", "a"],
    "--channel": ["--channel", "C1", "--source", "slack"],
    "--container": ["--container", "slack/c-one"],
    "--home": ["--home", "/tmp"],
    "--json": ["--json"],
    "--kind": ["--kind", "message"],
    "--limit": ["--limit", "10"],
    "--person": ["--person", "someone"],
    "--repo": ["--repo", "owner/name", "--source", "github"],
    "--search": ["--search", "text"],
    "--shard-chars": ["--shard-chars", "1000"],
    "--since": ["--since", "2026-09-01T00:00:00Z"],
    "--source": ["--source", "slack"],
    "--state": ["--state", "open", "--source", "github"],
    "--team": ["--team", "TEAM", "--source", "linear"],
    "--thread": ["--thread", "C1:1000000000.000001", "--source", "slack"],
    "--until": ["--until", "2026-09-08T00:00:00Z"],
    "--visibility": ["--visibility", "public"],
  },
};

const parsers: NonNullable<HelpTruthSlice["parsers"]> = {
  "store detail": ({ fragment }) =>
    parseStoreDetailArgs({ rest: dedupeFlags({ base: ["--source", "slack", "--id", "c-one:1.2"], fragment }) }),
  "store facets": ({ fragment }) =>
    parseStoreFacetArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store query": ({ fragment }) =>
    parseStoreReadArgs({ rest: [...fragment] }).mapErr((error) => storeCommandErrorLines({ error })),
  "store read": ({ fragment }) =>
    parseStoreQuestionArgs({ defaultLimit: 12, rest: ["a question", ...fragment], spec: STORE_READ_FLAG_SPEC }).mapErr(
      (error) => storeCommandErrorLines({ error }),
    ),
  "store cite": ({ fragment }) =>
    parseStoreQuestionArgs({ defaultLimit: 12, rest: ["a question", ...fragment], spec: STORE_CITE_FLAG_SPEC }).mapErr(
      (error) => storeCommandErrorLines({ error }),
    ),
  "store hits": ({ fragment }) =>
    parseHitsArgs({ rest: [...dedupeFlags({ base: ["--term", "barten", "--shape", "exact"], fragment })] }).mapErr(
      (error) => storeCommandErrorLines({ error }),
    ),
  "store peek": ({ fragment }) =>
    parsePeekArgs({ rest: [...dedupeFlags({ base: ["--id", "a71ce9c5"], fragment })] }).mapErr((error) =>
      storeCommandErrorLines({ error }),
    ),
  // `around` resolves its `--id` before it queries, so the base anchor has to be a whole address rather
  // than the id fragment the other three take — see `store/slackIds.ts` for the grammar it accepts.
  "store around": ({ fragment }) =>
    parseAroundArgs({
      rest: [...dedupeFlags({ base: ["--id", "a71ce9c5-f59a-45d7-b28c-3d31ff21b12a"], fragment })],
    }).mapErr((error) => storeCommandErrorLines({ error })),
};

/** The rows for `store`'s read verbs. */
export const storeReadsSlice: HelpTruthSlice = { guarded, probes, parsers };
