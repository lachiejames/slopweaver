/**
 * What `slopweaver handover register` and `slopweaver handover settle` ACCEPT — the two flag specs, the two
 * usage blocks, the parsers `helpTruth.test.ts` drives to prove the printed help matches them, and the two
 * readers `registerPlan` takes a parsed flag through.
 *
 * Split out of {@link ./askRowRun.js} (the file-size ratchet, step 4), which now holds only what `register`
 * DOES with a parse; `settle`'s half is {@link ./settleRowRun.js}. The flag-name exports exist so the
 * help-truth test can compare the printed usage against the spec rather than against a second list somebody
 * maintains by hand.
 */
import { parseAskOptions } from "../../../handover/askShape.js";
import { askShapeVerdict } from "../../../handover/askShapeGate.js";
import { err } from "../../../lib/result.js";
import { type FlagSpec, parseFlags } from "../../parseFlags.js";

/**
 * One optional string flag, or undefined when it was not typed.
 *
 * Every optional flag on this verb reads the same way, so the ternary lives once: eight copies of it put
 * `registerPlan` over the branch ceiling for a reason that was never about its logic.
 *
 * @param values the parsed flag values
 * @param name the flag's name, without the dashes
 * @returns the typed value, or undefined
 */
export function optionalString({
  values,
  name,
}: {
  values: Readonly<Record<string, unknown>>;
  name: string;
}): string | undefined {
  const raw = values[name];
  return typeof raw === "string" ? raw : undefined;
}

/**
 * The shape the three flags carry, as a verdict — or the refusal to print instead.
 *
 * Its own function so `registerPlan` stays under the length cap, and because the two steps are genuinely
 * separate: `--options` is one newline-separated flag that has to be PARSED before anything can judge it,
 * and a parse failure is reported ahead of any cap so the caller fixes the spelling first.
 *
 * @param values the parsed flag values
 * @param env the environment the hatch is read from
 * @param required false for a row where the owner has nothing to pick — a `--finding` row's own observation, or a
 *   `--dispatch` row's work for a seat
 * @returns the verdict, carrying either the shape to write or the whole lines to print
 */
export function shapeVerdictFor({
  values,
  env,
  required,
}: {
  values: Readonly<Record<string, unknown>>;
  env: NodeJS.ProcessEnv;
  required: boolean;
}): ReturnType<typeof askShapeVerdict> {
  const rawOptions = optionalString({ name: "options", values });
  const parsed = rawOptions === undefined ? { options: [], problems: [] } : parseAskOptions({ text: rawOptions });
  return askShapeVerdict({
    command: "slopweaver handover register",
    env,
    blastRadius: optionalString({ name: "blast-radius", values }),
    lean: optionalString({ name: "lean", values }),
    options: parsed.options,
    parseProblems: parsed.problems,
    problem: optionalString({ name: "problem", values }),
    required,
    risk: optionalString({ name: "risk", values }),
    stillReal: optionalString({ name: "still-real", values }),
  });
}

/** The flags `handover register` accepts. */
const REGISTER_FLAGS = {
  // `keep-lines`: a dispatch brief whose LINES are read back by code (`vulnerability-fix topup`'s batch), so register
  // stores it as written instead of flattening it for a card it never heads.
  // `full`: print where the row was written and how to settle it under the receipt (`./registerReceipt.ts`).
  boolean: ["finding", "dispatch", "keep-lines", "full"],
  // Related asks fold onto one card as up to three numbered scenes, read in order by
  // `./askExampleFlags.ts` off the argv tail.
  repeatable: ["example"],
  string: [
    "ask",
    "anchor",
    "asked-iso",
    "asked-ts",
    "priority",
    "slug",
    "repo",
    "dir",
    "home",
    "evidence",
    "branch",
    "observed-by",
    // The SHAPE required of an ask that waits on the owner's word. `--options` is one
    // flag holding one option per LINE: `../../parseFlags.ts` keeps values in a `Record<string, string |
    // boolean>` so a flag is not repeatable, and the `--evidence` comma idiom cannot carry text with commas
    // in it, which an option sentence and its trade-off both have.
    "problem",
    "options",
    "lean",
    // The STAKES: what the owner wants to know at a glance when reacting — `askShape.ts`'s header.
    "risk",
    "blast-radius",
    "still-real",
    // How the owner's quoted words bear on the question — the one line the Queue card draws above the folded words.
    "bears-on",
    // The concrete scene the card leads with, or the one line saying why the row cannot support a truthful one
    // — `../../../handover/askExamples.ts`.
    "example",
    "example-gap",
    // Typed tags the row carries from the moment it lands — `handover tag`'s grammar, comma-separated because a
    // flag is not repeatable and no tag value may hold a comma (`../../../handover/rowTags.ts`).
    "tag",
    "new-value",
    // Whose work the row is, stated as it lands (`../../../handover/workspace.ts`) — `repo:` is only the checkout a
    // seat runs in, so a row registered without one reaches the self Queue view, marked placed by default.
    "workspace",
    "workspace-because",
  ],
} satisfies FlagSpec;

/** The flags `handover settle` accepts. */
const SETTLE_FLAGS = {
  boolean: [],
  string: ["as", "witness", "reason", "dir", "home", "lessons", "card", "card-why", "card-new"],
} satisfies FlagSpec;

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_REGISTER_FLAG_NAMES: readonly string[] = [...REGISTER_FLAGS.string, ...REGISTER_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** `--`-prefixed, for the help-truth ratchet. */
export const HANDOVER_SETTLE_FLAG_NAMES: readonly string[] = [...SETTLE_FLAGS.string, ...SETTLE_FLAGS.boolean]
  .map((name) => `--${name}`)
  .toSorted();

/** The six flags that spell a decision waiting on the owner's word — `../../../handover/askShape.ts`. */
const SHAPE_FLAG_NAMES: readonly string[] = ["problem", "options", "lean", "risk", "blast-radius", "still-real"];

/**
 * Every way `--dispatch` contradicts another flag on the same invocation, empty when it does not.
 *
 * `--dispatch` DECLARES that this row asks the owner to pick nothing, so it is refused beside anything saying the
 * opposite. Both refusals are failures of FACT — the flags were used wrongly — so neither carries the
 * `unshaped-ask` hatch and neither can be opened by one
 * (`.claude/rules/error-handling.md` § "A POLICY refusal is not a domain error").
 *
 * Presence is read off the SUPPLIED flag rather than off `shapeCompleteness`, which collapses an empty
 * string into absence: `--dispatch --problem ""` is a caller contradicting itself rather than one passing
 * nothing, and it should be told so instead of quietly accepted.
 *
 * @param values the parsed flag values
 * @returns one sentence per contradiction, in the order they should print
 */
export function dispatchConflicts({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): readonly string[] {
  if (values["dispatch"] !== true) {
    // Every other row can reach the owner's Queue, whose heading reads the ask as one line.
    return values["keep-lines"] === true
      ? ["--keep-lines is only for a --dispatch row, which heads no card of the owner's. Drop it, or pass --dispatch"]
      : [];
  }
  const problems: string[] = [];
  if (values["finding"] === true) {
    problems.push(
      "--dispatch and --finding declare different rows: a dispatch row is work a seat picks up, a finding " +
        "carries a session's own observation and a team-facing door holds on it. Pass one of them",
    );
  }
  const supplied = [...SHAPE_FLAG_NAMES, "bears-on", "example", "example-gap"]
    .filter((name) => values[name] !== undefined)
    .map((name) => `--${name}`);
  if (supplied.length > 0) {
    problems.push(
      `--dispatch says nothing on this row waits on the owner's word, so ${supplied.join(", ")} cannot be on it — ` +
        "drop --dispatch if this IS a decision of the owner's, or drop the shape if it is not",
    );
  }
  return problems;
}

/**
 * The flags `./askRowText.ts` writes into front-matter RAW, unquoted — so a newline in one is a new KEY.
 *
 * Deliberately a list of the raw ones rather than every string flag: `--options` carries newlines by
 * construction, and `--ask`, `--problem` and `--lean` reach the file through `JSON.stringify`, which already
 * escapes one. These are the set the writer interpolates directly.
 */
const RAW_FRONTMATTER_FLAG_NAMES: readonly string[] = [
  "slug",
  "asked-iso",
  "anchor",
  "priority",
  "repo",
  "branch",
  "evidence",
  "observed-by",
  "workspace",
];

/**
 * Every raw front-matter flag whose value carries a newline, empty when none does.
 *
 * This is the FLAG half of the front-matter-injection class, and it is the smaller half on purpose. The
 * structural half is `encodeFlatScalar` (`../../../handover/flatScalarCodec.ts`), which quotes such a value so a
 * second line can never become a KEY whatever source it came from — an argv, the session id in the environment,
 * or a field added later. Both were found by this change's own r1 review, each with a counterexample that ran.
 *
 * This one earns its place anyway, because quoting the value makes the row SAFE without making it right:
 * none of these fields has a legitimate multi-line value, so a newline in one is always a caller mistake,
 * and the reader decodes it faithfully back into a branch the finding gate can never match. Naming the
 * flag is the useful answer; the writer is what makes the unnameable case harmless.
 *
 * @param values the parsed flag values
 * @returns one sentence per offending flag, in the order they are written
 */
export function multilineRawFields({
  values,
}: {
  values: Readonly<Record<string, string | boolean>>;
}): readonly string[] {
  return RAW_FRONTMATTER_FLAG_NAMES.filter((name) => {
    const value = values[name];
    return typeof value === "string" && value.includes("\n");
  }).map(
    (name) =>
      `--${name} carries a newline, and no field in a row's front-matter has a legitimate multi-line ` +
      "value. The writer quotes it rather than letting a second line become a KEY, so what would reach the " +
      "board is a multi-line value no exact match can ever hit. It is one value on one line",
  );
}

/**
 * Parse `handover register`'s own flags — exported for the help-truth ratchet.
 *
 * Both semantic checks run HERE rather than in `./askRowRun.ts`, so a contradictory or injecting invocation
 * is refused before the plan reads a transcript off the disk or touches the handovers directory.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverRegisterArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  const parsed = parseFlags({ args: rest, spec: REGISTER_FLAGS });
  if (parsed.isErr()) {
    return parsed;
  }
  const problems = [
    ...multilineRawFields({ values: parsed.value.values }),
    ...dispatchConflicts({ values: parsed.value.values }),
  ];
  if (problems.length > 0) {
    return err(problems);
  }
  return parsed;
}

/**
 * Parse `handover settle`'s own flags — exported for the help-truth ratchet. Positionals are allowed because
 * the slug is one.
 *
 * @param rest the argv after the verb
 * @returns the parsed flags, or the parser's own refusals
 */
export function parseHandoverSettleArgs({ rest }: { rest: readonly string[] }): ReturnType<typeof parseFlags> {
  return parseFlags({ allowPositionals: true, args: rest, spec: SETTLE_FLAGS });
}

export const REGISTER_USAGE =
  "usage: slopweaver handover register --ask <text> --problem <line> --options <lines> --lean <line>\n" +
  "         --risk <line> --blast-radius <line> --still-real <line>\n" +
  "         (--example <scene> [--example <scene> ...] | --example-gap <line>)\n" +
  "         [--anchor <link>] [--asked-ts <slack ts> | --asked-iso <iso>] " +
  "[--priority p0|p1|p2|p3] [--slug <slug>] [--repo <path|owner/name|name>] [--branch <name>] [--dir <path>]\n" +
  "         [--bears-on <line>] [--tag <key=value>[,...]] [--new-value <key=value>[,...]] [--home <dir>]\n" +
  "         [--workspace team|self --workspace-because <line>] [--full]\n" +
  "       slopweaver handover register --ask <text> --finding --evidence <ref,...> [--observed-by <session>] …\n" +
  "       slopweaver handover register --ask <text> --dispatch [--keep-lines] [--branch <name>] [--repo <path|owner/name|name>] …\n" +
  "\n" +
  "Registers something the owner asked for as a row on the board, ranked above ordinary doc work by\n" +
  "default, before anyone decides what to do about it. Settle it later with `handover settle`.\n" +
  "It prints one receipt line plus any warning that needs your hand; --full adds the doc's path and the\n" +
  "settle command.\n" +
  "\n" +
  "A row that waits on the OWNER's word carries a SHAPE, not a free-text body: a\n" +
  "recorded ask the owner has to parse is a defect. All six fields or none of them; a partial one is refused.\n" +
  "A shaped row waits on the owner as it stands: it reaches their Queue with no run until `handover rule`.\n" +
  "A --finding row is exempt, because a session's own observation asks the owner to pick nothing. So is a\n" +
  "--dispatch row, which is work for a seat rather than a question.\n" +
  "\n" +
  "  --problem <line>  one line: what is actually wrong or undecided\n" +
  "  --options <lines> 2 to 4 LINES, each `<what the owner could do> :: <what that costs>`. One flag holding\n" +
  "                    newline-separated lines, because an option's own text contains commas. An option the\n" +
  "                    owner takes at a terminal (a sign-in, a secret, an approval) adds a third part, the\n" +
  "                    exact command: `<option> :: <cost> :: <command>` — refused without it\n" +
  "  --lean <line>     one line: what the owner would most likely pick with infinite time and attention. This is\n" +
  "                    the SESSION's recommendation in the owner's voice, never a claim that the owner said it\n" +
  "  --risk <line>     one line: what goes wrong if the owner picks badly, or says nothing\n" +
  "  --blast-radius <line>  one line: who and what the decision reaches\n" +
  "  --still-real <line>    one line: how the problem was confirmed to still stand. The card prints how\n" +
  "                    long ago that was, off the instant this verb records it — never a typed date\n" +
  "  --bears-on <line> one line: how the owner's quoted words bear on the question — why the card is in front of\n" +
  "                    the owner, drawn after every quote. Refused on a row whose --anchor quotes nothing\n" +
  "  --example <scene> a second-person scene the owner can picture — what you were doing, what appeared, what the\n" +
  "                    fleet did — ending on the question the card is really asking. Up to three, for\n" +
  "                    related asks folded onto one card. Required on every row that heads the owner's card\n" +
  "  --example-gap <line>  instead of --example: one line saying why the row cannot support a truthful scene\n" +
  "\n" +
  "  --asked-ts <ts>   a Slack `ts`; this verb DERIVES the instant, so nobody converts one by hand\n" +
  "  --asked-iso <iso> the instant directly, REFUSED unless it parses — prefer --asked-ts, or let a\n" +
  "                    Slack --anchor supply it, because a hand-typed instant was once 80 minutes out\n" +
  "  --anchor <link>   a Slack permalink, or transcript:<sessionId>#<turnUuid> for a turn typed into the\n" +
  "                    supervisor (`slopweaver supervisor intake` prints them) — the instant is read off the\n" +
  "                    turn itself, and a pointer naming no turn in that transcript is refused\n" +
  "  --finding         this row comes from something a SESSION observed, not from the owner. It still ranks as\n" +
  "                    an ask, but carries its origin, and a team-facing door (a pull request on a\n" +
  "                    team-reviewed base, a review ask) refuses it until `handover rule` records the owner's word\n" +
  "  --dispatch        this row is WORK a seat picks up — an already-team-facing pull request of the owner's that\n" +
  "                    needs a rebase, red CI cleared or review threads answered — so it waits on nobody's\n" +
  "                    word and carries no shape. It is NOT a finding: no team-facing door holds on it.\n" +
  "                    Refused beside --finding or any of the six shape flags\n" +
  "  --keep-lines      with --dispatch only: store the ask's line breaks instead of flattening it to one\n" +
  "                    line, for a brief whose lines code reads back (`vulnerability-fix topup`'s batch)\n" +
  "  --evidence <ref,...>   what was observed — PR refs, permalinks, log lines. Required with --finding\n" +
  "  --observed-by <session> the observing session; defaults to this session's own id\n" +
  "  --branch <name>   the head branch this row is about, declared rather than inferred. It is what joins\n" +
  "                    the row to an open pull request on the landing read, and what a team-facing door\n" +
  "                    matches a --finding row by — name similarity is never used for either\n" +
  "  --repo <path>     the main checkout a seat's worktree is cut from: the top of a main checkout, a\n" +
  "                    declared checkout's owner/name, or its bare repository name. The row records the\n" +
  "                    absolute top, and a value that resolves to none is refused before anything is\n" +
  "                    written. A row without one cannot be seated by `cmux spawn`, so the reconciliation\n" +
  "                    holds it rather than calling it ready until `handover set-repo` gives it one\n" +
  "  --tag <k=v,...>   typed tags the row carries from the moment it lands, as `handover tag` writes them.\n" +
  "                    Refused beside --dir: a journal belongs to the home board\n" +
  "  --new-value <k=v,...>  acknowledges a workstream no row carries yet, which is otherwise refused as a typo\n" +
  "  --workspace <w>   whose work the row is: team (the organisation's) or self (this instance's own). The\n" +
  "                    console places a row by this, never by --repo, so a row with no workspace, pull\n" +
  "                    request or Slack destination shows in the self Queue view only, placed by default.\n" +
  "                    A verb that registers rows passes one when the row's own source says whose work it\n" +
  "                    is, and none otherwise; `handover set-workspace` places a row registered without one\n" +
  "  --workspace-because <line>  required with --workspace: why, written beside it as workspaceBecause:\n" +
  "\n" +
  'example: slopweaver handover register --ask "Should listen status count every stuck chat?" --anchor <slack permalink>\n' +
  'example: slopweaver handover register --ask "watchPr.sh dies silent on SIGUSR1" --finding ' +
  "--evidence owner/repo#<n>,owner/repo#<m>";

export const SETTLE_USAGE =
  "usage: slopweaver handover settle <slug> --as filed|answered|declined --witness <value> " +
  "[--reason <text>] [--lessons none]\n" +
  "         [--card done|recut|kept [--card-why <reason>] [--card-new <step id>]] [--dir <path>] [--home <dir>]\n" +
  "\n" +
  "Ends an ask row. `filed` names the doc slug it became and the board checks that doc exists;\n" +
  "`answered` names the permalink it was answered at; `declined` is the owner's alone and needs both a\n" +
  "reason in the owner's words and an anchor pointing at where they gave it.\n" +
  "\n" +
  "An `answered` witness that is a bare pull request URL, on a row whose stored words ask for proof\n" +
  "(screenshots, run links, a Datadog view), reads that body live first: it refuses naming each item\n" +
  "the body lacks, and its receipt names the runs and links it found.\n" +
  "\n" +
  "A row a talk relay registered while the owner had a HAND card open (`about: hand:<id>`) must also say what\n" +
  "happens to that card, because answering is not always finishing. The settle performs it BEFORE it\n" +
  "writes the row, so a retry after a failure converges:\n" +
  "  --card done        the card is finished: it is settled, naming this row and its witness\n" +
  "  --card kept        it stays on the owner's queue; --card-why <reason> says why, on the card and on this row\n" +
  "  --card recut       it was already re-cut with `hand post --supersedes`; --card-new <step id> names\n" +
  "                     the posting that replaced it, and the settle checks that it did\n" +
  "Every other row — no relay, no card, another kind of card, a hand card closed any other way — takes\n" +
  "no --card, and one passed there is refused.\n" +
  "\n" +
  "A row whose run was STARTED must also say whether it learned anything: record a lesson with\n" +
  "`slopweaver knowledge record --run <slug>`, or pass `--lessons none`, which is a recorded answer\n" +
  "rather than a bypass. A row that was never started is not asked.\n" +
  "\n" +
  "This ends the ask ROW and NOT the run. `slopweaver handover finish <slug>` is what ends a run, and\n" +
  "until it has, `slopweaver session close-done` cannot reap the workspace — so a settle over an open\n" +
  "run names the verb that finishes it.\n" +
  "\n" +
  "example: slopweaver handover settle stuck-chat-ask --as filed --witness supervisor-accounts-for-every-stuck-chat\n" +
  'example: slopweaver handover settle the-relayed-ask --as answered --witness <permalink> --card kept --card-why "the owner asked why, not to close it"';
