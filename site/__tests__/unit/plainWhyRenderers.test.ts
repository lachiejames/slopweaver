/*
 * Every other page surface a failure reaches says it plainly with the raw message beneath, never verbatim above the
 * fold: a secret paste's refusal, an Alignment act's failed pull lookup, the voice stage's failure note and a tool
 * card's error, each through `PlainWhy`; the call card's one truncated line through `plainReasonOf`, the raw on its
 * hover. The voice session's own lines follow: a refused relay or tool row, a refused draft edit, a
 * refused device switch's caught reason and a failure toast's reason, each folded only where its state says it failed,
 * none drawing its raw value. The site lane renders no component, so this reads each
 * file with the TypeScript parser and pins the shape, and pins the exact reading of the raw values those callers carry.
 * The blind spot: a raw value reached through a component these files draw.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { forEachChild, type LentAnswer, ts, withSourceFile } from "../../../src/lib/tsSyntax.js";
import { plainReasonOf } from "../../lib/plainReason";

/** One component file, parsed and read by `use`, which answers plain data (the tree is only lent to it). */
function readParsed<R>({ path, use }: { path: string; use: (file: ts.SourceFile) => LentAnswer<R> }): LentAnswer<R> {
  const full = join(import.meta.dirname, "../../components", path);
  return withSourceFile({ fileName: full, scriptKind: ts.ScriptKind.TSX, text: readFileSync(full, "utf8"), use });
}

/** Whether a node is a JSX expression drawn as an element's CHILD, such as `{paste.why}` between two tags. */
function isDrawnChild(child: ts.Node): child is ts.JsxExpression {
  return ts.isJsxExpression(child) && ts.isJsxElement(child.parent);
}

/** Every node under a node that satisfies a test, as its source text. */
function textsUnder({ node, test }: { node: ts.Node; test: (child: ts.Node) => boolean }): readonly string[] {
  const found: string[] = [];
  const walk = (child: ts.Node): void => {
    if (test(child)) {
      found.push(child.getText());
    }
    forEachChild({ node: child, visit: walk });
  };
  walk(node);
  return found;
}

/** Every template literal's interpolated expression under a node, as its source text: `${list.failure}` gives `list.failure`. */
function interpolatedUnder({ node }: { node: ts.Node }): readonly string[] {
  const found: string[] = [];
  const walk = (child: ts.Node): void => {
    if (ts.isTemplateSpan(child)) {
      found.push(child.expression.getText());
    }
    forEachChild({ node: child, visit: walk });
  };
  walk(node);
  return found;
}

/**
 * The raw value each surface was found drawing — as a JSX child, or interpolated into a sentence — and the `PlainWhy`
 * it now draws instead.
 */
const SURFACES = [
  { path: "console/SecretFields.tsx", plain: "<PlainWhy why={paste.why} />", raw: "paste.why" },
  { path: "console/AlignmentAct.tsx", plain: "<PlainWhy why={form.why} />", raw: "form.why" },
  { path: "voice/StageSide.tsx", plain: "<PlainWhy why={voice.failure} />", raw: "voice.failure" },
  // A session error riding the orb's detail line, which drew it raw.
  { path: "voice/StageSide.tsx", plain: "<PlainWhy why={status.why} />", raw: "status.why" },
  { path: "ai-elements/tool.tsx", plain: "<PlainWhy why={errorText} />", raw: "errorText" },
  { path: "console/OrganisationRefusal.tsx", plain: "<PlainWhy why={error.message} />", raw: "error.message" },
  { path: "voice/RunningListTray.tsx", plain: "<PlainWhy why={list.failure} />", raw: "list.failure" },
  // The add box's refusal, a caught exception's message or a malformed answer.
  { path: "voice/RunningListTray.tsx", plain: "<PlainWhy why={refusal} />", raw: "refusal" },
  { path: "voice/MessengerComposerNote.tsx", plain: "<PlainWhy why={note.why} />", raw: "typed.why" },
  { path: "live/Automations.tsx", plain: "<PlainWhy why={rejected.why} />", raw: "rejected.why" },
  { path: "console/UpdateButton.tsx", plain: "<PlainWhy why={last.why} />", raw: "last.why" },
  // A doctrine line's quoted read reason, and a not-checked item's, each under the console's own lead.
  { path: "live/FleetDoctrinePanel.tsx", plain: "<PlainWhy lead={reason.lead} why={reason.why} />", raw: "reason.why" },
  { path: "live/FleetDoctrinePanel.tsx", plain: "<PlainWhy lead={item.text} why={item.why} />", raw: "item.why" },
  // The Pull requests page's unproven empty state, which set a failed read's reason inside "Not a count of zero: …".
  { path: "live/PullRequestsList.tsx", plain: "<PlainWhy lead={reason.lead} why={reason.why} />", raw: "reason.why" },
  // A stored copy's failed sync, which set the verb's first problem inside "<source>'s last sync failed: …".
  { path: "console/SourceFreshness.tsx", plain: "<PlainWhy why={words.failure} />", raw: "words.failure" },
  // The voice session's own failure lines : a refused draft edit, which the phase line quoted,
  { path: "console/DraftEditFrame.tsx", plain: "<PlainWhy why={edit.why} />", raw: "edit.why" },
  // a refused device switch's caught reason, once interpolated into the warning, in the tray and the session viewer,
  { path: "voice/AudioDeviceMenu.tsx", plain: "<PlainWhy why={warningWhy} />", raw: "warningWhy" },
  { path: "voice/VoiceSession.tsx", plain: "<PlainWhy why={warningWhy} />", raw: "warningWhy" },
  // and a failure toast's reason, drawn raw under "Details".
  { path: "console/VoiceFailureToasts.tsx", plain: "<PlainWhy why={toast.detail} />", raw: "toast.detail" },
  // A Queue reason's quoted reads, each under the console's lead: the ONE drawer every Queue refusal goes through.
  { path: "console/ReasonLines.tsx", plain: "<PlainWhy lead={quoted.lead} why={quoted.why} />", raw: "quoted.why" },
  // A refused Queue card's reason, and a held card's check, both through it — never the form's `why` drawn whole.
  { path: "console/QueueCardBody.tsx", plain: "<ReasonLines reason={refused} known={known} />", raw: "refused" },
  { path: "console/OpenFallbackPanels.tsx", plain: "<ReasonLines reason={row.why} />", raw: "row.why" },
  // A detached ask's doc that would not read, once set inside the row's own reason sentence.
  { path: "console/QueueCardBody.tsx", plain: "<PlainWhy why={reasonWhy} />", raw: "reasonWhy" },
  // A card source's quoted reads beneath its line, and a pull-request steer of the owner's that would not read.
  { path: "console/SourceBlock.tsx", plain: "<ReasonLines reason={copy.quoted} />", raw: "copy.quoted" },
  { path: "console/SourceBlock.tsx", plain: "<PlainWhy lead={steer.line} why={steer.why} />", raw: "steer.why" },
  // An Alignment act's lookup that failed with a reason, quoted apart from the console's lead.
  { path: "console/AlignmentAct.tsx", plain: "<ReasonLines reason={form.why} />", raw: "form.why" },
] as const;

/** The files drawing a Queue reason, or the Alignment act's, whose folds the container test reads. */
const QUEUE_SURFACES: ReadonlySet<string> = new Set([
  "console/AlignmentAct.tsx",
  "console/OpenFallbackPanels.tsx",
  "console/QueueCardBody.tsx",
  "console/ReasonLines.tsx",
  "console/SourceBlock.tsx",
]);

/** The elements a `PlainWhy` fold may sit in: each holds flow content, so the fold's `<details>` is valid inside it. */
const FLOW_CONTAINERS: ReadonlySet<string | undefined> = new Set(["div", "li", "dd"]);

/**
 * The tag of the nearest element enclosing a node, read off the parsed tree.
 *
 * @returns the tag name, or `undefined` when no element encloses it
 */
function enclosingTagOf({ node }: { node: ts.Node }): string | undefined {
  let at: ts.Node | undefined = node.parent;
  while (at !== undefined && !ts.isJsxElement(at)) {
    at = at.parent;
  }
  if (at === undefined) {
    return undefined;
  }
  return at.openingElement.tagName.getText();
}

/** Every `if` condition under a node, as its source text. */
function ifConditionsUnder({ node }: { node: ts.Node }): readonly string[] {
  const found: string[] = [];
  const walk = (child: ts.Node): void => {
    if (ts.isIfStatement(child)) {
      found.push(child.expression.getText());
    }
    forEachChild({ node: child, visit: walk });
  };
  walk(node);
  return found;
}

/**
 * Lists of a verb's OWN diagnostic sentences, drawn as themselves: the Listener's problems, the seats' diagnostics and
 * a host's burn problems. Through `PlainWhy` each would read "It failed with a technical error." over a sentence that
 * names no failure at all, such as an unarmed Listener's "nothing to measure". A console sentence
 * that quotes a read's reason carries it apart as a `QuotedReason` (`../../lib/quotedReason.ts`) instead.
 */
const OWN_DIAGNOSTICS = [
  { item: "line", path: "live/Now.tsx" },
  { item: "problem", path: "live/PlanMeters.tsx" },
] as const;

describe("a failure on any other surface", () => {
  it("is drawn through PlainWhy, never as its raw value nor interpolated into a sentence", () => {
    expect(SURFACES.length).toBeGreaterThan(0);
    expect(
      SURFACES.map(({ path, plain, raw }) =>
        readParsed({
          path,
          use: (file): readonly (string | number)[] => [
            path,
            textsUnder({ node: file, test: isDrawnChild }).filter((text) => text === `{${raw}}`).length,
            interpolatedUnder({ node: file }).filter((text) => text === raw).length,
            textsUnder({ node: file, test: ts.isJsxSelfClosingElement }).filter((text) => text === plain).length,
          ],
        }),
      ),
    ).toEqual([
      ["console/SecretFields.tsx", 0, 0, 2],
      ["console/AlignmentAct.tsx", 0, 0, 1],
      ["voice/StageSide.tsx", 0, 0, 1],
      ["voice/StageSide.tsx", 0, 0, 1],
      ["ai-elements/tool.tsx", 0, 0, 1],
      ["console/OrganisationRefusal.tsx", 0, 0, 1],
      ["voice/RunningListTray.tsx", 0, 0, 1],
      ["voice/RunningListTray.tsx", 0, 0, 1],
      ["voice/MessengerComposerNote.tsx", 0, 0, 1],
      ["live/Automations.tsx", 0, 0, 1],
      ["console/UpdateButton.tsx", 0, 0, 1],
      ["live/FleetDoctrinePanel.tsx", 0, 0, 1],
      ["live/FleetDoctrinePanel.tsx", 0, 0, 1],
      ["live/PullRequestsList.tsx", 0, 0, 1],
      ["console/SourceFreshness.tsx", 0, 0, 1],
      ["console/DraftEditFrame.tsx", 0, 0, 1],
      ["voice/AudioDeviceMenu.tsx", 0, 0, 1],
      ["voice/VoiceSession.tsx", 0, 0, 1],
      ["console/VoiceFailureToasts.tsx", 0, 0, 1],
      ["console/ReasonLines.tsx", 0, 0, 1],
      ["console/QueueCardBody.tsx", 0, 0, 1],
      ["console/OpenFallbackPanels.tsx", 0, 0, 1],
      ["console/QueueCardBody.tsx", 0, 0, 1],
      ["console/SourceBlock.tsx", 0, 0, 1],
      ["console/SourceBlock.tsx", 0, 0, 1],
      ["console/AlignmentAct.tsx", 0, 0, 1],
    ]);
  });

  it("folds a relay's or a tool row's detail only when its state says it failed, else draws it as itself", () => {
    const read = readParsed({
      path: "voice/VoiceSession.tsx",
      use: (file): readonly (string | number | boolean)[] => {
        const drawn = textsUnder({ node: file, test: isDrawnChild });
        const plain = textsUnder({ node: file, test: ts.isJsxSelfClosingElement });
        const conditions = ifConditionsUnder({ node: file });
        return [
          drawn.filter((text) => text === "{relay.detail}").length,
          plain.filter((text) => text === "<PlainWhy why={relay.detail} />").length,
          conditions.includes("RELAY_FAILED.has(relay.outcome)"),
          textsUnder({ node: file, test: ts.isNewExpression }).includes('new Set(["refused", "unknown"])'),
          // A retry's first refusal, carried apart from the line's own sentence.
          plain.filter((text) => text === "<PlainWhy why={firstRefusal} />").length,
          drawn.filter((text) => text === "{firstRefusal}" || text === "{relay.firstRefusal}").length,
          // A replayed discuss-first post's caught message, carried apart from our line for it.
          plain.filter((text) => text === "<PlainWhy why={why} />").length,
          drawn.filter((text) => text === "{why}" || text === "{replay.why}").length,
          drawn.filter((text) => text === "{row.detail}").length,
          plain.filter((text) => text === "<PlainWhy why={row.detail} />").length,
          conditions.includes('row.state === "refused"'),
          // A refused row's shown output reaches the page only as ToolOutput's `errorText`, which `tool.tsx` folds
          // through PlainWhy (the row above), never drawn raw here.
          plain.filter((text) => text === "<ToolOutput errorText={errorText} output={output} />").length,
          drawn.filter((text) => text.includes("shown.output")).length,
        ];
      },
    });

    expect(read).toEqual([1, 1, true, true, 1, 0, 1, 0, 1, 1, true, 1, 0]);
  });

  it("leaves a device warning our own sentence, its caught reason never interpolated into it", () => {
    const interpolated = readParsed({
      path: "../lib/audioDevices.ts",
      use: (file) => interpolatedUnder({ node: file }),
    });

    expect(interpolated.filter((text) => text === "failed").length).toBe(0);
  });

  it("sits each Queue reason's fold in a flow container, never a p, span, summary, button or Badge", () => {
    const queue = SURFACES.filter(({ path }) => QUEUE_SURFACES.has(path));
    expect(queue.length).toBeGreaterThan(0);
    const containers = queue.map(({ path, plain }) =>
      readParsed({
        path,
        use: (file): readonly (string | undefined)[] => {
          const found: (string | undefined)[] = [];
          const walk = (child: ts.Node): void => {
            if (ts.isJsxSelfClosingElement(child) && child.getText() === plain) {
              found.push(enclosingTagOf({ node: child }));
            }
            forEachChild({ node: child, visit: walk });
          };
          walk(file);
          return found;
        },
      }),
    );
    // In SURFACES order: the Alignment act's own-words arm first, then each Queue reason this file registers.
    expect(containers).toEqual([["div"], ["div"], ["dd"], ["div"], ["div"], ["div"], ["div"], ["div"]]);
    expect(containers.flat().filter((tag) => !FLOW_CONTAINERS.has(tag))).toEqual([]);
  });

  it("leaves a verb's own diagnostic sentences as themselves, never re-said as a technical error", () => {
    expect(OWN_DIAGNOSTICS.length).toBeGreaterThan(0);
    expect(
      OWN_DIAGNOSTICS.map(({ item, path }) =>
        readParsed({
          path,
          use: (file): readonly (string | number)[] => [
            path,
            textsUnder({ node: file, test: isDrawnChild }).filter((text) => text === `{${item}}`).length,
            textsUnder({ node: file, test: ts.isJsxSelfClosingElement }).filter((text) => text.startsWith("<PlainWhy "))
              .length,
          ],
        }),
      ),
    ).toEqual([
      ["live/Now.tsx", 1, 0],
      ["live/PlanMeters.tsx", 1, 0],
    ]);
  });

  it("draws a tool error whose body is empty, by the error's presence, never its truthiness", () => {
    const binaries = readParsed({
      path: "ai-elements/tool.tsx",
      use: (file) => textsUnder({ node: file, test: ts.isBinaryExpression }),
    });

    expect([
      binaries.includes("errorText !== undefined"),
      binaries.includes("!failed && !output"),
      binaries.includes(
        "failed && (\n          <div>\n            <PlainWhy why={errorText} />\n          </div>\n        )",
      ),
      binaries.filter((text) => text.startsWith("errorText &&") || text.startsWith("output || errorText")).length,
      plainReasonOf({ why: "" }),
    ]).toEqual([true, true, true, 0, { plain: "It failed without giving an error message.", raw: undefined }]);
  });

  it("draws a doctrine line's quoted reasons beside its summary, which cannot hold the fold", () => {
    const summaries = readParsed({
      path: "live/FleetDoctrinePanel.tsx",
      use: (file) => textsUnder({ node: file, test: ts.isJsxElement }).filter((text) => text.startsWith("<summary")),
    });

    // The not-read fold is its own `<details>` beside the line, so its summary is a second one, never a nested one. The
    // third is the panel's own closed line, which holds the count alone and none of the lines' folds.
    expect(summaries).toEqual([
      '<summary className="cursor-pointer">why it was not read</summary>',
      '<summary className="list-none">{sentence}</summary>',
      '<summary className="text-muted-foreground">{doctrineAlertSummary({ lines: doctrine.lines })}</summary>',
    ]);
  });

  it("draws the not-read fold beside the sentence, never inside it, since the sentence sits in a summary", () => {
    // Each read of `notRead`, as the variable it is composed into and whether a `<summary>` encloses it: inside
    // `sentence` it would land in the groups fold's summary, which cannot hold a fold.
    const placements = readParsed({
      path: "live/FleetDoctrinePanel.tsx",
      use: (file) => {
        const found: (readonly [string, boolean])[] = [];
        const walk = (child: ts.Node): void => {
          // Every READ of the `notRead` binding, wherever it sits — a JSX child, an attribute such as
          // `children={(notRead)}`, spaced or parenthesised — never a JSX-child text match. Its declaration,
          // its assignment and `line.notRead` (a property name) are not reads of it.
          const isRead =
            ts.isIdentifier(child) &&
            child.text === "notRead" &&
            !(ts.isVariableDeclaration(child.parent) && child.parent.name === child) &&
            !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child) &&
            !(
              ts.isBinaryExpression(child.parent) &&
              child.parent.left === child &&
              child.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
            );
          if (isRead) {
            let owner = "";
            let inSummary = false;
            for (let at: ts.Node = child.parent; !ts.isSourceFile(at); at = at.parent) {
              if (ts.isJsxElement(at) && at.openingElement.tagName.getText() === "summary") {
                inSummary = true;
              }
              if (owner === "" && ts.isVariableDeclaration(at)) {
                owner = at.name.getText();
              }
            }
            found.push([owner, inSummary]);
          }
          forEachChild({ node: child, visit: walk });
        };
        walk(file);
        return found;
      },
    });

    expect(placements).toEqual([["quoted", false]]);
  });

  it("draws nothing inside the sentence but its short line, so no fold can reach the summary by any name", () => {
    // A closed list, so an alias of the fold drawn into `sentence` fails here; the summary is pinned to `{sentence}`
    // alone above, so together nothing but the line itself can sit in a summary.
    const drawn = readParsed({
      path: "live/FleetDoctrinePanel.tsx",
      use: (file) => {
        const found: (readonly string[])[] = [];
        const walk = (child: ts.Node): void => {
          if (
            ts.isVariableDeclaration(child) &&
            child.name.getText() === "sentence" &&
            child.initializer !== undefined
          ) {
            // A fragment's child is drawn as surely as an element's, so `<>{notRead}</>` counts too.
            found.push(
              textsUnder({
                node: child.initializer,
                test: (node) => isDrawnChild(node) || (ts.isJsxExpression(node) && ts.isJsxFragment(node.parent)),
              }),
            );
          }
          forEachChild({ node: child, visit: walk });
        };
        walk(file);
        return found;
      },
    });

    expect(drawn).toEqual([["{shown}"]]);
  });

  it("puts the composer's note in a div, since an output element cannot hold the fold", () => {
    const tags = readParsed({
      path: "voice/MessengerComposerNote.tsx",
      use: (file) => textsUnder({ node: file, test: ts.isJsxOpeningElement }).map((text) => text.split(/\s/u)[0]),
    });

    expect([tags.includes("<output"), tags.includes("<div")]).toEqual([false, true]);
  });

  it("leads the call card's line with the plain words and keeps the raw on its hover", () => {
    const assigned = readParsed({
      path: "voice/CallCardStatus.tsx",
      use: (file) => textsUnder({ node: file, test: ts.isBinaryExpression }).filter((text) => text.startsWith("line")),
    });

    expect([
      assigned.includes("line = voice.failure"),
      assigned.includes("line = reason.plain"),
      assigned.includes("lineTitle = reason.raw"),
    ]).toEqual([false, true, true]);
  });

  it("says the raw values those surfaces carry as a technical error, the raw kept whole", () => {
    const reasons = [
      "SyntaxError: Unexpected token '<', \"<!DOCTYPE \" is not valid JSON",
      "Error: setup failed\n    at connect (/srv/app/talk.ts:12:5)",
      '{"error":"tool_failed","detail":{"code":"E_TIMEOUT_X"}}',
      "Cannot read properties of undefined (reading 'map')",
      "Unexpected token '<', \"<!DOCTYPE \" is not valid JSON",
      "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
    ];

    expect(reasons.map((why) => plainReasonOf({ why }))).toEqual(
      reasons.map((why) => ({ plain: "It failed with a technical error.", raw: why })),
    );
  });
});
