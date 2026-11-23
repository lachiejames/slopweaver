/**
 * The app-copy-voice gate: the words the app itself writes carry no em dash and no en dash.
 *
 * ## Why this is a gate
 *
 * An em dash is a voice rule violation for the owner, so it is a voice rule violation for anything shown inside
 * this app. The one exception is external content, such as someone else's pull request that happens to have an
 * em dash in the title. It is a gate rather than a review so that the app's own copy follows the voice rules.
 *
 * ## The criterion, not a count
 *
 * In non-test TypeScript under `site/app`, `site/components`, `site/lib` and `desktop`, a `StringLiteral`,
 * `NoSubstitutionTemplateLiteral`, `TemplateHead`, `TemplateMiddle`, `TemplateTail` or `JsxText` node whose decoded
 * text carries U+2014 EM DASH or U+2013 EN DASH, or whose source spells one as an HTML entity (`&mdash;`, `&#8212;`
 * and the en-dash forms), which JSX decodes into the same character. One hit per node.
 *
 * Comments and regular-expression literals are outside it by construction, since the walk reads the AST: a detector
 * spells the dash in a regex, never as an exact string to `includes`. The external-content exception is outside it by construction
 * too: a pull-request title, a Slack message, any text a provider or a person wrote arrives as runtime DATA, and data
 * is no literal node in this tree.
 *
 * The en dash is in because it is the same long dash on a different key, and the first thing an author reaches for
 * when the em dash is refused. A hyphen is out, because it is a word's own punctuation (`re-run`) far more often than a
 * joiner, the same line `authoredSeparator.ts` draws.
 *
 * ## An empty debt list, held by a ratchet
 *
 * On the commit that added it, with the Fleet page's own dashes already taken out, the criterion fired on 620 nodes
 * over 225 files, the heaviest carrying 17. That debt was rewritten to plain punctuation (run
 * `steer-console-copy-dash-debt`), so `.baselines/app-copy-voice-baseline.json` is `{ "files": [] }` and any literal
 * carrying a dash is refused (repro: `yarn tsx src/devLint/appCopyVoice.entry.ts` prints `0 debt entr(ies)`). It stays
 * on `./countRatchet.ts` because that is the shape every gate of its kind shares, and the list can only shrink.
 *
 * ## Blind spots, stated rather than discovered
 *
 * - A dash built from a character code, split across fragments, or arriving as data is invisible.
 * - Copy authored under `src/` and printed by the console through a verb is outside the trees above.
 * - Some literals it refuses are never shown in the app (a prompt to a model, a route's diagnostic), because syntax
 *   cannot prove where a string ends up. They use plain punctuation too.
 * - Two further voice points, one clause per line rather than one crammed line and never addressing
 *   the owner as though the fleet were a person, have no syntax-only criterion that would not drown in false positives.
 *   They stay the composer's, and the Fleet page carries them structurally (`site/lib/fleetState.ts`'s `lines`).
 */

import { forEachChild, type NodeVisitor, ts, withSourceFile } from "#lib/tsSyntax.js";
import { type CountEntry, type CountFinding, runCountRatchet } from "./countRatchet.js";
import { type ScanScope, isScannablePath as scopeIsScannablePath } from "./scanScope.js";

/** The committed debt list, repo-relative. */
const BASELINE_FILE = ".baselines/app-copy-voice-baseline.json";

/** The two dashes a literal may not carry. */
type AppCopyDash = "em-dash" | "en-dash";

/** Which kind of literal node carried the dash. */
type AppCopyLiteralKind =
  "jsx-text" | "string-literal" | "no-substitution-template" | "template-head" | "template-middle" | "template-tail";

/** One literal node carrying a dash: where it is, what kind it is, and a one-line preview. */
export interface AppCopyVoiceHit {
  readonly path: string;
  readonly line: number;
  /** The node's start offset, so two hits on one line stay two findings. */
  readonly offset: number;
  readonly kind: AppCopyLiteralKind;
  readonly dashes: readonly AppCopyDash[];
  readonly preview: string;
}

/**
 * The em dash, as a character or as an HTML entity JSX decodes into one: named, decimal or hex, any number of leading
 * zeros (`&#x02014;` renders the same dash, and a review pass found the first spelling missed it).
 */
const EM_DASH = /—|&mdash;|&#0*8212;|&#x0*2014;/iu;

/** The en dash, the same way. */
const EN_DASH = /–|&ndash;|&#0*8211;|&#x0*2013;/iu;

/** The longest preview a finding line carries, so one finding stays one line. */
const MAX_PREVIEW_CHARS = 70;

/** A node the criterion reads: its kind and its decoded text. */
interface LiteralRead {
  readonly kind: AppCopyLiteralKind;
  readonly decoded: string;
}

/** The literal a node is, or `undefined` when it is not one the criterion reads. */
function literalOf({ node }: { node: ts.Node }): LiteralRead | undefined {
  if (ts.isStringLiteral(node)) {
    return { decoded: node.text, kind: "string-literal" };
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return { decoded: node.text, kind: "no-substitution-template" };
  }
  if (ts.isTemplateHead(node)) {
    return { decoded: node.text, kind: "template-head" };
  }
  if (ts.isTemplateMiddle(node)) {
    return { decoded: node.text, kind: "template-middle" };
  }
  if (ts.isTemplateTail(node)) {
    return { decoded: node.text, kind: "template-tail" };
  }
  if (ts.isJsxText(node)) {
    return { decoded: node.text, kind: "jsx-text" };
  }
  return undefined;
}

/** Which dashes a literal carries, read off both its decoded text and its source spelling. */
function dashesIn({ decoded, source }: { decoded: string; source: string }): readonly AppCopyDash[] {
  const dashes: AppCopyDash[] = [];
  if (EM_DASH.test(decoded) || EM_DASH.test(source)) {
    dashes.push("em-dash");
  }
  if (EN_DASH.test(decoded) || EN_DASH.test(source)) {
    dashes.push("en-dash");
  }
  return dashes;
}

/** A literal's decoded text as one clipped line. */
function previewOf({ text }: { text: string }): string {
  const collapsed = text.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= MAX_PREVIEW_CHARS) {
    return collapsed;
  }
  return `${collapsed.slice(0, MAX_PREVIEW_CHARS - 3)}...`;
}

/**
 * Every literal node in `content` carrying an em or en dash, in source order. Pure: parses in memory with the
 * TypeScript AST, as TSX when the path ends `.tsx`.
 *
 * @param path the file's repo-relative path, carried onto each hit and deciding TS or TSX
 * @param content the file's text
 * @returns each refused literal
 */
export function scanAppCopyVoice({ path, content }: { path: string; content: string }): readonly AppCopyVoiceHit[] {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return withSourceFile({
    fileName: path,
    text: content,
    scriptKind,
    use: (sf): readonly AppCopyVoiceHit[] => {
      const hits: AppCopyVoiceHit[] = [];
      const visit: NodeVisitor = (node) => {
        const literal = literalOf({ node });
        if (literal !== undefined) {
          const dashes = dashesIn({ decoded: literal.decoded, source: node.getText(sf) });
          if (dashes.length > 0) {
            const offset = node.getStart(sf);
            hits.push({
              dashes,
              kind: literal.kind,
              line: sf.getLineAndCharacterOfPosition(offset).line + 1,
              offset,
              path,
              preview: previewOf({ text: literal.decoded }),
            });
          }
        }
        forEachChild({ node, visit });
      };
      visit(sf);
      return hits;
    },
  });
}

/**
 * Collapse a scan into one debt entry per file, in path order. Pure.
 *
 * @param hits every refused literal
 * @returns the counted files, in the debt list's own order
 */
export function countsOf({ hits }: { hits: readonly AppCopyVoiceHit[] }): readonly CountEntry[] {
  const tally = new Map<string, number>();
  for (const hit of hits) {
    const standing = tally.get(hit.path);
    tally.set(hit.path, standing === undefined ? 1 : standing + 1);
  }
  return [...tally.entries()]
    .map(([path, count]) => ({ count, path }))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

/** This gate's declared scan predicate: the app's own TypeScript, tests excluded. */
const SCOPE: ScanScope = {
  excludeTests: true,
  excludeTestsDir: true,
  extensions: [".ts", ".tsx"],
  // None: this gate's own files sit under `src/devLint/`, outside every tree it scans, and the shared exclusion matches
  // by basename, so naming them would exempt an app file that happened to share the name.
  selfFiles: new Set(),
  trees: ["site/app/", "site/components/", "site/lib/", "desktop/"],
};

/**
 * Whether a repo-relative path is in scope for this gate.
 *
 * @param path the repo-relative path
 * @returns true when the gate should scan it
 */
export function isScannablePath({ path }: { path: string }): boolean {
  return scopeIsScannablePath({ path, scope: SCOPE });
}

/** One refused literal's own finding line. */
function findingOf({ hit }: { hit: AppCopyVoiceHit }): CountFinding {
  return { line: hit.line, path: hit.path, text: `${hit.kind} carries ${hit.dashes.join(" and ")}: ${hit.preview}` };
}

/**
 * IO edge: scan the app's own TypeScript, judge it against the committed debt list, or (`--rebaseline`) tighten that
 * list to what stands now.
 *
 * @returns the process exit code (0 clean or rebaselined, 1 a regression, a refused rebaseline, or a hard error)
 */
export function runAppCopyVoice(): number {
  return runCountRatchet<AppCopyVoiceHit>({
    gate: {
      baselineFile: BASELINE_FILE,
      baselineKey: "files",
      cleanLine: ({ current, hits }) =>
        `${String(hits.length)} standing literal(s), ${String(current.length)} debt entr(ies)`,
      counts: countsOf,
      findingKeyOf: ({ hit }) => `${hit.path}:${String(hit.offset)}`,
      findingOf,
      gate: "app-copy-voice",
      keyOf: ({ hit }) => hit.path,
      refusalDetail: ({ regressions }) => `${String(regressions.length)} new or worsened debt entr(ies)`,
      refusalId: "app-copy-voice",
      rebaselineRefusalId: "app-copy-voice-rebaseline",
      scan: scanAppCopyVoice,
      scope: SCOPE,
      unit: "literal(s)",
    },
  });
}
