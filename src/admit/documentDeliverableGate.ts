/**
 * The gate that refuses to hand a ROOM a path on the owner's own laptop, and the lane's markdown-first rule.
 *
 * ## The measured failure
 *
 * A turn answered into a team channel with three colleagues in the thread. It had written four local pages
 * and delivered a note saying nothing was uploaded anywhere and the pages were files under
 * `~/.slopweaver/pages/` on the owner's mac, followed by a four-row table of `~/.slopweaver` paths. The owner
 * then uploaded one of the files by hand, preferring markdown. Everyone else in that thread received a
 * deliverable none of them could open.
 *
 * The composer was not careless. `../outbound/assistant/answerForm.ts` carried an images lane and nothing
 * else, so a DOCUMENT had no way through the door and a path was the only thing left to say. That half is
 * fixed by the form's `documents` lane; this half is the rail that stops the old shape coming back, because
 * the lane existing is not the same as the lane being used.
 *
 * ## Two findings, one subject
 *
 * {@link LOCAL_PAGE_PATH_CODE} fires when a CHANNEL answer's own text names a local page path. The surface
 * is the whole test and it is the honest one: in the owner's DM a path is the correct answer — it is their machine,
 * the file is there, and `slopweaver page` exists to write it. In a room the same sentence reaches people
 * for whom that path resolves to nothing.
 *
 * {@link MARKDOWN_FIRST_CODE} fires when the documents attached are html with no markdown beside them, or
 * list the html before the markdown. The rule is a preference rather than a
 * prohibition, which is exactly the
 * shape a `warn` with a named override expresses and a schema refusal does not (see
 * `../outbound/assistant/answerArm.ts`'s `answerDocumentsSchema` for why this is not enforced there).
 *
 * ## Why not `../outbound/slack/publicCardGate.ts`, which the finding row names
 *
 * That module is reached only by the AS-ME drip lane — its entry test is `needsSurfaceForOneCard`, on a
 * `DripShape`. The turn that produced this finding was a BOT ANSWER, which never touches it, so the row's
 * phrase describes the intent and not a seam. The gate that has to fire is in `deterministicAnswerGates`
 * (`../live/turn/answerPreflight.ts`), which is the one list run before a reviewer is spawned AND again at
 * the door, and which already carries the `surface` this decision turns on.
 *
 * Pure — text and a surface in, findings out. No filesystem, no clock, and no regex over a path: see
 * {@link localPagePathsInText}.
 */

import { runSequencesOf } from "../outbound/artifact/runs.js";
import type { InlineRun } from "../outbound/artifact/types.js";
import { ANSWER_DOCUMENT_EXTENSIONS } from "../outbound/assistant/answerArm.js";
import type { AnswerFormAnswer } from "../outbound/assistant/answerForm.js";
import { LOCAL_PAGE_URL_IN_TEXT, PAGE_FILENAME, PAGES_DIRECTORY } from "../pages/url.js";
import type { DoorFinding, DoorGate } from "./types.js";
import type { ReplySurface } from "./withhold.js";

/** The finding code a channel answer naming a path on the owner's own machine fires. */
export const LOCAL_PAGE_PATH_CODE = "ANSWER_NAMES_A_LOCAL_PAGE_PATH";

/** The finding code an html-without-markdown (or html-before-markdown) document set fires. */
export const MARKDOWN_FIRST_CODE = "ANSWER_DOCUMENTS_NOT_MARKDOWN_FIRST";

/** The override token that waives {@link LOCAL_PAGE_PATH_CODE}, recorded by the door whenever it is used. */
export const LOCAL_PAGE_PATH_OVERRIDE = "answer.local-page-path:v1";

/** The override token that waives {@link MARKDOWN_FIRST_CODE}, recorded by the door whenever it is used. */
export const MARKDOWN_FIRST_OVERRIDE = "answer.markdown-first:v1";

/** Characters a composer writes around a path that are not part of it. Stripped from both ends. */
const PUNCTUATION = new Set([".", ",", ";", ":", ")", "(", "<", ">", '"', "'", "`", "[", "]", "*"]);

/** The roots that make a token a path on THIS machine rather than a route inside somebody's web app. */
const LOCAL_ROOTS = ["~", "$SLOPWEAVER_HOME", "${SLOPWEAVER_HOME}"] as const;

/** Strip the punctuation a composer wraps a path in, from both ends, without touching its interior. */
function trimPunctuation({ token }: { token: string }): string {
  let start = 0;
  let end = token.length;
  while (start < end && PUNCTUATION.has(token[start]!)) {
    start += 1;
  }
  while (end > start && PUNCTUATION.has(token[end - 1]!)) {
    end -= 1;
  }
  return token.slice(start, end);
}

/**
 * Whether these path segments name a LOCAL page directory rather than some other `pages` path.
 *
 * Three ways to qualify, and each is a case where the path could only ever resolve on one machine: the
 * token is rooted at `~` or the home variable; the segment immediately before `pages` is a dotfile
 * directory (`.slopweaver`); or the path ends in the `<slug>/index.html` shape `../pages/url.ts` defines,
 * which no web route wears by accident. An absolute path under a home directory nobody here can name —
 * `/opt/sw/pages/x` — is outside all three and is deliberately not claimed: the honest failure direction is
 * to miss one, never to refuse an answer that names a real URL path.
 */
function namesLocalPageDirectory({ segments }: { segments: readonly string[] }): boolean {
  const at = segments.indexOf(PAGES_DIRECTORY);
  if (at === -1) {
    return false;
  }
  const slug = segments[at + 1];
  if (slug === undefined || slug.length === 0) {
    return false;
  }
  const rooted = LOCAL_ROOTS.some((root) => segments[0] === root);
  const before = segments[at - 1];
  const underDotfile = before !== undefined && before.length > 1 && before.startsWith(".");
  const endsAtIndex = segments[at + 2] === PAGE_FILENAME && segments.length === at + 3;
  return rooted || underDotfile || endsAtIndex;
}

/**
 * Every path in this text that names a local page on the machine the bot is running on.
 *
 * Deliberately NOT a regex over the path shape. A pattern that walks `[^\s]*\/pages\/` backtracks
 * polynomially and would be refused by `../devLint/redosCheck.ts`, and the pattern this repository DOES
 * carry for local pages (`LOCAL_PAGE_URL_IN_TEXT`) took three Codex passes to stop it swallowing a
 * neighbouring URL. Splitting on whitespace and then on `/` has neither failure mode and reads as what it
 * checks. The `file:///…/pages/<slug>/index.html` form is the one case left to that pattern, which already
 * owns it.
 *
 * @param text the answer's own words, already flattened
 * @returns each distinct path, in first-appearance order
 */
export function localPagePathsInText({ text }: { text: string }): readonly string[] {
  const found = new Set<string>();
  const urls = text.match(LOCAL_PAGE_URL_IN_TEXT);
  if (urls !== null) {
    for (const url of urls) {
      found.add(url);
    }
  }
  for (const raw of text.split(/\s+/u)) {
    const token = trimPunctuation({ token: raw });
    if (token.includes("://") || !token.includes(`/${PAGES_DIRECTORY}/`)) {
      continue;
    }
    const segments = token.split("/").filter((segment) => segment.length > 0);
    const absolute = token.startsWith("/") || LOCAL_ROOTS.some((root) => token.startsWith(`${root}/`));
    if (absolute && namesLocalPageDirectory({ segments })) {
      found.add(token);
    }
  }
  return [...found];
}

/** The visible text of one run, plus a link's URL — a path is as unopenable in an `href` as in prose. */
function textOfRun({ run }: { run: InlineRun }): string {
  if (run.type === "text") {
    return run.text;
  }
  if (run.type === "link") {
    return `${run.label} ${run.url}`;
  }
  return "";
}

/**
 * Every word an answer puts in front of a reader, flattened into one string.
 *
 * Reads the lead, the above-the-fold index and the whole body, because a path is just as unopenable
 * wherever it is written — and the measured failure put its table below the fold, where a check that read
 * only the lead would have passed it.
 *
 * @param answer the composed answer
 * @returns the lead, index and body text, space-joined
 */
export function answerPlainText({ answer }: { answer: AnswerFormAnswer }): string {
  const ofSequences = ({ items }: { items: readonly (readonly InlineRun[])[] }): readonly string[] =>
    items.flatMap((runs) => runs.map((run) => textOfRun({ run })));
  const body = answer.body.flatMap((block) => ofSequences({ items: runSequencesOf({ block }) }));
  return [answer.lead, ...ofSequences({ items: answer.index }), ...body].join(" ");
}

/** Whether a document path is the markdown half of the lane. */
function isMarkdown({ path }: { path: string }): boolean {
  const lowered = path.toLowerCase();
  return lowered.endsWith(".md") || lowered.endsWith(".markdown");
}

/**
 * How this document set reads against "markdown first, html second" — the rule, or the exact way it is
 * broken.
 *
 * A discriminated union rather than a boolean, because the two failures need different words: one says
 * nothing markdown was attached at all, the other that the order puts the rendered file in front of the
 * source. An empty lane is `ok` — this gate is about the documents that ARE attached, and whether one was
 * owed at all is `./coreDeliverableGate.ts`'s question.
 *
 * @internal — exported so a test can name an arm without going through a finding.
 */
export type MarkdownFirstVerdict =
  { readonly kind: "ok" } | { readonly kind: "html-only" } | { readonly kind: "html-before-markdown" };

/**
 * Judge a document list against the lane's markdown-first rule. Pure and total.
 *
 * @param documents the answer's document paths, in attach order
 * @returns the verdict
 */
export function markdownFirstVerdict({ documents }: { documents: readonly string[] }): MarkdownFirstVerdict {
  const firstMarkdown = documents.findIndex((path) => isMarkdown({ path }));
  const firstHtml = documents.findIndex((path) => !isMarkdown({ path }));
  if (firstHtml === -1) {
    return { kind: "ok" };
  }
  if (firstMarkdown === -1) {
    return { kind: "html-only" };
  }
  if (firstHtml < firstMarkdown) {
    return { kind: "html-before-markdown" };
  }
  return { kind: "ok" };
}

/** The finding for a channel answer that hands a room a path only one machine can resolve. */
function localPagePathFindings({
  answer,
  surface,
}: {
  answer: AnswerFormAnswer;
  surface: ReplySurface;
}): readonly DoorFinding[] {
  if (surface === "dm") {
    return [];
  }
  const paths = localPagePathsInText({ text: answerPlainText({ answer }) });
  if (paths.length === 0) {
    return [];
  }
  return [
    {
      code: LOCAL_PAGE_PATH_CODE,
      correction:
        `attach the deliverable instead: put its path in the answer's \`documents\` array (one of ` +
        `${ANSWER_DOCUMENT_EXTENSIONS.join(", ")}) and it is uploaded in this thread with the reply, where ` +
        "everyone in the room can open it. Write the answer to name the ATTACHMENT rather than the path. " +
        `If the path genuinely is the answer — the owner asked where a file landed — waive this with ` +
        `SLOPWEAVER_DOOR_OVERRIDE=${LOCAL_PAGE_PATH_OVERRIDE}.`,
      override: LOCAL_PAGE_PATH_OVERRIDE,
      severity: "warn",
      summary:
        `this answer goes to a channel and hands its readers ${String(paths.length)} path(s) on the machine ` +
        `the bot is running on — ${paths.join(", ")} — which resolve to nothing for anybody else in the thread`,
    },
  ];
}

/** The finding for a document set that leads with html, or carries no markdown at all. */
function markdownFirstFindings({ answer }: { answer: AnswerFormAnswer }): readonly DoorFinding[] {
  const verdict = markdownFirstVerdict({ documents: answer.documents });
  if (verdict.kind === "ok") {
    return [];
  }
  const observed =
    verdict.kind === "html-only"
      ? "this answer attaches html and no markdown"
      : "this answer attaches its html before its markdown";
  return [
    {
      code: MARKDOWN_FIRST_CODE,
      correction:
        "attach the markdown first and the rendered html second — a reader can quote, diff and edit " +
        "markdown in Slack, and can only look at html. If only the html exists, write the markdown beside " +
        `it. For a deliverable that genuinely has no markdown form, waive this with ` +
        `SLOPWEAVER_DOOR_OVERRIDE=${MARKDOWN_FIRST_OVERRIDE}.`,
      override: MARKDOWN_FIRST_OVERRIDE,
      severity: "warn",
      summary: `${observed} — markdown is the preferred form for a deliverable`,
    },
  ];
}

/**
 * Both findings this module owns, in door order.
 *
 * @param answer the composed answer about to be sent
 * @param surface where the reply lands — the local-page half is about a ROOM and exempts a DM entirely
 * @returns the findings, or empty when the answer hands nobody a path and its documents lead with markdown
 */
export function documentDeliverableFindings({
  answer,
  surface,
}: {
  answer: AnswerFormAnswer;
  surface: ReplySurface;
}): readonly DoorFinding[] {
  return [...localPagePathFindings({ answer, surface }), ...markdownFirstFindings({ answer })];
}

/**
 * The document-deliverable gate, ready to compose into the door's gate list.
 *
 * @param answer the composed answer about to be sent
 * @param surface where the reply lands
 * @returns a `DoorGate` reporting a path handed to a room, and a document set that leads with html
 */
export function documentDeliverableGate({
  answer,
  surface,
}: {
  answer: AnswerFormAnswer;
  surface: ReplySurface;
}): DoorGate {
  return () => documentDeliverableFindings({ answer, surface });
}
