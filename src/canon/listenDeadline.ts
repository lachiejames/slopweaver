/**
 * The `listen --deadline-ms` help-truth binding: an invocation canon ADVERTISES is one the shipped
 * validator ACCEPTS.
 *
 * ## The failure this closes
 *
 * `--deadline-ms` shipped with its documentation and its validator disagreeing, and they stayed that way
 * for weeks. `skills/loop/SKILL.md` instructed `listen --follow --emit --json --deadline-ms …` while
 * `src/cli/commands/listen/core.ts`'s `validateDeadlineMode` refused exactly that
 * ("--deadline-ms is only valid together with --emit --json, and never with --check or --follow"), and
 * `src/cli/commands/listen/scheduledRecover.ts` claimed parity with the same rejected combination. Live
 * loops coped by running `--follow` alone, so nothing ever failed loudly — the documented door was simply
 * unopenable, and only a hand audit found it.
 *
 * The settled reading, from the parent design (`alerts-next-deadline-loop-wiring`, quoting Slice 5): the
 * deadline race is a ONE-SHOT primitive — "a one-shot listener with the next deadline", which hands control
 * back so the caller can recompute the next deadline. A `--follow` stream never ends, so it has nothing to
 * hand back. `--follow` is the other mode, not a modifier of this one.
 *
 * ## Why this is a ratchet and not a grep
 *
 * A `grep` for the offending string would be a SECOND hand-authored declaration of the same rule, rotting
 * the moment either validator moved. Nothing here declares which flags are incompatible. An advertised
 * invocation is rebuilt as the verb's own canonical accepted argv PLUS whatever extra mode flags the prose
 * wrote, and handed to the REAL validator (injected, so this module stays pure). If `core.ts` ever
 * legitimately learns `--follow`, prose naming it goes green on its own.
 *
 * ## Two bounds, both deliberate
 *
 * **Verb-scoped.** Extraction opens on the token `listen` and nothing else, because
 * `src/cli/commands/events/tail.ts` documents `--follow` together with `--deadline-ms` and that combination
 * is GENUINELY valid on that verb. A text-level scan for the two flags near each other reddens a correct
 * file; anchoring on `listen` is what keeps `events tail` out of scope. A future third `--deadline-ms` verb
 * is likewise out of scope rather than wrongly judged.
 *
 * **Flags and placeholders only.** An invocation ends at the first token that is not a long flag or a `<…>`
 * placeholder, so one written with a bare literal value is read only up to that value. That is conservative
 * in the safe direction: this gate would rather miss an invocation than redden a correct file. It is also
 * what makes a usage LINE — `listen [--check] [--once] … [--deadline-ms <epoch>]`, every flag bracketed as
 * an alternative — collect nothing at all, which is right: a usage line advertises a flag surface, never a
 * combination. The flag surface is `helpTruth.test.ts`'s business.
 *
 * ## Three things it deliberately does NOT catch
 *
 * Each is a false NEGATIVE, which is the direction this gate errs in on purpose. A review pass found the
 * first as a dead branch claiming otherwise, so they are stated rather than discovered.
 *
 * - **A bracketed optional ahead of the flag.** `listen [--follow] --emit --json --deadline-ms <n>` stops
 *   at the bracket and is never judged. A line mixing usage-syntax optionals with real flags is ambiguous
 *   about which were meant together, so there is nothing safe to conclude from it.
 * - **A MISSING required flag.** `listen recover --deadline-ms <n>`, written with no `--scheduled`, passes:
 *   the baseline supplies what the verb requires and this gate asks about COMPATIBILITY, not completeness.
 *   That is the same property that lets a bare `listen --deadline-ms` prose fragment through, which is
 *   wanted — a fragment advertises no combination at all.
 * - **Prose EXPLAINING the refusal.** Quoting the refused combination next to the word `listen` reddens,
 *   whatever the surrounding sentence says, because no criterion here reads English. The binding's own two
 *   files are held out of the tree scan for exactly this reason, each with its own live-fixture assertion;
 *   a third file needing the same treatment joins that list and takes the same assertion with it.
 */

/** The verb an advertised invocation addresses. */
export type ListenDeadlineVerb = "listen" | "listen recover";

/** One `listen` invocation, carrying `--deadline-ms`, written into canon or into a source comment. */
export interface AdvertisedInvocation {
  readonly path: string;
  /** The physical line the invocation's own `listen` token sits on, 1-indexed. */
  readonly line: number;
  readonly verb: ListenDeadlineVerb;
  /** Every long flag the invocation wrote, without the `--`, in the order written. */
  readonly flags: readonly string[];
  /** The invocation's own tokens, punctuation stripped, for the offender message. */
  readonly text: string;
}

/** What a verb needs for an advertised invocation to be judged against its own shipped parser. */
export interface DeadlineVerbContract {
  /** The argv an accepted invocation of this verb starts from — the canonical `--deadline-ms` spelling. */
  readonly baseline: readonly string[];
  /** The verb's own declared BOOLEAN flag names, without the `--`: the only flags that can be a MODE. */
  readonly booleanFlags: readonly string[];
  /** The REAL validator. Returns the rejections it produced — empty when it accepted the argv. */
  readonly validate: (args: { argv: readonly string[] }) => readonly string[];
}

/** An advertised invocation the shipped validator refuses, and the argv that proved it. */
export interface DeadlineOffender {
  readonly invocation: AdvertisedInvocation;
  readonly argv: readonly string[];
  readonly rejections: readonly string[];
}

/** One source line after backslash continuations have been folded into it. */
export interface LogicalLine {
  /** The 1-indexed physical line the logical line STARTS on. */
  readonly line: number;
  readonly text: string;
}

/**
 * Fold backslash-continued lines into one logical line each, keeping the first physical line number.
 *
 * The real `skills/loop/SKILL.md` invocation spans two physical lines with the `--deadline-ms` on the
 * continuation, so a per-physical-line scan would see a flagless `listen recover` and a headless tail.
 *
 * @param content the whole file
 * @returns one entry per logical line, in file order
 */
export function logicalLines({ content }: { content: string }): readonly LogicalLine[] {
  const folded: LogicalLine[] = [];
  const physical = content.split("\n");
  let carried = "";
  let startLine = 0;
  for (const [index, raw] of physical.entries()) {
    const isContinuation = carried.length > 0;
    if (!isContinuation) {
      startLine = index + 1;
    }
    const joined = isContinuation ? `${carried} ${raw.trim()}` : raw;
    if (joined.trimEnd().endsWith("\\")) {
      carried = joined.trimEnd().slice(0, -1).trimEnd();
      continue;
    }
    folded.push({ line: startLine, text: joined });
    carried = "";
  }
  if (carried.length > 0) {
    folded.push({ line: startLine, text: carried });
  }
  return folded;
}

/**
 * Strip the punctuation a prose, fenced-block or JSDoc context wraps a command token in, so a backticked
 * ``​`listen --follow --deadline-ms`​`` tokenises exactly like the same line inside a code fence.
 *
 * @param raw the whitespace-delimited token as written
 * @returns the bare token
 */
export function bareToken({ raw }: { raw: string }): string {
  return raw.replace(/^[`"'([]+/, "").replace(/[`"')\],.;:]+$/, "");
}

/** Where a `<…>` placeholder opening at `from` closes, or `undefined` when it never does. */
function placeholderEnd({ tokens, from }: { tokens: readonly string[]; from: number }): number | undefined {
  for (let index = from; index < tokens.length; index += 1) {
    if (tokens[index]?.replace(/[`"')\],.;:]+$/, "").endsWith(">") === true) {
      return index;
    }
  }
  return undefined;
}

/** What one token contributes to the invocation being collected. */
type InvocationStep =
  | { readonly kind: "flag"; readonly name: string; readonly next: number }
  | { readonly kind: "skip"; readonly next: number }
  | { readonly kind: "stop" };

/** A `<…>` placeholder: consumed whole, however many tokens it spans, contributing nothing. */
function placeholderStep({ tokens, index }: { tokens: readonly string[]; index: number }): InvocationStep {
  const end = placeholderEnd({ from: index, tokens });
  if (end === undefined) {
    return { kind: "stop" };
  }
  return { kind: "skip", next: end + 1 };
}

/** Read the token at `index` as the next step of an invocation. */
function stepAt({ tokens, index }: { tokens: readonly string[]; index: number }): InvocationStep {
  const raw = tokens[index];
  if (raw === undefined) {
    return { kind: "stop" };
  }
  // A bracketed token ENDS the invocation. `[--follow]` is usage syntax announcing that a flag MAY be
  // given, which is a flag surface rather than a combination somebody is instructed to type — and reading
  // one as typed is how a correct usage line would be reddened. Stopping here rather than skipping the
  // group is deliberate: a line mixing bracketed optionals with real flags is ambiguous about which were
  // meant together, so the safe reading is to stop and miss it.
  if (raw.startsWith("[")) {
    return { kind: "stop" };
  }
  const bare = bareToken({ raw });
  if (bare.startsWith("--") && bare.length > 2) {
    return { kind: "flag", name: bare.slice(2), next: index + 1 };
  }
  if (bare.startsWith("<")) {
    return placeholderStep({ index, tokens });
  }
  return { kind: "stop" };
}

/** Collect one invocation's flags, starting at the token AFTER `listen`. Returns where it ended. */
function collectInvocation({ tokens, from }: { tokens: readonly string[]; from: number }): {
  readonly verb: ListenDeadlineVerb;
  readonly flags: readonly string[];
  readonly end: number;
} {
  const flags: string[] = [];
  const opensRecover = tokens[from]?.replace(/^[`"'([]+/, "").replace(/[`"')\],.;:]+$/, "") === "recover";
  let index = opensRecover ? from + 1 : from;
  const verb: ListenDeadlineVerb = opensRecover ? "listen recover" : "listen";
  while (index < tokens.length) {
    const step = stepAt({ index, tokens });
    if (step.kind === "stop") {
      break;
    }
    if (step.kind === "flag") {
      flags.push(step.name);
    }
    index = step.next;
  }
  return { end: index, flags, verb };
}

/**
 * Extract every advertised `listen` invocation in one file that carries `--deadline-ms`.
 *
 * Pure — it never touches a filesystem, so the whole extraction is driven on inline fixtures.
 *
 * @param content the file's whole text
 * @returns the invocations, in file order
 */
export function scanAdvertisedDeadlineInvocations({
  path,
  content,
}: {
  path: string;
  content: string;
}): readonly AdvertisedInvocation[] {
  const found: AdvertisedInvocation[] = [];
  for (const { line, text } of logicalLines({ content })) {
    const tokens = text.split(/\s+/).filter((token) => token.length > 0);
    let index = 0;
    while (index < tokens.length) {
      const raw = tokens[index];
      if (raw === undefined || bareToken({ raw }) !== "listen") {
        index += 1;
        continue;
      }
      const { verb, flags, end } = collectInvocation({ from: index + 1, tokens });
      if (flags.includes("deadline-ms")) {
        const written = tokens
          .slice(index, end)
          .map((token) => bareToken({ raw: token }))
          .join(" ");
        found.push({ flags, line, path, text: written, verb });
      }
      // `collectInvocation` opens at `index + 1` and only ever moves forward, so `end` is strictly past the
      // `listen` token this pass consumed and the walk cannot stall.
      index = end;
    }
  }
  return found;
}

/**
 * Rebuild an advertised invocation as the verb's canonical accepted argv plus every EXTRA mode flag the
 * prose wrote — the argv the real validator is then asked to accept.
 *
 * Only flags the verb itself declares BOOLEAN are carried over: a flag that takes a value is a value, never
 * a mode, and the validators branch on modes alone. A flag the baseline already spells is not repeated.
 *
 * @param invocation the advertised invocation
 * @param contract the verb's baseline and declared boolean flags
 * @returns the argv to validate
 */
export function deadlineArgvFor({
  invocation,
  contract,
}: {
  invocation: AdvertisedInvocation;
  contract: DeadlineVerbContract;
}): readonly string[] {
  const extras = invocation.flags.filter(
    (flag) => contract.booleanFlags.includes(flag) && !contract.baseline.includes(`--${flag}`),
  );
  const unique = [...new Set(extras)].map((flag) => `--${flag}`);
  return [...contract.baseline, ...unique];
}

/**
 * The binding itself: every advertised invocation the shipped validator refuses.
 *
 * @param invocations every advertised invocation found across the scanned files
 * @param contracts the per-verb baseline, boolean flags and REAL validator
 * @returns one offender per refused invocation, in the order the invocations arrived
 */
export function listenDeadlineOffenders({
  invocations,
  contracts,
}: {
  invocations: readonly AdvertisedInvocation[];
  contracts: Readonly<Record<ListenDeadlineVerb, DeadlineVerbContract>>;
}): readonly DeadlineOffender[] {
  const offenders: DeadlineOffender[] = [];
  for (const invocation of invocations) {
    const contract = contracts[invocation.verb];
    const argv = deadlineArgvFor({ contract, invocation });
    const rejections = contract.validate({ argv });
    if (rejections.length > 0) {
      offenders.push({ argv, invocation, rejections });
    }
  }
  return offenders;
}

/**
 * Render one offender as the line a failing run prints — the site, what it advertises, and the shipped
 * validator's OWN rejection, never a restatement of it.
 *
 * @param offender the refused invocation
 * @returns the message
 */
export function formatDeadlineOffender({ offender }: { offender: DeadlineOffender }): string {
  const { invocation, argv, rejections } = offender;
  return (
    `${invocation.path}:${String(invocation.line)}  advertises \`${invocation.text}\`\n` +
    `    validated as: ${argv.join(" ")}\n` +
    `    refused with: ${rejections.join("; ")}`
  );
}
