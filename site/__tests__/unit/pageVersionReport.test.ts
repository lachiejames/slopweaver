/*
 * A served document's version report, run as the exact script it is served as, against a fake frame and parent: it
 * reports once, again on its parent's ask and on no one else's, never from a top-level tab, and no value can close
 * the element it is served in.
 */
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

import { PAGE_VERSION_ASK, PAGE_VERSION_REPORT } from "../../lib/pageVersionReply";
import { pageVersionReporter, versionReportElement, withVersionReport } from "../../lib/pageVersionReport";

const VERSION = "a".repeat(64);

/** The message the script is handed, as a listener receives it. */
type Delivered = { source: unknown; data: unknown };

/** Run the reporter in a frame (or, `topLevel`, a tab of its own) and hand back what it posted and how to message it. */
function framed({ topLevel = false }: { topLevel?: boolean } = {}): {
  posts: unknown[];
  parent: object;
  deliver: (message: Delivered) => void;
  listening: () => number;
} {
  const posts: unknown[] = [];
  const listeners: ((message: Delivered) => void)[] = [];
  const parent = {
    // A rest list, as the browser's own `postMessage(data, origin)` arrives; read back across the context as plain data.
    postMessage: (...args: unknown[]) => {
      posts.push(JSON.parse(JSON.stringify(args)));
    },
  };
  const window: { parent: object; addEventListener: (...args: unknown[]) => void } = {
    addEventListener: (...args) => {
      const [type, listener] = args;
      if (type === "message" && typeof listener === "function") {
        listeners.push((message) => {
          listener(message);
        });
      }
    },
    parent,
  };
  if (topLevel) {
    window.parent = window;
  }
  runInNewContext(pageVersionReporter({ slug: "alpha", version: VERSION }), { window });
  return {
    deliver: (message) => {
      for (const listener of listeners) {
        listener(message);
      }
    },
    listening: () => listeners.length,
    parent,
    posts,
  };
}

const REPORT = [{ kind: PAGE_VERSION_REPORT, slug: "alpha", version: VERSION }, "*"];

describe("pageVersionReporter", () => {
  it("reports the document's page and version to its parent once, as it runs", () => {
    expect(framed().posts).toEqual([REPORT]);
  });

  it("reports again when its parent asks", () => {
    const frame = framed();
    frame.deliver({ data: { kind: PAGE_VERSION_ASK }, source: frame.parent });
    expect(frame.posts).toEqual([REPORT, REPORT]);
  });

  it("answers no ask from another window, no other kind and no empty message", () => {
    const frame = framed();
    frame.deliver({ data: { kind: PAGE_VERSION_ASK }, source: {} });
    frame.deliver({ data: { kind: "other" }, source: frame.parent });
    frame.deliver({ data: null, source: frame.parent });
    frame.deliver({ data: PAGE_VERSION_ASK, source: frame.parent });
    expect(frame.posts).toEqual([REPORT]);
  });

  it("in a tab of its own, posts nothing and listens for nothing", () => {
    const tab = framed({ topLevel: true });
    expect([tab.posts, tab.listening()]).toEqual([[], 0]);
  });

  it("never lets a value close the element it is served in", () => {
    expect(pageVersionReporter({ slug: "a</script><b>", version: VERSION }).includes("<")).toBe(false);
  });
});

describe("withVersionReport", () => {
  it("appends the report's element after the document's last byte, leaving every byte before it", () => {
    const body = Buffer.from([0x3c, 0x70, 0x3e, 0xff]);
    expect(withVersionReport({ body, slug: "alpha", version: VERSION })).toEqual(
      Buffer.concat([body, Buffer.from(versionReportElement({ slug: "alpha", version: VERSION }), "utf8")]),
    );
  });

  it("wraps the reporter in its own marked element", () => {
    expect(versionReportElement({ slug: "alpha", version: VERSION })).toBe(
      `<script data-sw-page-version>${pageVersionReporter({ slug: "alpha", version: VERSION })}</script>`,
    );
  });
});
