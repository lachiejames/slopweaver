/**
 * Lazy manifest for the `knowledge` noun — the knowledge register: what an investigation LEARNED, as
 * opposed to what it read (the corpus), what exists (an atlas), or what we always do (canon).
 *
 * `effect: "local-state"`: every write lands in the `memories` table, which is a Postgres on this machine,
 * so nothing external and no model. The register replaces the
 * append-only `$SLOPWEAVER_HOME/knowledge/lessons.jsonl`, which is history that `import-lessons` brings in
 * and this verb surface no longer writes — an older checkout's own CLI still can, see
 * `../commands/knowledge/record.ts` § "The file is still appended, from outside this tree". It is ONE
 * register with `domain` as a facet and one `learner` facet, so a row can be the owner's and not only the
 * fleet's.
 */
import { lazy, type VerbManifestEntry } from "../manifest.js";

const sharedMeta = {
  createsWorkItem: false,
  diagnostic: false,
  doorRouted: false,
  dryParseSafe: true,
  effect: "local-state",
  parseRejectIsIoFree: true,
} as const;

/** The `knowledge` noun's verbs as lazy manifest entries. */
export const knowledgeManifest: Readonly<Record<string, VerbManifestEntry>> = {
  answer: lazy({
    load: () => import("../commands/knowledge/answer.js").then((m) => m.knowledgeAnswerCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver knowledge answer p-0123456789abcdef --mark partly --why "right idea, wrong pool — it is ' +
        'staging that exhausts, not prod" --correction "the staging connection pool exhausts under a backfill"',
      summary:
        "Record what the owner said about one proposed belief — right, wrong or partly, in their own words. Their " +
        "REACTION, never a verdict, and it writes no register row on its own",
      usage:
        "usage: slopweaver knowledge answer <proposal-id> --mark right|wrong|partly --why <text> " +
        "[--correction <text>] [--run <slug>] [--home <dir>] [--json]",
    },
  }),
  detect: lazy({
    load: () => import("../commands/knowledge/detect.js").then((m) => m.knowledgeDetectCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver knowledge detect "investigate why the staging pool exhausts" --term staging --term pool --term k6',
      summary:
        "Plan a RECALL WAVE — how many Haiku detectives read the register for this task, what each opens on, " +
        "and the brief each is handed. It counts and writes; the visible session spawns the sub-agents",
      usage:
        "usage: slopweaver knowledge detect <the task> --term <word> [--term <word> ...] [--slots <n>] " +
        "[--ask <channel>/<messageTs> | --out <dir>] [--json]",
    },
  }),
  domains: lazy({
    load: () => import("../commands/knowledge/domains.js").then((m) => m.knowledgeDomainsCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge domains --migrate",
      summary:
        "Print the closed domain vocabulary a row may name, this install's own from its store included — " +
        "or, with --migrate, fold every stored row still under a retired alias onto its canonical domain (a dry " +
        "run unless --apply), or, with add, add one of this install's own domains and its aliases",
      usage:
        "usage: slopweaver knowledge domains [--migrate [--apply]] [--home <dir>] [--json]\n" +
        "       slopweaver knowledge domains add --slug <slug> --holds <what it holds> [--alias <from>=<to> ...] [--home <dir>] [--json]",
    },
  }),
  export: lazy({
    load: () => import("../commands/knowledge/exportMemories.js").then((m) => m.knowledgeExportCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge export --out ~/.slopweaver/knowledge/memories-export.jsonl",
      summary:
        "Write every recording back out as one .jsonl — the recovery leg, because a paid-for observation " +
        "cannot be fetched again from a provider the way content can",
      usage: "usage: slopweaver knowledge export --out <path> [--json]",
    },
  }),
  "import-lessons": lazy({
    load: () => import("../commands/knowledge/importLessons.js").then((m) => m.knowledgeImportLessonsCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge import-lessons --file ~/.slopweaver/knowledge/lessons.jsonl --dry-run",
      summary:
        "Bring the append-only lessons.jsonl register into the memories table — keyed by each LINE's own " +
        "digest, so a file that has GROWN imports only what was appended and an unchanged one is a no-op",
      usage:
        "usage: slopweaver knowledge import-lessons --file <absolute path> (--dry-run | --apply | --rekey) " +
        "[--home <dir>] [--json]",
    },
  }),
  list: lazy({
    load: () => import("../commands/knowledge/list.js").then((m) => m.knowledgeListCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge list --domain datadog --tier 1",
      summary:
        "Read the register back, filtered by domain, tier, verdict, surface, learner or run — or `--repeats` " +
        "for what more than one run has now learned independently, which is the signal to make it a rule",
      usage:
        "usage: slopweaver knowledge list [--domain <slug>] [--verdict <v>] [--tier 1|2|3|4] " +
        "[--surface <s>] [--learner fleet|owner] [--run <slug>] [--repeats] [--home <dir>] [--json]",
    },
  }),
  propose: lazy({
    load: () => import("../commands/knowledge/propose.js").then((m) => m.knowledgeProposeCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver knowledge propose --from batch.jsonl --unit u-1a2b --domain corpus " +
        '--claim "gold is being built up as the corpus grows" --quote "do we ever build up that gold" ' +
        "--held stated-uncertain",
      summary:
        "Record what you read out of ONE unit of the owner's speech — a candidate belief with the span of their own " +
        "words it came from, or an explicit nothing with the reason",
      usage:
        "usage: slopweaver knowledge propose --from <batch> --unit <id> [--domain <slug> --claim <text> " +
        "--quote <text> --held stated-uncertain|stated-confident | --none <why>] [--run <slug>] " +
        "[--home <dir>] [--json]",
    },
  }),
  prune: lazy({
    load: () => import("../commands/knowledge/prune.js").then((m) => m.knowledgePruneCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge prune --plan ~/.slopweaver/knowledge/hygiene-29sep.plan.jsonl --apply",
      summary:
        "Apply a hygiene pass the owner approved — retire claims and write their rewrites, archiving every retired " +
        "recording first. A dry run unless --apply; the only verb that removes a row",
      usage: "usage: slopweaver knowledge prune --plan <path> [--apply] [--home <dir>]",
    },
  }),
  quiz: lazy({
    load: () => import("../commands/knowledge/quiz.js").then((m) => m.knowledgeQuizCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge quiz --sweep tick-240-9",
      summary:
        "Cut THIS sweep's one question out of the fleet's own register, or print the one it already cut — " +
        "a mechanical rotation over confirmed and refuted fleet lessons, never a reading",
      usage: "usage: slopweaver knowledge quiz --sweep <tick-id> [--home <dir>] [--json]",
    },
  }),
  "quiz-answer": lazy({
    load: () => import("../commands/knowledge/quizAnswer.js").then((m) => m.knowledgeQuizAnswerCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver knowledge quiz-answer q-0123456789abcdef --answer "only on the read replica"',
      summary:
        "Record what the owner said about this sweep's question. It stores their words and grades nothing — whether " +
        "their answer is right is an assessment `knowledge record --learner owner` makes",
      usage: "usage: slopweaver knowledge quiz-answer <quiz-id> --answer <text> [--run <slug>] [--home <dir>] [--json]",
    },
  }),
  recall: lazy({
    load: () => import("../commands/knowledge/recall.js").then((m) => m.knowledgeRecallCommand),
    meta: {
      ...sharedMeta,
      example: 'slopweaver knowledge recall "datadog sampling retention"',
      summary:
        "Think back — full-text search over the memories table, run EARLY in a task rather than after it has " +
        "gone wrong. Refuses rather than reporting an empty page when the store is unreachable",
      usage:
        "usage: slopweaver knowledge recall <words a task mentions> [--domain <slug>] " +
        "[--kind lesson|preference|trace] [--learner <who>] [--limit <n>] [--offset <n>] [--json]",
    },
  }),
  recalled: lazy({
    load: () => import("../commands/knowledge/recalled.js").then((m) => m.knowledgeRecalledCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver knowledge recalled t-0123456789abcdef --outcome broke --verdict changed --evidence "the k6 probe now returns 4 rows in Linear after the refresh"',
      summary:
        "Account for a memory this session leaned on — held, broke or unchecked — and regrade the claim in " +
        "the same transaction. A recall never deletes; a held claim ranks higher on the next recall page",
      usage:
        "usage: slopweaver knowledge recalled <claim-id> --outcome held|broke|unchecked --evidence <text> " +
        "[--verdict refuted|changed] [--run <slug>] [--json]",
    },
  }),
  record: lazy({
    load: () => import("../commands/knowledge/record.js").then((m) => m.knowledgeRecordCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver knowledge record --domain datadog --claim "a grouped count over an id-like facet truncates" ' +
        '--verdict confirmed --tier 2 --surface api --evidence "5/5 buckets + page.after over 13.4M logs"',
      summary:
        "Record ONE lesson — a claim an investigation paid for, with its verdict, what was measured, and the " +
        "command that settles it again",
      usage:
        "usage: slopweaver knowledge record --domain <slug> --claim <text> --verdict <v> --tier 1|2|3|4 " +
        "--surface <s> --evidence <text> [--learner fleet|owner] [--repro <cmd>] [--caveat <text>] " +
        "[--run <slug>] [--supersedes <claim-id>] [--behaviour-change <text>] [--retrieval-cue <text>] " +
        "[--home <dir>] [--redact] [--json]",
    },
  }),
  redact: lazy({
    load: () => import("../commands/knowledge/redact.js").then((m) => m.knowledgeRedactCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge redact --apply",
      summary:
        "Redact the stored register in place with the codebase's own tooling — the install's replacement map, " +
        "then the committed hashed rules mask what is left. Archives every old row first; a dry run unless --apply",
      usage: "usage: slopweaver knowledge redact [--apply] [--home <dir>] [--json]",
    },
  }),
  "redaction-scan": lazy({
    load: () => import("../commands/knowledge/redact.js").then((m) => m.knowledgeRedactionScanCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge redaction-scan",
      summary:
        "Count the stored rows still carrying a forbidden identifier, by kind and by column — never a value. " +
        "Exits 0 at zero and 1 otherwise",
      usage: "usage: slopweaver knowledge redaction-scan [--home <dir>] [--json]",
    },
  }),
  remember: lazy({
    load: () => import("../commands/knowledge/remember.js").then((m) => m.knowledgeRememberCommand),
    meta: {
      ...sharedMeta,
      example:
        "slopweaver knowledge remember --kind preference --placement retrieved --domain doctrine " +
        '--claim "The owner only speaks to the pinned supervisor chat" --evidence "recorded in the supervisor session" ' +
        '--verdict confirmed --learner owner --behaviour-change "route questions through the supervisor" ' +
        '--retrieval-cue "any task about reaching the owner"',
      summary:
        "Write ONE memory into the RETRIEVED table — a paid-for `lesson` or an owner `preference`. " +
        "`--placement` has no default and every answer but `retrieved` is refused with the real destination",
      usage:
        "usage: slopweaver knowledge remember --kind lesson|preference --placement retrieved --domain <slug> " +
        "--claim <text> --evidence <text> --verdict <v> --learner <who> --behaviour-change <text> " +
        "--retrieval-cue <text> [--tier 1|2|3|4 --surface <s>] [--repro <cmd>] [--caveat <text>] " +
        "[--run <slug>] [--supersedes <claim-id>] [--redact] [--json]",
    },
  }),
  restore: lazy({
    load: () => import("../commands/knowledge/restoreMemories.js").then((m) => m.knowledgeRestoreCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge restore --file ~/.slopweaver/knowledge/memories-export.jsonl",
      summary:
        "Put an export back into an EMPTY memories table, or --merge it into a live one refused whole on any " +
        "clash, identities preserved — the half of a backup that makes it a backup rather than a file",
      usage: "usage: slopweaver knowledge restore --file <path> [--merge] [--redact] [--json]",
    },
  }),
  trace: lazy({
    load: () => import("../commands/knowledge/trace.js").then((m) => m.knowledgeTraceCommand),
    meta: {
      ...sharedMeta,
      example:
        'slopweaver knowledge trace --domain store-detective --question "why did the staging pool exhaust" ' +
        '--probe "slopweaver store probe k6 --source linear" --outcome empty --evidence "exact 0, wild-both 0" ' +
        '--does-not-prove "Linear only; the load-test thread may name it another way"',
      summary:
        "Write ONE trace — where an investigation looked, whether the probe paid or came back empty, and what " +
        "the emptiness does not prove. A remembered dead end reorders the next investigation; it never skips a leg",
      usage:
        "usage: slopweaver knowledge trace --domain <slug> --question <text> --probe <cmd> --outcome paid|empty " +
        "--evidence <text> [--does-not-prove <text>] [--learner fleet|owner] [--run <slug>] [--redact] [--json]",
    },
  }),
  voice: lazy({
    load: () => import("../commands/knowledge/voice.js").then((m) => m.knowledgeVoiceCommand),
    meta: {
      ...sharedMeta,
      example: "slopweaver knowledge voice --batch 3 --out batch.jsonl",
      summary:
        "Hand this session a bounded batch of the owner's own recorded words to read — deduplicated across the tick " +
        "ledger and both turn-file families, with a watermark saying what the scan actually reached",
      usage:
        "usage: slopweaver knowledge voice [--batch <n>] [--source tick-ledger|archive-turn|scratch-turn] " +
        "[--out <path>] [--run <slug>] [--home <dir>] [--json]",
    },
  }),
};
