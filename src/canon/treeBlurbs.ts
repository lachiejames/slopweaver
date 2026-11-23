/**
 * The DECLARED half of the codebase atlas: what each top-level `src/` entry is for, one line each.
 *
 * It sits in its own module because it is a CATALOGUE — one row per tree, and it gains a row every time the
 * repository gains a tree. Left inside `codebaseAtlas.ts` it pushed that file's size around while carrying
 * none of its logic, so the seam here is the honest one: the derived walk is code, this is data.
 */

/** The bucket holding the loose `src/*.ts` files that belong to no subdirectory. */
export const ROOT_TREE = "(root)";

/**
 * What lives in each top-level `src/` entry, in one line.
 *
 * **This is the declared half, and it is gated against the derived half.** A tree added to `src/` with no
 * row here fails `unit/canon/codebaseAtlas.test.ts`, and a row naming a tree that has been renamed or
 * deleted fails the same test. So the two can drift for exactly as long as it takes CI to run — which is
 * the only honest way to carry prose about a tree, since no walk of the filesystem can say what a
 * subsystem is FOR.
 *
 * Each line is drawn from that tree's own file-overview comment rather than invented here. When a tree's
 * purpose moves, the overview is what moves first; this row follows it in the same pull request, under the
 * canon-freshness rule.
 */
export const TREE_BLURBS: Readonly<Record<string, string>> = {
  [ROOT_TREE]: "The loose files at the top of src/: runtime configuration, the home directory, the owner profile.",
  accessReview:
    "The ISO access review: each person's stored access level per platform, joined against the Vanta roster.",
  admit: "The door — every side-effecting action classified, granted or refused, and written to the ledger.",
  alias: "Cloudflare email-routing rules: the organisation-owned mailboxes an assistant plan signs up on.",
  appSurfaces:
    "Where on the app a dependency is reached: an export-level walk of a checkout's import graph up to its routes and entry points.",
  atlas:
    "The per-provider atlases — what exists on a platform, what this account can actually read, and what has never been looked at.",
  audit: "A read-only quality snapshot over the on-disk corpus.",
  autonomy:
    "The graduated-autonomy ledger: one row per act taken without asking, plus the owner's retroactive steer on it.",
  automations:
    "The Automations page's report: every automation and corpus sync as a card, each field read from a store row.",
  briefing: "The fleet briefing — what needs the owner, under caps drawn from measurement rather than taste.",
  browser:
    "Driving the owner's own Chrome through Playwright, one aimed interaction at a time, each with a screenshot.",
  builtCli:
    "The built CLI: the source listing both the emit and the guard read, and the staleness verdict that stops a stale build answering.",
  canon: "The documentation describing this repository, measured against it: budgets, area rules, stale references.",
  capacity:
    "What is unused on every ceiling now: each Claude and Codex plan window and the machine's load, and the lowest one the sweep fills to.",
  checkouts:
    "Keeping a main checkout and its installed tree in agreement, and planning what a repository re-cut repoints.",
  claude: "The Claude hosts — plan gauges, spawn state, and the rate-limit headers an API response carries.",
  cli: "Every verb: commands/<noun>/<verb>.ts, the manifests that load them lazily, and the router.",
  cmux: "The visible session manager — workspaces, pins, each row's title and ref pill, and the notification filter.",
  coderabbit: "The CodeRabbit configuration, checked against its own published JSON Schema.",
  codex: "The pairing loop — a bounded plan, an implementation, and a one-property review of the diff.",
  codexPlugin: "Keeping the Codex install of Slopweaver on the main checkout's commit.",
  connect: "The per-source --check preflight: what is wired, and what a source still needs.",
  consoleProfile:
    "The perf console verb: a launched browser walks every console page and flow and times what the owner would feel.",
  context: "The always-loaded context a session start injects.",
  corpus: "The local world model — bronze ingestion, the record contract, and every provider's fetcher.",
  cycle: "Linear cycle hygiene: what should be closed, and which project update is overdue.",
  datadog: "The one Datadog client, plus its monitors, dashboards and metric submissions.",
  detective:
    "The brief one investigating session is handed — a starting lead and the tool surface, never a conclusion.",
  devGate: "dev gate — the single bar every pull request clears, composed from the checks the foundation owns.",
  desktop:
    "How the desktop app is installed: one copy in Applications, stale builds unregistered, rolled back if it never runs.",
  devLint: "Every house gate yarn lint runs, each with its own declared scan scope and shrinking debt list.",
  environment: "Whether this machine can run Slopweaver: the probes doctor grades and onboarding opens on.",
  eval: "The answer-quality scorer and the graded cases it runs over.",
  events: "The supervisor stream's event model — what a long-running surface publishes about itself.",
  fleet: "Bringing the fleet back after a restart: the offline health read, the recovery journal and its refusals.",
  footprint: "What this install has touched: nodes, a folded ledger, and the brief a visible session groups.",
  freshCut: "One parentless commit over a main commit's tree in a new local repository, and the scan that verifies it.",
  gcloud:
    "The gcloud application default credential: whether it works, and the one sign-in the owner runs when it does not.",
  gcp: "The GCP door: one closed request per operation, a write planned from a fresh read, digest-approved and additive by default.",
  gcpAudit: "A read-only Cloud Audit Logs reader into a local generation, and a least-privilege plan read against it.",
  gold: "Distil — the digest contract, its output schema, and the fingerprint a composed digest folds into.",
  goldDebt: "What gold still owes: one row per debt, and what settling one is.",
  grants: "Journalled grants — a decision the owner already made, carried in a form the performing session can check.",
  hand: "The hand-step register: the one step only the owner's hands can take, drawn as a floating note on their screen.",
  handover: "The orchestration board and the run journal — what is in flight, on what, and how a run ends.",
  hatch: "The escape-hatch registry, and the four lines every policy refusal is rendered in.",
  hex: "Reading the warehouse — one typed GET per thing an investigation asks Hex.",
  home: "Taking the obviously-junk bytes out of $SLOPWEAVER_HOME: one allowlisted root, one class, never by age or by content.",
  hygiene: "The public hygiene gate: every leak class printed, a credential class exiting non-zero.",
  incident: "A live incident noticed as a board row, and the one floating note its investigation ends in.",
  init: "Idempotent scaffolding of $SLOPWEAVER_HOME.",
  integrations: "The integration registry: one manifest per external system, every integration list derived from it.",
  judgement: "Mining judgement from a bounded scan of source trees outside the corpus.",
  knowledge: "The global knowledge register — what an investigation learned, by facet, each row carrying its verdict.",
  lib: "The shared floor: Result, safe JSON, dates, atomic writes, git — reached as #lib/….",
  live: "Reading the world as it is NOW, and running one bot turn over it.",
  measurement: "Measuring the whole board once, so every consumer reads the same computation.",
  memory: "The Claude auto-memory corpora, and the standing hygiene pass that proposes and never deletes.",
  monitor: "The local Datadog — named conditions over this machine's own ledgers, each firing a card.",
  onboard: "The cold-start plan: which refresh each source needs, and in what order.",
  onboardEval: "The delta between two onboarding friction reports — a regression in the onboarding, made visible.",
  organisation:
    "The organisation this install works for: one store row written by org set, read through one function that refuses when it is absent.",
  orgHealth: "The organisation's incidents, read off incident.io's Slack announcements into one status-page snapshot.",
  outbound: "Every closed form the fleet sends through, provider-agnostic before it becomes a platform's shape.",
  pages: "A local page's identity — the slug inside a file:///…/pages/<slug>/index.html address.",
  pane: "The console's transport: server-sent events, so the page can stop asking.",
  pdf: "One PDF extractor every door reaches: the bytes decide, a document with no text layer says so, and nothing here reads pixels.",
  policy:
    "Vanta policy and evidence documents — rendered to a verified PDF, and a change drawn as an HTML review page.",
  perf: "What dev profile measures: a subject to spawn, V8's own profile documents folded by module, and the recorded baseline a run is judged against.",
  plans:
    "The one register of destinations a seat can spend against — both providers' plans, an alias each, and what one change makes of it.",
  prformat: "The pull-request description format gate.",
  profile:
    "The owner's own words as one source: call, console and supervisor-chair turns, each timestamped, spoken or written, and anchored.",
  proof: "Capturing a proof witness: the tape that drives one recording, and the settled frame it produced.",
  proofPath:
    "Keeping proof out of pull requests: which paths count as proof output, and where a capture may be written.",
  protectedPaths:
    "The owner's protected paths, named in the state home and never the code: the registry, its edits, and what each mode refuses.",
  queueDefer:
    "The Queue cards the owner put off with Come back to it — one press per line, folded into the order the Queue draws.",
  queueRefusals:
    "The Queue cards a gate held off the owner's Queue, read from the console for the chair so each reaches a fixing seat.",
  queueStopping:
    "The cards stopping the owner's work that the Queue leads with, read from the console so the chair's update opens on them.",
  readings: "The readings ledger: the last --json document each slow verb printed, who took it and when it was true.",
  reflect: "The reflection loop's miner — ranking, dedup and the cap over what a lap found.",
  retrieval: "The fan-out reader: a question and its candidates in, a parallel read plan out.",
  review:
    "The review-chase vocabulary — review state, the landing verdict, who each pull request is on the hook with, and a suggested reviewer.",
  route: "The host-neutral description of the sources a visible supervisor consults before answering.",
  ruling:
    "The owner's standing rulings by category, in the owner's own words: the append-only register, its seed from the state documents, and its one page.",
  secrets: "The connector-secret name allowlist, and the store behind secrets set.",
  sessionHarness: "The session harness — the one seam every verb reaches a session through, cmux behind it.",
  sessionStart: "The session-start list — what a fresh chat is handed before it reads a line of code.",
  sessions: "The session ledger a supervisor chat keeps of the chats it knows about.",
  silver: "The deterministic derivation — the directory, the cross-ref graph and the opportunities.",
  spend:
    "The AI card's spend register: a pasted card page parsed, stored, and read for headroom and declines, its merchants grouped by the install's register.",
  stateHome:
    "The state-home contract's areas: one $SLOPWEAVER_HOME path module per area, composed by stateHome.ts alone.",
  store: "The drizzle store: the identity register, the owner's own table, and the voice register.",
  supervisor: "The chair — coverage of the owner's kept outcomes, intake routing, and what it owes each workstream.",
  sweep: "The sweep ledger: what stops earning its keep, and the evidence that says so.",
  syncRun: "The sync-run ledger: one run file per source each refresh fetches, folded into measured progress and rate.",
  talk: "The console voice's half: the ChatGPT-plan call composition, the bounded checkout and board reads, and the relay of the owner's steer.",
  testLanes:
    "How a test lane is split across CI runners and merged back into one lane, refusing a merge that is not exactly the lane.",
  transcripts: "The structured questions a transcript answers about itself.",
  value:
    "The weekly value sample: five asks that ended, drawn at random with their cost and outcome, and the owner's answer on each.",
  velocity: "The pace measurements: merges, doc latency, and turns per ask.",
  visualEvidence: "Image evidence — what a session recorded about a picture, keyed by the picture's own bytes.",
  wait: "The one wait contract: read on a stepped backoff until it settles, printing only what changed.",
  waiting:
    "The one ranking of what waits on the owner: a colleague's blocked work first, check-ins last, behind any band a caller lifts.",
  workstreams:
    "The owner's outcomes register: each workstream's bar derived from a cited timeline, raised to loop closed.",
  worktree: "What a worktree's node_modules is, what it should be, and whether the two agree.",
};
