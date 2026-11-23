/**
 * The Checks of a C3 description read back, in either layout (`./render.ts`): layout 1's run of paragraphs, or
 * layout 2's one list of base checks then labelled groups. Every read declines rather than guesses; `./parse.ts`
 * proves the whole body by re-rendering it.
 */
import { parseContent } from "./parseContent.js";
import { allOf, between, type Cursor, listRows, take, takeLiteral } from "./parseCursor.js";
import { headingsOf } from "./render.js";
import type { BodyLayout, CheckGroup, Content } from "./types.js";

/** One labelled group row: `<li>label<ul><li>check</li>…</ul></li>`, every `<` inside content escaped. */
function groupOf({ interior }: { interior: string }): CheckGroup | undefined {
  const open = interior.indexOf("<ul>");
  if (open < 0 || !interior.endsWith("</ul>")) {
    return undefined;
  }
  const label = parseContent({ source: interior.slice(0, open) });
  const inner = interior.slice(open + "<ul>".length, -"</ul>".length);
  if (label === undefined || !inner.startsWith("<li>") || !inner.endsWith("</li>")) {
    return undefined;
  }
  const items = allOf({
    read: (source) => parseContent({ source }),
    rows: inner.slice("<li>".length, -"</li>".length).split("</li><li>"),
  });
  return items === undefined ? undefined : { items, label };
}

/** Layout 2's Checks list: base checks first, then labelled groups. */
function checksListOf({
  block,
}: {
  block: string | undefined;
}): { checks: readonly Content[]; checkGroups: readonly CheckGroup[] } | undefined {
  const rows = listRows({ block, tag: "ul" });
  if (rows === undefined) {
    return undefined;
  }
  const checks: Content[] = [];
  const checkGroups: CheckGroup[] = [];
  for (const row of rows) {
    if (!row.startsWith("<li>") || !row.endsWith("</li>")) {
      return undefined;
    }
    const interior = row.slice("<li>".length, -"</li>".length);
    if (interior.includes("<ul>")) {
      const group = groupOf({ interior });
      if (group === undefined) {
        return undefined;
      }
      checkGroups.push(group);
      continue;
    }
    const check = parseContent({ source: interior });
    if (check === undefined) {
      return undefined;
    }
    checks.push(check);
  }
  return { checkGroups, checks };
}

/**
 * The checks between the solution and Not checked: layout 1's paragraphs, or layout 2's one list.
 *
 * @param cursor the main part's blocks, standing after the solution proof; advanced past what is read
 * @param layout which layout's headings and shape the checks are read in
 * @returns the base checks and the groups, or undefined when a block reads as neither
 */
export function checksOf({
  cursor,
  layout,
}: {
  cursor: Cursor;
  layout: BodyLayout;
}): { checks: readonly Content[]; checkGroups: readonly CheckGroup[] } | undefined {
  const headings = headingsOf({ layout });
  if (headings.checksHeading !== undefined) {
    if (!takeLiteral({ cursor, literal: headings.checksHeading })) {
      return { checkGroups: [], checks: [] };
    }
    return checksListOf({ block: take({ cursor }) });
  }
  const checks: Content[] = [];
  while (cursor.at < cursor.blocks.length && cursor.blocks[cursor.at] !== headings.notCheckedHeading) {
    const check = between({ block: take({ cursor }), close: "</p>", open: "<p>" });
    if (check === undefined) {
      return undefined;
    }
    checks.push(check);
  }
  return { checkGroups: [], checks };
}
