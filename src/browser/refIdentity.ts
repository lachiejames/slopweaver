/**
 * What a snapshot ref NAMES, read out of the snapshot text, so an action can refuse a ref that has come to name
 * a different element between the read the caller decided against and the read the dispatch resolves against.
 *
 * ## Why a ref alone is not enough
 *
 * The client resolves `--target f1e40` against the LAST snapshot it took, which in `browser act` is the
 * admission's own read ({@link ./actionExecutor.currentPage}), not the `browser read` the caller cited. Within
 * one document that does not matter: Playwright keeps an element's ref only while its role AND accessible name
 * stay the same, and mints a fresh one otherwise (`computeAriaRef` in `playwright-core/lib/coreBundle.js`).
 * Across a REPLACED document it does. The ref counter is module state of the page's injected script, so it
 * restarts with the new document under the same frame prefix — MEASURED on claude.ai's sign-in page
 * (knowledge register): two reads gave `f1e52` then `f1e40` for the same field, and on another page
 * `browser open`'s pre-render read held `f10e1` while the rendered page held `f10e51`.
 * So a ref from the cited read can reappear in the admission read on ANOTHER element, and the click lands on
 * it — the client's own "Ref not found" only fires while the new document has not reached that number yet.
 *
 * ## Identity is role and name, and nothing else on the line
 *
 * The line also carries state (`[active]`, `[checked]`, `[expanded]`, …) and, after a colon, the element's
 * text or a field's value. All of those change over one element's life, so comparing them would refuse a
 * correctly-aimed click on a button that merely gained focus. Role and name are exactly what Playwright itself
 * keys a ref on, so a difference there is proof the ref was re-issued, never noise.
 *
 * ## What this cannot see, stated rather than discovered
 *
 * A replaced document that puts an element with the SAME role and name at the same ref passes — by
 * construction that is the element the caller chose by role and name. A ref absent from either read gives no
 * verdict: absent from the admission read, the client already fails closed; absent from the cited read, the
 * caller aimed from somewhere else (an act receipt's snapshot) and there is nothing here to compare. The client
 * prints no name longer than 900 characters, so two such elements of one role read alike and pass. A line this
 * parser cannot read gives no verdict either, which is fail-OPEN — the unit test pins the shapes the client
 * really writes, so a format change reddens a test rather than silently disarming the check.
 */
import { type AimRequest, isSnapshotRef } from "./aim.js";

/** What one ref names in one snapshot: the two things Playwright keys a ref on. */
export interface RefElement {
  readonly role: string;
  /** The accessible name exactly as the snapshot renders it (JSON-quoted, or a raw `/…/`), or `null` for none. */
  readonly name: string | null;
}

/** A ref both reads carry, naming a different element in each. */
export interface RenamedRef {
  readonly ref: string;
  /** What the ref named in the read the caller cited. */
  readonly observed: RefElement;
  /** What the ref names in the read the dispatch will resolve it against. */
  readonly admitted: RefElement;
}

/**
 * A snapshot key with its attributes peeled off: a role, then an optional name as the client renders one —
 * JSON-quoted, or raw when it starts and ends with `/` (a lone `/` included).
 */
const KEY_HEAD = /^(?<role>[^\s"'[]+)(?: (?<name>"(?:[^"\\]|\\.)*"|\/(?:.*\/)?))?$/u;

/** The `[…]` attributes the client writes at the end of a key — state, the ref, the cursor. */
const ATTRIBUTE_RUN = /(?: \[[\w=-]+\])*$/u;

/** Where an unquoted key ends and the element's text or value begins. */
const KEY_END = /:(?=\s|$)/u;

/** A YAML single-quoted key, which the client writes whenever the key needs quoting; `''` is one quote. */
const QUOTED_KEY = /^'(?<body>(?:[^']|'')*)'/u;

/**
 * Read what one ref names out of a snapshot's YAML.
 *
 * @param yaml the snapshot text, exactly as the client printed or filed it
 * @param ref the ref to look for — matched with its closing bracket, so `f1e1` never matches `f1e12`
 * @returns the role and name, or `null` when no line carries the ref or its key cannot be read
 */
export function snapshotRefElement({ yaml, ref }: { yaml: string; ref: string }): RefElement | null {
  const marker = `[ref=${ref}]`;
  for (const line of yaml.split("\n")) {
    const element = line.includes(marker) ? lineElement({ line, marker }) : null;
    if (element !== null) {
      return element;
    }
  }
  return null;
}

/**
 * Read one snapshot line, when its OWN ref is the one asked for.
 *
 * The ref is looked for only in the run of `[…]` attributes that ends the key, never in the name or the text
 * after the colon. A page chooses its own names and text, so a button labelled `see [ref=e5]` — or a raw
 * name such as `/x/ [ref=e5] /`, which the client prints unquoted — must not be read as element `e5`: a page
 * could otherwise plant a decoy line reading as the element the caller chose.
 *
 * @param line one line of the snapshot
 * @param marker the `[ref=…]` attribute being looked for
 * @returns the role and name, or `null` when the line is not that element's or cannot be read
 */
function lineElement({ line, marker }: { line: string; marker: string }): RefElement | null {
  const item = line.trim().replace(/^- /u, "");
  const quoted = QUOTED_KEY.exec(item)?.groups?.["body"];
  let key: string;
  if (quoted === undefined) {
    // An unquoted key holds no `:` before a space or the line's end — the client quotes any key that does.
    key = item.split(KEY_END, 1)[0]!;
  } else {
    key = quoted.replaceAll("''", "'");
  }
  // Peeled from the END: a name ends in `"` or `/` and an attribute holds neither, so the split is unique.
  const attributes = ATTRIBUTE_RUN.exec(key)!;
  if (!attributes[0].split(" ").includes(marker)) {
    return null;
  }
  const head = KEY_HEAD.exec(key.slice(0, attributes.index))?.groups;
  const role = head?.["role"];
  if (head === undefined || role === undefined) {
    return null;
  }
  const name = head["name"];
  if (name === undefined) {
    return { name: null, role };
  }
  return { name, role };
}

/**
 * Every ref an interaction aims by — the same three aiming values `./aim.ts` refuses a selector on.
 *
 * @param request the aiming values as the caller typed them
 * @returns the ones that are snapshot refs, in flag order
 */
export function aimedRefs({ request }: { request: AimRequest }): readonly string[] {
  const aims = [request.target, request.kind === "drag" ? request.value : undefined, request.expectFocus];
  return aims.filter((aim): aim is string => aim !== undefined && isSnapshotRef({ value: aim }));
}

/**
 * The first aimed ref that names a different element in the admission read than in the cited one.
 *
 * @param observedYaml the snapshot the caller cited
 * @param admittedYaml the snapshot the admission just took, which the dispatch resolves refs against
 * @param refs the refs the interaction aims by
 * @returns the renamed ref and what it named in each read, or `null` when none differs
 */
export function renamedRef({
  observedYaml,
  admittedYaml,
  refs,
}: {
  observedYaml: string;
  admittedYaml: string;
  refs: readonly string[];
}): RenamedRef | null {
  for (const ref of refs) {
    const observed = snapshotRefElement({ ref, yaml: observedYaml });
    const admitted = snapshotRefElement({ ref, yaml: admittedYaml });
    if (observed !== null && admitted !== null && !sameElement({ a: observed, b: admitted })) {
      return { admitted, observed, ref };
    }
  }
  return null;
}

/**
 * One element as a reader recognises it — its role, then its name when it has one.
 *
 * @param element what a ref named
 * @returns the phrase, e.g. `button "Continue with email"`
 */
export function describeRefElement({ element }: { element: RefElement }): string {
  return element.name === null ? element.role : `${element.role} ${element.name}`;
}

/**
 * Whether two reads of a ref name the same element.
 *
 * @param a one read
 * @param b the other
 * @returns true when role and name both match
 */
function sameElement({ a, b }: { a: RefElement; b: RefElement }): boolean {
  return a.role === b.role && a.name === b.name;
}
