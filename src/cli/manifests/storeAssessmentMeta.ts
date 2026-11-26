/**
 * The `store` noun's stored-row assessment verbs: the rows the data-class rules send for assessment that the daily
 * visible reader has not classified yet, and its verdicts written down (`src/store/storedRowAssessment.ts`). The
 * call half is `talk assessment-due` and `talk assessment-record`; `store classify` reads what both recorded.
 * Their own module, like `./storeBackfillMeta.ts`, so the noun's manifest stays under the ratchet.
 */
import { STORE_ASSESSMENT_DUE_USAGE, STORE_ASSESSMENT_RECORD_USAGE } from "../commands/store/assessmentUsage.js";
import { lazy, type VerbManifestEntry } from "../manifest.js";

/** `store assessment-due` — the day's slice of stored rows due for a verdict, with their words. */
const assessmentDueMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "none",
  example: "slopweaver store assessment-due --json",
  parseRejectIsIoFree: true,
  summary:
    "The stored rows the data-class rules send for assessment whose current words the daily reader has not classified, newest first and bounded to the day's slice; --check prints counts only and exits deferred while the slice has a row due",
  usage: STORE_ASSESSMENT_DUE_USAGE,
} as const;

/** `store assessment-record` — the daily reader's verdicts on those rows, each checked against the row as it stands. */
const assessmentRecordMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  example: "slopweaver store assessment-record --verdicts-file ./verdicts.json --json",
  parseRejectIsIoFree: true,
  summary:
    "The daily reader writes down its class for each stored row it read, bound to the digest of the words it was shown; a row whose words or rule moved since is refused and named",
  usage: STORE_ASSESSMENT_RECORD_USAGE,
} as const;

/** The two verbs' rows, spread into `./store.ts`'s manifest. */
export const assessmentVerbs: Readonly<Record<string, VerbManifestEntry>> = {
  "assessment-due": lazy({
    load: () => import("../commands/store/assessmentDueRun.js").then((m) => m.storeAssessmentDueCommand),
    meta: assessmentDueMeta,
  }),
  "assessment-record": lazy({
    load: () => import("../commands/store/assessmentRecordRun.js").then((m) => m.storeAssessmentRecordCommand),
    meta: assessmentRecordMeta,
  }),
};
