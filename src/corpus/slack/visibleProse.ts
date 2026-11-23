/**
 * The VISIBLE-PROSE flattener: a Slack message's `blocks` and `attachments` → the ordered prose fragments a
 * person actually reads, ready to append to a record's searchable `text`.
 *
 * It exists because the projection used to build `text` from the top-level `text` field alone, and Slack apps
 * routinely leave that EMPTY and put everything visible in Block Kit or an attachment. Measured on a real
 * corpus: about a quarter of the message/comment records carried prose that never reached the index, and thousands were
 * indexed as the literal string `(empty message in #channel)` while their content sat in `raw`.
 *
 * ## The governing rule
 *
 * **Index strings a person can read or a screen reader would announce; exclude layout and transport metadata.**
 * Every inclusion and exclusion below follows from that one sentence rather than from a list of special cases:
 * a button surrenders its label but not its `action_id`, a divider has no language at all, and an image's
 * `alt_text` IS its prose.
 *
 * ## Why explicit slots, and never a walk over arbitrary keys
 *
 * Enumerating every string in the subtree looks strictly more complete and is strictly worse. The recorded
 * work-object unfurl carries `product_icon.fallback`, `app_icons.image_128.alt_text` and
 * `actions.block_payload.service_id` — so a key-walking implementation indexes icon descriptions and service
 * ids as though they were something a person wrote. Naming the slots is what keeps machine data out.
 *
 * ## Determinism is functional, not cosmetic
 *
 * The emitted order becomes part of `text`, and `text` feeds the bronze dedup fingerprint, BM25 term
 * frequencies, the vector content hash and distil's batch hashes. Identical input MUST give byte-identical
 * output, which is why every container is visited in array order and every slot in a fixed order.
 */

import { appendAll } from "../../lib/arrays.js";
import { isRecord } from "../../lib/parsers.js";
import { channelMentionText, resolveSpecialRef, userMentionText } from "./refLabels.js";
import { INVISIBLE, invisible, push, richLeaf, str } from "./visibleProseLeaves.js";

/** How deep the block walk may go. See {@link fromBlock} — a bound for totality, not a content decision. */
const MAX_BLOCK_DEPTH = 12;

/**
 * The id→name maps used to resolve Slack markup.
 *
 * `userNames` and `channelNames` are built once per refresh from that refresh's own reads. `usergroupHandles`
 * is built differently — from the structure rows a PREVIOUS refresh wrote (`silver/slackUsergroups.ts`) —
 * because this crawl's own usergroup hydration has not run yet when the message projection starts, and a map
 * built from a half-finished pass would name some groups and not others within one projection.
 *
 * It is OPTIONAL because a caller whose store holds no usergroups must still resolve users and channels. An
 * absent map resolves a bare usergroup mention to the generic `@group` exactly as before, which is a visible
 * non-answer rather than a wrong name.
 */
export interface SlackNameMaps {
  readonly userNames: Readonly<Record<string, string>>;
  readonly channelNames: Readonly<Record<string, string>>;
  /** Usergroup id (`S…`) → its `@`-less handle, from the corpus's own structure rows. */
  readonly usergroupHandles?: Readonly<Record<string, string>>;
}

/**
 * Resolve Slack markup to human-readable text: `<@Uxxx>`→`@Name`, `<#Cxxx>`→`#channel`, `<url|label>`→
 * `label`, bare `<url>`→`url`, `<!here>`→`@here`, bare `<!subteam^Sxxx>`→`@handle` from the corpus's map (or
 * `@group` when it has never seen that group). On an id miss the pipe
 * label is used, else a generic `@user`/`#channel`/`@group` — an opaque `Uxxxx`/`Cxxxx`/`Sxxxx` is NEVER left
 * in the text. Pure.
 *
 * The reference body excludes `<` as well as `>`, which matters three times. Slack never nests `<` inside a
 * reference, so nothing valid is lost, and:
 *
 * - It **stops the contract above being broken by ordinary prose.** With `[^>]+` a stray `<` (`<48h`, `<1%`,
 *   `Promise<T>`) opens a match that runs to the next `>` anywhere in the message. The body it captures
 *   (`48h, ping <@Uxxx`) begins with none of the sigils, so it is returned verbatim — the prose between is
 *   destroyed and the opaque id it swallowed lands in stored text.
 * - It makes the scan **linear**. With `[^>]+` a run of `<` with no closing `>` re-scans to end-of-input from
 *   every start position, measured at ~2.8s for one message at Slack's documented block and field limits.
 * - Because a match can no longer span a nested `<`, the **innermost** reference is the one resolved, so
 *   `<<@Uxxx>>` yields `<@Name>` rather than leaving the raw id behind.
 *
 * @param text the raw message/comment text
 * @param maps the id→name maps from the fetch edge
 * @returns the text with all markup resolved
 */
export function resolveSlackMarkup({ text, maps }: { text: string; maps: SlackNameMaps }): string {
  return text.replace(/<([^<>]+)>/g, (_match, inner: string) => {
    const pipe = inner.indexOf("|");
    const ref = pipe === -1 ? inner : inner.slice(0, pipe);
    const label = pipe === -1 ? undefined : inner.slice(pipe + 1);
    if (ref.startsWith("@")) {
      return `@${userMentionText({ name: maps.userNames[ref.slice(1)] ?? label })}`;
    }
    if (ref.startsWith("#")) {
      return `#${channelMentionText({ name: maps.channelNames[ref.slice(1)] ?? label })}`;
    }
    if (ref.startsWith("!")) {
      return resolveSpecialRef({ label, ref, usergroupHandles: maps.usergroupHandles });
    }
    // A bare `<url>` has no pipe label, and the URL itself is what Slack shows.
    if (label === undefined) {
      return ref;
    }
    return label;
  });
}

/** The array at `value`, or empty — Slack omits a container rather than sending `[]`. Pure. */
function arr({ value }: { value: unknown }): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * A rich-text container flattened into ONE fragment per paragraph-like node, so inline adjacency survives:
 * a sentence broken into text/link/emoji leaves reads back as a sentence rather than as three fragments.
 */
function richContainer({
  node,
  out,
  depth,
  seen,
}: {
  node: Record<string, unknown>;
  out: string[];
  depth: number;
  seen: Set<object>;
}): void {
  // Bounded for the same reason as `fromBlock`, and separately: a `rich_text` block dispatches STRAIGHT here,
  // so a depth cap that lived only in `fromBlock` would leave this self-recursion unguarded.
  if (depth > MAX_BLOCK_DEPTH) {
    return;
  }
  const inline: string[] = [];
  for (const child of arr({ value: node["elements"] })) {
    if (!isRecord(child)) {
      continue;
    }
    if (Array.isArray(child["elements"])) {
      // The identity check belongs HERE, on the child about to be entered — not on the node this call was
      // handed, which a caller has already registered. A node whose `elements` hold copies of itself is the
      // shape that would otherwise fan out 7^depth times.
      if (seen.has(child)) {
        continue;
      }
      seen.add(child);
      richContainer({ depth: depth + 1, node: child, out, seen });
    } else {
      richLeaf({ node: child, out: inline });
    }
  }
  const joined = inline.join("").trim();
  if (!invisible({ text: joined })) {
    out.push(joined);
  }
}

/** A table row: every cell in left-to-right order, joined so the row's association survives as one fragment. */
function tableRows({
  node,
  out,
  depth,
  seen,
}: {
  node: Record<string, unknown>;
  out: string[];
  depth: number;
  seen: Set<object>;
}): void {
  for (const row of arr({ value: node["rows"] })) {
    const cells: string[] = [];
    for (const cell of arr({ value: row })) {
      if (isRecord(cell) && !seen.has(cell)) {
        seen.add(cell);
        richContainer({ depth: depth + 1, node: cell, out: cells, seen });
      }
    }
    const rowText = cells.join(" | ");
    if (cells.length > 0 && !invisible({ text: rowText })) {
      out.push(rowText);
    }
  }
}

/**
 * One Block Kit block. An unknown or absent `type` is NOT rejected — it reads the same visible slots, which is
 * what lets untyped legacy attachment bodies through the one visitor instead of needing a second.
 */
function fromBlock({
  block,
  out,
  seen,
  depth = 0,
}: {
  block: unknown;
  out: string[];
  seen: Set<object>;
  depth?: number;
}): void {
  // Block Kit nests a handful of levels at most (block → element → accessory), so this ceiling cannot truncate
  // a real payload. It is here to make the function TOTAL rather than to shape output: `accessory` and
  // `elements` both recurse, so a self-referential object — which a hand-built caller can construct even
  // though `JSON.parse` cannot produce one — would otherwise recurse until the stack died.
  if (!isRecord(block) || depth > MAX_BLOCK_DEPTH || seen.has(block)) {
    return;
  }
  // The visited set is what actually makes a cyclic payload terminate, and it is GLOBAL to the call rather
  // than path-local: a node is entered at most once, so total work is linear in DISTINCT nodes. Path-local
  // tracking is not enough — six nodes in a ring with fifty parallel edges each explores 50^6 paths before the
  // cycle is even detected. The depth cap alone is no help either, since the blow-up happens far below it.
  //
  // Visiting a repeated node only once costs nothing observable, because identical content would be collapsed
  // by the dedup below anyway. That is what makes the cheap bound the correct one here.
  seen.add(block);
  const type = str({ value: block["type"] });
  if (type === "divider") {
    return;
  }
  if (type === "rich_text") {
    richContainer({ depth, node: block, out, seen });
    return;
  }
  if (type === "table") {
    tableRows({ depth, node: block, out, seen });
    return;
  }
  blockSlots({ block, depth, out, seen });
}

/**
 * The visible slots shared by every non-specialised block, in a fixed order. Split out from
 * {@link fromBlock} so the dispatcher stays inside the repo's cognitive-complexity ceiling, and so the slot
 * ORDER — which becomes part of `text`, and therefore part of the bronze fingerprint — is readable in one place.
 */
function blockSlots({
  block,
  out,
  depth,
  seen,
}: {
  block: Record<string, unknown>;
  out: string[];
  depth: number;
  seen: Set<object>;
}): void {
  for (const slot of ["text", "title", "label", "description", "alt_text"]) {
    push({ out, value: block[slot] });
  }
  for (const field of arr({ value: block["fields"] })) {
    push({ out, value: field });
  }
  for (const element of arr({ value: block["elements"] })) {
    fromBlock({ block: element, depth: depth + 1, out, seen });
  }
  fromBlock({ block: block["accessory"], depth: depth + 1, out, seen });
}

/**
 * A work-object unfurl's visible layout. Only the four prose slots and the field labels are read;
 * `product_icon`, field images, `actions` and the `layout_type`/`field_type` discriminators are decoration and
 * transport, and reading them would put icon alt-text into the search index.
 */
function fromWorkObject({ attachment, out }: { attachment: Record<string, unknown>; out: string[] }): void {
  for (const child of arr({ value: attachment["children"] })) {
    const expanded = expandedLayoutOf({ child });
    if (expanded !== undefined) {
      fromExpandedLayout({ expanded, out });
    }
  }
}

/** The `work_object_entity.layouts.expanded` node of one attachment child, when the whole path is present. */
function expandedLayoutOf({ child }: { child: unknown }): Record<string, unknown> | undefined {
  if (!isRecord(child)) {
    return undefined;
  }
  const entity = child["work_object_entity"];
  if (!isRecord(entity)) {
    return undefined;
  }
  const layouts = entity["layouts"];
  if (!isRecord(layouts)) {
    return undefined;
  }
  const expanded = layouts["expanded"];
  return isRecord(expanded) ? expanded : undefined;
}

/** The four prose slots of an expanded work-object layout, then its field labels. Decoration is not read. */
function fromExpandedLayout({ expanded, out }: { expanded: Record<string, unknown>; out: string[] }): void {
  for (const slot of ["header_title", "title", "subtitle", "hover_subtitle"]) {
    push({ out, value: expanded[slot] });
  }
  const fields = expanded["fields"];
  if (!isRecord(fields)) {
    return;
  }
  for (const element of arr({ value: fields["elements"] })) {
    if (isRecord(element)) {
      push({ out, value: element["label"] });
    }
  }
}

/** Every nested Block Kit array an attachment can carry: its own `blocks`, and `message_blocks[].message.blocks`. */
function attachmentBlocks({
  attachment,
  out,
  seen,
}: {
  attachment: Record<string, unknown>;
  out: string[];
  seen: Set<object>;
}): void {
  for (const block of arr({ value: attachment["blocks"] })) {
    fromBlock({ block, out, seen });
  }
  // `message_blocks` nests the blocks TWO keys down, under `.message.blocks` — an implementation that reads
  // `message_blocks` as a block array finds nothing at all, silently.
  for (const wrapper of arr({ value: attachment["message_blocks"] })) {
    if (!isRecord(wrapper)) {
      continue;
    }
    const message = wrapper["message"];
    if (isRecord(message)) {
      for (const block of arr({ value: message["blocks"] })) {
        fromBlock({ block, out, seen });
      }
    }
  }
}

/**
 * Whether an attachment `fields[]` entry is the legacy `{ title, value }` prose shape, so its `value` is
 * something a person reads rather than a payload.
 *
 * Testing for an absent `action_id` alone is not enough: an interactive element identifies itself by `type`
 * and need not carry an `action_id`, and its `value` is an opaque token. So a value is prose only when the
 * entry names no action AND is either untyped (the legacy shape) or typed as text composition.
 */
function proseField({ field }: { field: Record<string, unknown> }): boolean {
  if (field["action_id"] !== undefined) {
    return false;
  }
  const type = str({ value: field["type"] });
  return type === undefined || type === "mrkdwn" || type === "plain_text";
}

/**
 * One attachment. `fallback` is deliberately LAST and conditional: it is a plain-text restatement of the whole
 * attachment, so emitting it alongside the richer fields would double the body. It is used only when nothing
 * richer was found, decided from the raw candidates BEFORE the caller's global dedup runs.
 */
function fromAttachment({ attachment, out, seen }: { attachment: unknown; out: string[]; seen: Set<object> }): void {
  if (!isRecord(attachment)) {
    return;
  }
  const richer: string[] = [];
  attachmentBlocks({ attachment, out: richer, seen });
  for (const slot of ["pretext", "author_name", "title", "text"]) {
    push({ out: richer, value: attachment[slot] });
  }
  for (const field of arr({ value: attachment["fields"] })) {
    if (isRecord(field)) {
      push({ out: richer, value: field["title"] });
      if (proseField({ field })) {
        push({ out: richer, value: field["value"] });
      }
    }
  }
  push({ out: richer, value: attachment["footer"] });
  fromWorkObject({ attachment, out: richer });
  if (richer.length > 0) {
    // `appendAll`, never `push(...richer)`: the fragment count is sized by the payload, and a spread argument
    // list overflows the stack somewhere near a hundred thousand entries. The unbounded-spread gate does not
    // catch this one, because it only inspects modules that read from disk.
    appendAll({ from: richer, into: out });
    return;
  }
  push({ out, value: attachment["fallback"] });
}

/**
 * The comparison key: edges trimmed, internal whitespace collapsed. It does NOT resolve markup, because both
 * sides of every comparison are resolved EXACTLY ONCE before reaching here.
 *
 * Mention TOKENS are collapsed to a single sentinel and mrkdwn STRUCTURAL markers — emphasis, code, quote and
 * bullet — are stripped, so the key does not depend on how a mention, emphasis or block quote is REPRESENTED — top-level mrkdwn spells bold with asterisks while the
 * structured leaf carries `style: { bold: true }`, and the two must still compare equal.
 * That is load-bearing rather than tidy: Slack sends `<#C1|releases>` in `text` (a label the resolver uses) but
 * the structured rich-text leaf carries only `C1`, so with no channel map the two render as `#releases` and
 * `#channel`. Comparing the rendered forms would call Slack's own duplicate of a message a NEW fragment and
 * append a near-copy to the record, doubling its shared BM25 term frequencies.
 *
 * That "exactly once" matters and is easy to get wrong. `resolveSlackMarkup` is a single non-recursive pass, so
 * nested markup resolves innermost-first: `<<@U1>>` becomes `<@Ada>`. An earlier version resolved the
 * candidate here and ALSO resolved the caller's already-resolved parts, so the two sides were resolved a
 * different number of times — the same prose produced two different keys, the fragment escaped dedup, and
 * re-projecting the record appended it again on every pass. The `[@#][^\s]+` normalisation below is what makes
 * that safe regardless of how many times a mention was resolved.
 */
function key({ text }: { text: string }): string {
  return text
    .replace(INVISIBLE, " ")
    .replace(/[*_~`>•]/g, "")
    .replace(/[@#][^\s]+/g, "@")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a usergroup id that reached this point still spelled out, and fall back to the same generic a
 * structured `usergroup` leaf renders.
 *
 * {@link resolveSlackMarkup} now handles a bare `<!subteam^ID>` itself, so this is no longer the only line
 * standing between an opaque workspace id and the index — it is kept as a post-pass because text can also
 * arrive here ALREADY carrying a literal `@subteam^ID` from a source this walker never resolved. It takes
 * the same map for the same reason that pass does: the two must not disagree about the same id, which
 * they would the moment one of them could name a group and the other could not.
 *
 * @param text the resolved prose
 * @param usergroupHandles the corpus's id→handle map, when there is one
 * @returns the prose with every remaining usergroup id named or genericised
 */
function withoutUsergroupIds({
  text,
  usergroupHandles,
}: {
  text: string;
  usergroupHandles: Readonly<Record<string, string>> | undefined;
}): string {
  return text.replace(/@subteam\^([A-Za-z0-9]+)/g, (_match, id: string) => {
    const handle = usergroupHandles?.[id];
    return handle === undefined ? "@group" : `@${handle}`;
  });
}

/**
 * The visible prose of a Slack message that is NOT already present in the text assembled for its record.
 *
 * Fragments are emitted in a fixed order — `raw.blocks` in array order, then `raw.attachments` in array order,
 * each container's slots in the order documented on the helpers above — and each is compared, markup-resolved
 * and whitespace-normalised, against everything already seen. Comparison is by CONTAINMENT rather than
 * equality (a card body quoted inside the message text is a duplicate, not a new fragment), and the seen set
 * grows as fragments are emitted so the same prose arriving via a block and again via an attachment is kept
 * once. Resolution happens BEFORE comparison: comparing raw `<@U123>` against a resolved `@Ada` would classify
 * identical prose as new, which is what made an earlier measurement of this defect overstate it by thousands
 * of records.
 *
 * The returned strings keep their source whitespace — only the comparison key is normalised.
 *
 * @param raw the message's raw Slack payload (absent ⇒ nothing to recover)
 * @param maps the id→name maps used to resolve markup before comparing
 * @param dedupeAgainst the text parts already assembled for this record (resolved text, summaries)
 * @returns the recovered fragments, in emission order, none duplicating `dedupeAgainst` or each other
 */
export function flattenSlackVisibleProse({
  raw,
  maps,
  dedupeAgainst,
}: {
  raw: Readonly<Record<string, unknown>> | undefined;
  maps: SlackNameMaps;
  dedupeAgainst: readonly string[];
}): readonly string[] {
  // `isRecord`, not `=== undefined`: the declared type forbids anything else, but `raw` originates as parsed
  // JSON and `JSON.parse` can yield `null`, which would throw on the first property read.
  if (!isRecord(raw)) {
    return [];
  }
  const candidates: string[] = [];
  // ONE visited set for the whole payload, created here rather than defaulted inside the walker. A default
  // parameter is evaluated per CALL, so `blocks: Array(n).fill(sameBlock)` would hand each top-level entry a
  // fresh set and walk the shared subtree n times over.
  const seen = new Set<object>();
  for (const block of arr({ value: raw["blocks"] })) {
    fromBlock({ block, out: candidates, seen });
  }
  for (const attachment of arr({ value: raw["attachments"] })) {
    fromAttachment({ attachment, out: candidates, seen });
  }
  // The caller's parts arrive ALREADY resolved, so they are only normalised. Each candidate is resolved
  // exactly once, and that one resolved string is used for BOTH the comparison and the emitted value — so the
  // two sides of every comparison have had the same number of resolution passes applied.
  //
  // Two different tests do the deduplicating, and the split is deliberate.
  //
  // Against the text ALREADY ASSEMBLED for this record, the test is CONTAINMENT: a card body the message text
  // already quotes is a duplicate, not new prose. Those parts are tested one at a time rather than joined,
  // because a candidate straddling the boundary between two unrelated parts is a duplicate of neither, and a
  // joined haystack would match it and silently drop real prose.
  //
  // Against fragments ALREADY EMITTED, the test is set membership. Containment there would be quadratic in the
  // fragment count, which an attachment carrying a very large block array turns into minutes. The cost is that
  // a fragment which is a strict substring of an EARLIER fragment survives — a title repeated inside a body,
  // say — which is a little redundancy rather than lost or wrong text, and is the right side to err on.
  const assembled = dedupeAgainst.map((part) => key({ text: part })).filter((part) => part.length > 0);
  const emitted = new Set<string>();
  const kept: string[] = [];
  for (const candidate of candidates) {
    const resolved = resolveSlackMarkup({ maps, text: candidate });
    const normalised = key({ text: resolved });
    // Invisibility is judged on the RESOLVED value: `<https://x|…>` is visible as markup, while the label it
    // resolves to may be a single zero-width character.
    if (normalised.length === 0 || invisible({ text: resolved }) || emitted.has(normalised)) {
      continue;
    }
    if (assembled.some((part) => part.includes(normalised))) {
      continue;
    }
    kept.push(withoutUsergroupIds({ text: resolved, usergroupHandles: maps.usergroupHandles }).trim());
    emitted.add(normalised);
  }
  return kept;
}
