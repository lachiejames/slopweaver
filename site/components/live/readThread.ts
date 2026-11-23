/**
 * Readers for the thread panel: a thread as `store around --mode thread --json` prints it, and the held
 * drafts as `queue list --json` prints them. Same discipline as `read.ts` — a row that will not parse refuses
 * the whole reading, so the panel says NOT MEASURED rather than drawing half a thread.
 */

import { bags, bool, isBag, num, str, strings, sub } from "../../lib/bag";
import { isWebUrl } from "../../lib/workspacePlacementAddress";

/** One message of a thread, as the corpus holds it. */
export interface ThreadRecord {
  readonly id: string;
  /** `message` for the root, `comment` for a reply. */
  readonly kind: string;
  /** The name the store resolved, or the raw member id when no person matched. */
  readonly author: string | undefined;
  /** The Slack member id, the join key for a picture. */
  readonly authorNativeId: string | undefined;
  readonly occurredAt: string;
  readonly url: string;
  readonly title: string | undefined;
  /** The text, cut at the chars the read asked for; `bodyChars` says how long it really is. */
  readonly excerpt: string;
  readonly bodyChars: number;
}

/** A thread as one read printed it. */
export interface Thread {
  readonly anchorUrl: string;
  /** `slack/<channel id>`. */
  readonly container: string | undefined;
  readonly records: readonly ThreadRecord[];
  /** What the verb itself says the read cannot see — a reply the sync has not reached, say. */
  readonly limitations: readonly string[];
}

/**
 * Read a `store around --json` payload.
 *
 * @returns the thread, or `undefined` when the payload is not one
 */
export function readThread(payload: unknown): Thread | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const anchor = sub({ bag: payload, key: "anchor" });
  const rows = bags({ bag: payload, key: "records" });
  const limitations = strings({ bag: payload, key: "limitations" });
  if (anchor === undefined || rows === undefined || limitations === undefined) {
    return undefined;
  }
  const anchorUrl = str({ bag: anchor, key: "url" });
  if (anchorUrl === undefined) {
    return undefined;
  }
  const records: ThreadRecord[] = [];
  for (const row of rows) {
    const id = str({ bag: row, key: "id" });
    const kind = str({ bag: row, key: "kind" });
    const occurredAt = str({ bag: row, key: "occurredAt" });
    const url = str({ bag: row, key: "url" });
    const excerpt = str({ bag: row, key: "excerpt" });
    const bodyChars = num({ bag: row, key: "bodyChars" });
    if (
      id === undefined ||
      kind === undefined ||
      occurredAt === undefined ||
      url === undefined ||
      excerpt === undefined ||
      bodyChars === undefined
    ) {
      return undefined;
    }
    records.push({
      author: str({ bag: row, key: "author" }),
      authorNativeId: str({ bag: row, key: "authorNativeId" }),
      bodyChars,
      excerpt,
      id,
      kind,
      occurredAt,
      title: str({ bag: row, key: "title" }),
      url,
    });
  }
  return { anchorUrl, container: str({ bag: anchor, key: "container" }), limitations, records };
}

/** One link a draft cites. */
export interface DraftCitation {
  readonly label: string;
  readonly url: string;
}

/** A reply the door held rather than sent, as `queue list --json` prints one. */
export interface HeldDraft {
  readonly id: string;
  /** `held`, `released` or `dropped` — only `held` is a draft still waiting. */
  readonly state: string;
  readonly tsIso: string;
  readonly channel: string;
  readonly threadTs: string;
  readonly messageTs: string;
  readonly askedBy: string;
  /** The message the draft answers, verbatim. */
  readonly question: string;
  /** Why the door held it. */
  readonly reason: string;
  readonly permalink: string | undefined;
  /** The one-line answer the draft leads with, when it carries one. */
  readonly lead: string | undefined;
  /** The body flattened to text: paragraphs apart, a citation as its label, code as itself. */
  readonly text: string;
  readonly citations: readonly DraftCitation[];
}

/**
 * Flatten a draft body — paragraphs of runs — to the text a composer holds.
 *
 * @returns the text, or `undefined` when a run is a shape this does not read
 */
function textOf({
  body,
  labels,
}: {
  body: readonly Record<string, unknown>[];
  labels: ReadonlyMap<string, string>;
}): string | undefined {
  const paragraphs: string[] = [];
  for (const paragraph of body) {
    const runs = bags({ bag: paragraph, key: "runs" });
    if (runs === undefined) {
      return undefined;
    }
    let line = "";
    for (const run of runs) {
      const type = str({ bag: run, key: "type" });
      if (type === "text") {
        const text = str({ bag: run, key: "text" });
        if (text === undefined) {
          return undefined;
        }
        line += text;
        continue;
      }
      if (type === "citation") {
        const citationId = str({ bag: run, key: "citationId" });
        if (citationId === undefined) {
          return undefined;
        }
        const label = labels.get(citationId);
        if (label === undefined) {
          return undefined;
        }
        line += label;
        continue;
      }
      return undefined;
    }
    paragraphs.push(line);
  }
  return paragraphs.join("\n\n");
}

/**
 * Read a `queue list --json` payload.
 *
 * @returns every item, whatever its state, or `undefined` when the payload is not one
 */
export function readHeldDrafts(payload: unknown): readonly HeldDraft[] | undefined {
  if (!isBag(payload)) {
    return undefined;
  }
  const items = bags({ bag: payload, key: "items" });
  if (items === undefined) {
    return undefined;
  }
  const out: HeldDraft[] = [];
  for (const item of items) {
    const id = str({ bag: item, key: "id" });
    const state = str({ bag: item, key: "state" });
    const tsIso = str({ bag: item, key: "tsIso" });
    const held = sub({ bag: item, key: "held" });
    if (id === undefined || state === undefined || tsIso === undefined || held === undefined) {
      return undefined;
    }
    const channel = str({ bag: held, key: "channel" });
    const threadTs = str({ bag: held, key: "threadTs" });
    const messageTs = str({ bag: held, key: "messageTs" });
    const askedBy = str({ bag: held, key: "askedBy" });
    const question = str({ bag: held, key: "question" });
    const reason = str({ bag: held, key: "reason" });
    const draft = sub({ bag: held, key: "draft" });
    if (
      channel === undefined ||
      threadTs === undefined ||
      messageTs === undefined ||
      askedBy === undefined ||
      question === undefined ||
      reason === undefined ||
      draft === undefined
    ) {
      return undefined;
    }
    const body = bags({ bag: draft, key: "body" });
    const cited = bags({ bag: draft, key: "citations" });
    if (body === undefined || cited === undefined) {
      return undefined;
    }
    const citations: DraftCitation[] = [];
    const labels = new Map<string, string>();
    for (const citation of cited) {
      const citationId = str({ bag: citation, key: "id" });
      const label = str({ bag: citation, key: "label" });
      const url = str({ bag: citation, key: "url" });
      if (citationId === undefined || label === undefined || url === undefined) {
        return undefined;
      }
      labels.set(citationId, label);
      citations.push({ label, url });
    }
    const text = textOf({ body, labels });
    if (text === undefined) {
      return undefined;
    }
    // The permalink places the reply (`site/lib/registerPlacementDirect.ts`), so one present and unreadable refuses
    // the reading rather than reading as absent and hiding an address that may contradict the register.
    const answering = sub({ bag: draft, key: "answering" });
    if (answering === undefined && draft["answering"] != null) {
      return undefined;
    }
    let permalink: string | undefined;
    if (answering !== undefined) {
      const linked = answering["permalink"];
      if (linked != null && (typeof linked !== "string" || !isWebUrl({ value: linked }))) {
        return undefined;
      }
      permalink = str({ bag: answering, key: "permalink" });
    }
    out.push({
      askedBy,
      channel,
      citations,
      id,
      lead: str({ bag: draft, key: "lead" }),
      messageTs,
      permalink,
      question,
      reason,
      state,
      text,
      threadTs,
      tsIso,
    });
  }
  return out;
}

/**
 * Whether a `queue list` item is still a draft waiting, rather than one released or dropped.
 *
 * @returns true for state `held`
 */
export function isHeld({ draft }: { draft: HeldDraft }): boolean {
  return draft.state === "held";
}

/**
 * Whether a payload's `ok` reads true — the shape both routes share for their people half.
 *
 * @returns true only for a literal `true`
 */
export function okOf({ bag }: { bag: Record<string, unknown> }): boolean {
  return bool({ bag, key: "ok" }) === true;
}
