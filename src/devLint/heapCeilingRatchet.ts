/**
 * The `heap-ceiling-ratchet` gate's judgement: no heap number this repository spends goes UP without a
 * witnessed act. Pure — pins and ceilings in, findings out; reading the files is `./heapCeilingRatchetRun.ts`
 * and finding the numbers is `./heapCeilingSubjects.ts`.
 *
 * **The rules it holds.** An operation needing 20, 8 or even 4 GB is rejected, fix it properly
 * (`docs/constraints/7-9.md`). Never raise a heap ceiling, move the gate to CI instead.
 * `HEAP_BUDGET_MIB` is never raised by a session. A number that should only move on the owner's word
 * is judged against the commit CI compares a branch to, never against itself. Until this gate, all four
 * were prose; the 10,240 MiB compiler ceilings and the 8,192 MiB lint-gate ceiling could each be raised in a
 * one-line diff that every other gate passed.
 *
 * **The two halves.**
 *  - HEAD: `.baselines/heap-ceilings.json` pins every ceiling the tree holds, exactly. A ceiling with no
 *    pin, a pin naming nothing, and a pin disagreeing with its ceiling all fail — so a raise is a diff to a
 *    file a reviewer reads, never a number buried in an argv.
 *  - BASE (`SLOPWEAVER_COVERAGE_BASE_SHA`, `./gitAtCommit.ts`): against the ceilings the base commit's own
 *    files hold, a raise — or a NEW ceiling above {@link RULING_CEILING_MIB} — needs a raise record APPENDED
 *    in this change, naming the key, both numbers, the anchor of the owner's word, when they gave it and when it was
 *    recorded. The record list is append-only: the base's records must be a prefix of the head's. Lowering
 *    is free and needs nothing; DROPPING the flag from a script or gate that still runs is refused, since
 *    that process then runs at V8's host-dependent default. A script's process-tree RSS ceiling is judged
 *    against the V8 heap ceiling it replaces ({@link predecessorCeiling}), never as a ceiling from nothing.
 *
 * **The baseline registry judges the same file separately** (`./baselineRegistry.ts`): a key new to
 * `.baselines/heap-ceilings.json` is a loosening there whatever its number, so the TypeScript 7 flip's RSS
 * keys arrive with a bump manifest and its witness, not on this gate's word alone.
 *
 * **Residue, stated rather than discovered.** CI cannot resolve an anchor, so a session could write a record
 * naming a word the owner never said. What the gate removes is the SILENT raise: every raise is now an exact,
 * dated, attributed row
 * in a reviewed diff, so a false one is findable afterwards. Outside the base half (a local run, no SHA)
 * only the HEAD half runs, and the run says so.
 */
import { isRecord } from "#lib/parsers.js";
import { isUtcInstant } from "../handover/parkWake.js";
import { isPackageScriptKey, RSS_KEY_SUFFIX } from "./heapCeilingSubjects.js";

/** The pins file, repo-relative. */
export const PINS_PATH = ".baselines/heap-ceilings.json";

/**
 * The ceiling the owner's rule allows without a word: 4 GiB. A ceiling a change INTRODUCES at or under it
 * passes; one above it is a raise from nothing and needs a record.
 */
const RULING_CEILING_MIB = 4096;

/** One witnessed raise: which ceiling, from what to what, and where the owner's word is. */
export interface HeapRaise {
  readonly key: string;
  /** The base ceiling, or `null` for a ceiling the base did not hold. */
  readonly fromMiB: number | null;
  readonly toMiB: number;
  /** Where the owner's word is — a transcript, voice or Slack anchor a reader can resolve. */
  readonly anchor: string;
  /** When the owner gave it, a UTC instant. */
  readonly approvedIso: string;
  /** When this row was written, a UTC instant no earlier than {@link HeapRaise.approvedIso}. */
  readonly recordedIso: string;
}

/** The committed pins: every ceiling, and every raise ever witnessed. */
interface HeapPins {
  readonly ceilingsMiB: ReadonlyMap<string, number>;
  readonly raises: readonly HeapRaise[];
}

/** The pins file read, or the one line saying why it cannot be. */
export type PinsReading =
  { readonly kind: "pins"; readonly pins: HeapPins } | { readonly kind: "unread"; readonly why: string };

/**
 * Whether a value is a positive whole number of MiB.
 *
 * @param value the candidate
 * @returns true for a positive safe integer
 */
function isMib(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/**
 * Read one raise record, refusing any field this gate could not judge.
 *
 * @param value one element of the file's `raises` array
 * @param index its position, for the message
 * @returns the record, or why it does not read
 */
function readRaise({ value, index }: { value: unknown; index: number }): HeapRaise | string {
  const where = `${PINS_PATH} raises[${String(index)}]`;
  if (!isRecord(value)) {
    return `${where} is not an object`;
  }
  const { key, fromMiB, toMiB, anchor, approvedIso, recordedIso } = value;
  if (typeof key !== "string" || key.trim().length === 0) {
    return `${where} names no key`;
  }
  if (fromMiB !== null && !isMib(fromMiB)) {
    return `${where} \`fromMiB\` is neither null nor a positive whole number`;
  }
  if (!isMib(toMiB)) {
    return `${where} \`toMiB\` is not a positive whole number`;
  }
  if (typeof anchor !== "string" || anchor.trim().length === 0) {
    return `${where} carries no anchor for the owner's word`;
  }
  if (typeof approvedIso !== "string" || !isUtcInstant({ text: approvedIso })) {
    return `${where} \`approvedIso\` is not one UTC instant ending in Z`;
  }
  if (typeof recordedIso !== "string" || !isUtcInstant({ text: recordedIso })) {
    return `${where} \`recordedIso\` is not one UTC instant ending in Z`;
  }
  if (Date.parse(recordedIso) < Date.parse(approvedIso)) {
    return `${where} was recorded before the approval it records`;
  }
  return { anchor, approvedIso, fromMiB, key, recordedIso, toMiB };
}

/**
 * Read the pins file's text.
 *
 * @param text the file's whole contents
 * @returns the pins, or why the file cannot be judged
 */
export function readHeapPins({ text }: { text: string }): PinsReading {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error: unknown) {
    return { kind: "unread", why: `${PINS_PATH} is not readable JSON: ${String(error)}` };
  }
  if (!isRecord(parsed) || parsed["schemaVersion"] !== 1) {
    return { kind: "unread", why: `${PINS_PATH} is not a schemaVersion 1 object` };
  }
  const { ceilingsMiB, raises } = parsed;
  if (!isRecord(ceilingsMiB) || !Array.isArray(raises)) {
    return { kind: "unread", why: `${PINS_PATH} needs a \`ceilingsMiB\` object and a \`raises\` array` };
  }
  const ceilings = new Map<string, number>();
  for (const [key, mib] of Object.entries(ceilingsMiB)) {
    if (!isMib(mib)) {
      return { kind: "unread", why: `${PINS_PATH} pins \`${key}\` at something other than a positive whole MiB` };
    }
    ceilings.set(key, mib);
  }
  const read = raises.map((value: unknown, index) => readRaise({ index, value }));
  const broken = read.find((entry): entry is string => typeof entry === "string");
  if (broken !== undefined) {
    return { kind: "unread", why: broken };
  }
  return { kind: "pins", pins: { ceilingsMiB: ceilings, raises: read.filter((entry) => typeof entry !== "string") } };
}

/**
 * The HEAD half: the pins equal the tree's ceilings, key for key.
 *
 * @param pinned the committed pins
 * @param ceilings what the tree's files hold
 * @returns one line per disagreement, empty when they match exactly
 */
export function judgeHeadPins({
  pinned,
  ceilings,
}: {
  pinned: ReadonlyMap<string, number>;
  ceilings: ReadonlyMap<string, number>;
}): readonly string[] {
  const findings: string[] = [];
  for (const [key, mib] of ceilings) {
    const pin = pinned.get(key);
    if (pin === undefined) {
      findings.push(`\`${key}\` is ${String(mib)} MiB in the tree and ${PINS_PATH} does not pin it`);
    } else if (pin !== mib) {
      findings.push(`\`${key}\` is ${String(mib)} MiB in the tree and ${PINS_PATH} pins it at ${String(pin)}`);
    }
  }
  for (const key of pinned.keys()) {
    if (!ceilings.has(key)) {
      findings.push(`${PINS_PATH} pins \`${key}\`, which no file this gate reads still holds — delete the pin`);
    }
  }
  return findings;
}

/**
 * Whether two raise records are the same row, field for field.
 *
 * @param left one record
 * @param right the other
 * @returns true when every field agrees
 */
function sameRaise({ left, right }: { left: HeapRaise; right: HeapRaise }): boolean {
  return (
    left.key === right.key &&
    left.fromMiB === right.fromMiB &&
    left.toMiB === right.toMiB &&
    left.anchor === right.anchor &&
    left.approvedIso === right.approvedIso &&
    left.recordedIso === right.recordedIso
  );
}

/** What one ceiling's move against the base needs: nothing, a record that is there, or one that is not. */
type RaiseVerdict =
  | { readonly kind: "not-raised" }
  | { readonly kind: "witnessed"; readonly record: HeapRaise }
  | { readonly kind: "unwitnessed"; readonly line: string };

/**
 * Judge one ceiling against the base. A ceiling the base did not hold is a raise from nothing only when
 * it is over {@link RULING_CEILING_MIB}.
 *
 * @param key the ceiling
 * @param mib its value in the tree
 * @param before its value at the base, or `undefined` when the base did not hold it
 * @param appended the raise records this change appended
 * @returns whether it rose, and if so the record that witnesses it or the line saying none does
 */
function raiseVerdict({
  key,
  mib,
  before,
  appended,
}: {
  key: string;
  mib: number;
  before: number | undefined;
  appended: readonly HeapRaise[];
}): RaiseVerdict {
  if (before === undefined && mib <= RULING_CEILING_MIB) {
    return { kind: "not-raised" };
  }
  if (before !== undefined && mib <= before) {
    return { kind: "not-raised" };
  }
  const record = appended.find(
    (raise) =>
      raise.key === key &&
      raise.toMiB === mib &&
      ((raise.fromMiB === null && before === undefined) || raise.fromMiB === before),
  );
  if (record !== undefined) {
    return { kind: "witnessed", record };
  }
  const was =
    before === undefined
      ? `new, above the ${String(RULING_CEILING_MIB)} MiB the owner's rule allows`
      : `${String(before)} MiB at the base`;
  return {
    kind: "unwitnessed",
    line: `\`${key}\` rises to ${String(mib)} MiB (${was}) with no raise record appended for the owner's word`,
  };
}

/**
 * Every base ceiling the tree DROPS from a script or gate it still holds. With no flag, that process runs
 * at V8's own default, which depends on the host and no pin bounds, so dropping the flag is never the way
 * to lower one: spelling the lower number is. A key whose script or gate is gone entirely spawns nothing,
 * and is not here.
 *
 * @param base the base commit's ceilings
 * @param head the tree's ceilings and the subjects it holds with none
 * @returns one line per dropped ceiling
 */
function droppedCeilings({
  base,
  head,
}: {
  base: ReadonlyMap<string, number>;
  head: { readonly ceilings: ReadonlyMap<string, number>; readonly uncapped: ReadonlySet<string> };
}): readonly string[] {
  return [...base]
    .filter(([key]) => !head.ceilings.has(key) && head.uncapped.has(key))
    .map(([key, mib]) =>
      key.endsWith(RSS_KEY_SUFFIX)
        ? `\`${key}\` drops its ${String(mib)} MiB ceiling, so nothing bounds its process tree's memory — spell the lower number on its \`--rss-ceiling-mib\` instead of removing the owner`
        : `\`${key}\` drops its ${String(mib)} MiB ceiling, so it runs at V8's own default, which no pin bounds — spell the lower number on its argv instead of deleting the flag`,
    );
}

/**
 * The ceiling a key replaces when the base did not hold that key itself.
 *
 * Only one move has a predecessor: a script's PROCESS-TREE RSS ceiling (the native compiler's owner,
 * `scripts/tsc-owner.sh`) replaces the same script's V8 HEAP ceiling when TypeScript 7 removes the flag. It
 * is not a raise only when it is no greater than that heap ceiling, which is the stricter reading: RSS counts
 * every page the process tree holds, a heap flag only one Node isolate's heap. The move is ONE-WAY. A V8 key
 * has no predecessor, so an RSS ceiling never licenses a later heap ceiling above the ruling.
 *
 * @param key the head's key
 * @param base the base commit's ceilings
 * @returns the predecessor's MiB, or `undefined` when the key has none the base holds
 */
export function predecessorCeiling({
  key,
  base,
}: {
  key: string;
  base: ReadonlyMap<string, number>;
}): number | undefined {
  if (!key.endsWith(RSS_KEY_SUFFIX) || !isPackageScriptKey({ key })) {
    // Only a package script moves onto the owner; a lint gate renamed with the suffix is a new subject (Codex 8b r1).
    return undefined;
  }
  return base.get(key.slice(0, -RSS_KEY_SUFFIX.length));
}

/**
 * The BASE half: every raise against the base commit's own ceilings is witnessed by a record this change
 * appended, every appended record witnesses a raise this change made, no ceiling is dropped from a process
 * that still runs, and no earlier record moved.
 *
 * @param base the base commit's ceilings and raise records (empty records when it had no pins file)
 * @param head the tree's ceilings, the subjects it holds with none, and its raise records
 * @returns one line per unwitnessed raise, dropped ceiling or tampered record, empty when clean
 */
export function judgeAgainstBase({
  base,
  head,
}: {
  base: { readonly ceilings: ReadonlyMap<string, number>; readonly raises: readonly HeapRaise[] };
  head: {
    readonly ceilings: ReadonlyMap<string, number>;
    readonly raises: readonly HeapRaise[];
    readonly uncapped: ReadonlySet<string>;
  };
}): readonly string[] {
  const prefixHolds =
    head.raises.length >= base.raises.length &&
    base.raises.every((left, index) => sameRaise({ left, right: head.raises[index]! }));
  if (!prefixHolds) {
    return [`${PINS_PATH}'s \`raises\` is append-only, and this change edits or deletes a record the base held`];
  }
  const appended = head.raises.slice(base.raises.length);
  const witnessed = new Set<HeapRaise>();
  const findings: string[] = [...droppedCeilings({ base: base.ceilings, head })];
  for (const [key, mib] of head.ceilings) {
    const before = base.ceilings.has(key) ? base.ceilings.get(key) : predecessorCeiling({ base: base.ceilings, key });
    const verdict = raiseVerdict({ appended, before, key, mib });
    if (verdict.kind === "unwitnessed") {
      findings.push(verdict.line);
    } else if (verdict.kind === "witnessed") {
      witnessed.add(verdict.record);
    }
  }
  for (const record of appended.filter((raise) => !witnessed.has(raise))) {
    findings.push(
      `${PINS_PATH} appends a raise of \`${record.key}\` to ${String(record.toMiB)} MiB that this change does not make — a record witnesses exactly one raise`,
    );
  }
  return findings;
}
