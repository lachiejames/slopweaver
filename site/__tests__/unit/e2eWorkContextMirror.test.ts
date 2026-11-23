/*
 * The context `desktop e2e --context` sets and the context the console reads are one value set.
 *
 * `src/desktop/e2eWorkContext.ts` restates `site/lib/workContext.ts`'s contexts, storage key and address parameter
 * because a file under `src/` may not import one under `site/`; this file, in the lane that reaches both roots, holds
 * them equal so a rename on either side fails here rather than leaving a test instance in the wrong context.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  E2E_CONTEXT_STORAGE_KEY,
  E2E_DRAWN_CONTEXT_ATTRIBUTE,
  E2E_WORK_CONTEXTS,
  e2eContextQueuePath,
  e2eDrawnContextSelector,
  isE2eWorkContext,
} from "../../../src/desktop/e2eWorkContext";
import {
  CONTEXT_PARAM,
  CONTEXT_STORAGE_KEY,
  contextAddressedBy,
  isWorkContext,
  WORK_CONTEXTS,
} from "../../lib/workContext";

describe("the e2e context mirror", () => {
  it("names the console's two contexts and its storage key", () => {
    expect(E2E_WORK_CONTEXTS.length).toBeGreaterThan(0);
    expect([...E2E_WORK_CONTEXTS].toSorted()).toEqual([...WORK_CONTEXTS].toSorted());
    expect(E2E_CONTEXT_STORAGE_KEY).toBe(CONTEXT_STORAGE_KEY);
    expect(["work", "slopweaver", "acme", undefined].map((value) => isE2eWorkContext(value))).toEqual(
      ["work", "slopweaver", "acme", undefined].map((value) => isWorkContext(value)),
    );
  });

  it("addresses a Queue the console reads in the context asked for, whatever storage holds", () => {
    expect(E2E_WORK_CONTEXTS.length).toBeGreaterThan(0);
    for (const context of E2E_WORK_CONTEXTS) {
      const path = e2eContextQueuePath({ context });
      expect([path.startsWith(`/queue?${CONTEXT_PARAM}=`), contextAddressedBy({ path, stored: "work" })]).toEqual([
        true,
        context,
      ]);
    }
  });

  // The Queue has no page head, so a selector matching only the page chip waited 30s for an element the Queue never
  // draws and walked nothing. This lane cannot render a component (the console's `@/` alias is the site's own), so the
  // chain is held link by link: the shell every console page renders inside mounts the switcher, and the switcher's
  // root element carries the attribute the selector names.
  it("selects the drawn context by the attribute the sidebar switcher's root carries on every page", () => {
    const shell = readFileSync(new URL("../../components/console/Shell.tsx", import.meta.url), "utf8");
    const switcher = readFileSync(new URL("../../components/console/ContextSwitcher.tsx", import.meta.url), "utf8");
    const root = /export function ContextSwitcher\(\)[\s\S]*?return \(\s*(<div[^>]*>)/.exec(switcher)![1];
    expect(shell).toContain("<ContextSwitcher />");
    expect(root).toContain(` ${E2E_DRAWN_CONTEXT_ATTRIBUTE}={context}`);
    expect(e2eDrawnContextSelector({ context: "slopweaver" })).toBe('[data-context="slopweaver"]');
  });
});
