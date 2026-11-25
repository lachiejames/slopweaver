/*
 * The console takes typed words in exactly one place: the call's chat. The owner's rule: no other text
 * inputs in the app, on any page or card. The conversation field is the one entry point, and the password field a
 * hand step pastes a token into is the second, which shows a receipt naming the key and never the value. A third, the
 * running list's own box, stays separate from the conversation in its own tray, because the owner types there only to
 * hand the fleet some info, such as a link to a thread.
 *
 * The chat keeps one file picker beside its box, and only there, so the owner can upload files to the voice. A file picker
 * takes no typed words, and it attaches to the one conversation field rather than opening a second entry point, so a
 * file input anywhere else is still refused.
 *
 * Settings and the Store page keep two search boxes each, later rulings than the no-text-inputs one, and a later
 * ruling outranks an earlier one. In Settings the owner searches the section list and the integration catalog to find
 * what they are looking for. On the Store page the owner narrows the table list by name, which sends nothing anywhere,
 * and filters a table's rows by a typed value, which goes only to the read-only `store rows`. None of the four is a
 * second way to talk to the fleet: each narrows a view, and is kept only as a `type="search"` input, and only in its
 * own file.
 *
 * So this walks every component and route under `site/` with the TypeScript parser, not a text match, and refuses any
 * control a person types into outside those. A checkbox, a radio and a `<select>` take no words and pass by what
 * they are; the exceptions pass by file, and each is held to its count so a removed exception cannot leave a stale
 * row behind.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { forEachChild, isStringLiteralLikeNode, ts, withSourceFile } from "../../../src/lib/tsSyntax.js";

/** The `site/` root every path here is relative to. */
const SITE = join(import.meta.dirname, "../..");

/** The trees whose sources draw the console: its routes and its components. */
const TREES = ["app", "components"] as const;

/** The one conversation field: the call's chat. */
const CHAT_FILE = "components/voice/MessengerComposer.tsx";

/** The one list field: the running list's own box, where the owner puts something for the fleet to look at. */
const LIST_FILE = "components/voice/RunningListTray.tsx";

/** The one secret field: the hand step's paste, a password input. */
const SECRET_FILE = "components/console/SecretFields.tsx";

/** The Settings modal, whose section list is searchable. */
const SETTINGS_SEARCH_FILE = "components/console/SettingsModal.tsx";

/** The integration catalog, searchable by name. */
const INTEGRATION_SEARCH_FILE = "components/console/SettingsIntegrations.tsx";

/** The Store page's table list, narrowed by name. */
const STORE_TABLES_SEARCH_FILE = "components/console/StoreTableList.tsx";

/** The Store page's filter bar, whose equals and contains take a value. */
const STORE_FILTER_SEARCH_FILE = "components/console/StoreFilter.tsx";

/** The four files a search box is kept in. */
const SEARCH_FILES: ReadonlySet<string> = new Set([
  SETTINGS_SEARCH_FILE,
  INTEGRATION_SEARCH_FILE,
  STORE_TABLES_SEARCH_FILE,
  STORE_FILTER_SEARCH_FILE,
]);

/** The `type`s an `<input>` may carry anywhere, because none of them takes words. */
const CHOICE_TYPES: ReadonlySet<string> = new Set(["checkbox", "radio"]);

/** The roles that make any element a field a person types into. */
const TYPING_ROLES: ReadonlySet<string> = new Set(["textbox", "searchbox", "combobox"]);

/** A control a person could type into, outside the three the owner kept. */
interface TextInputViolation {
  readonly path: string;
  readonly line: number;
  readonly kind: "input" | "textarea" | "contenteditable" | "textbox-role" | "component" | "create-element";
}

/**
 * One of the kept fields, found where its exception says it lives: the chat, its file picker, the list's box, or the
 * secret paste.
 */
interface KeptField {
  readonly path: string;
  readonly control: "chat" | "attach" | "list" | "secret" | "search";
}

/** What one file holds: what it refuses, and the kept fields it draws. */
interface TextInputScan {
  readonly violations: readonly TextInputViolation[];
  readonly kept: readonly KeptField[];
}

/** An attribute's value when it is written as a literal string, else `undefined` — absent and dynamic alike. */
function staticAttribute({ element, name }: { element: ts.JsxOpeningLikeElement; name: string }): string | undefined {
  const attribute = element.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText() === name,
  );
  if (attribute === undefined || !ts.isJsxAttribute(attribute) || attribute.initializer === undefined) {
    return undefined;
  }
  const value = attribute.initializer;
  if (ts.isStringLiteral(value)) {
    return value.text;
  }
  if (ts.isJsxExpression(value) && value.expression !== undefined && isStringLiteralLikeNode(value.expression)) {
    return value.expression.text;
  }
  return undefined;
}

/** Whether an element carries an attribute by that name at all, whatever its value. */
function hasAttribute({ element, name }: { element: ts.JsxOpeningLikeElement; name: string }): boolean {
  return element.attributes.properties.some(
    (property) => ts.isJsxAttribute(property) && property.name.getText().toLowerCase() === name.toLowerCase(),
  );
}

/**
 * Every control in one source a person could type into, and the kept fields it draws.
 *
 * @param path the file, relative to `site/`, which decides whether an exception applies
 * @param source the file's text
 * @returns what it refuses and what it keeps
 */
function textInputScan({ path, source }: { path: string; source: string }): TextInputScan {
  const violations: TextInputViolation[] = [];
  const kept: KeptField[] = [];
  withSourceFile({
    fileName: path,
    text: source,
    scriptKind: ts.ScriptKind.TSX,
    use: (file) => {
      const refuse = ({ node, kind }: { node: ts.Node; kind: TextInputViolation["kind"] }): void => {
        violations.push({ kind, line: file.getLineAndCharacterOfPosition(node.getStart()).line + 1, path });
      };
      const element = ({ node }: { node: ts.JsxOpeningLikeElement }): void => {
        const tag = node.tagName.getText();
        const terminal = tag.slice(tag.lastIndexOf(".") + 1);
        if (hasAttribute({ element: node, name: "contentEditable" })) {
          refuse({ kind: "contenteditable", node });
        }
        const role = staticAttribute({ element: node, name: "role" });
        if (role !== undefined && TYPING_ROLES.has(role)) {
          refuse({ kind: "textbox-role", node });
        }
        if (terminal === "Input" || terminal === "Textarea") {
          refuse({ kind: "component", node });
          return;
        }
        if (tag === "textarea") {
          if (path === CHAT_FILE) {
            kept.push({ control: "chat", path });
            return;
          }
          if (path === LIST_FILE) {
            kept.push({ control: "list", path });
            return;
          }
          refuse({ kind: "textarea", node });
          return;
        }
        if (tag !== "input") {
          return;
        }
        // A spread can carry a `type` that overrides the literal one, so an input with any spread is judged unknowable.
        if (node.attributes.properties.some((property) => ts.isJsxSpreadAttribute(property))) {
          refuse({ kind: "input", node });
          return;
        }
        const type = staticAttribute({ element: node, name: "type" });
        if (type !== undefined && CHOICE_TYPES.has(type)) {
          return;
        }
        if (type === "password" && path === SECRET_FILE) {
          kept.push({ control: "secret", path });
          return;
        }
        if (type === "file" && path === CHAT_FILE) {
          kept.push({ control: "attach", path });
          return;
        }
        if (type === "search" && SEARCH_FILES.has(path)) {
          kept.push({ control: "search", path });
          return;
        }
        refuse({ kind: "input", node });
      };
      const visit = ({ node }: { node: ts.Node }): void => {
        if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
          element({ node });
        }
        if (ts.isCallExpression(node) && node.expression.getText().endsWith("createElement")) {
          const first = node.arguments.at(0);
          if (
            first !== undefined &&
            isStringLiteralLikeNode(first) &&
            (first.text === "input" || first.text === "textarea")
          ) {
            refuse({ kind: "create-element", node });
          }
        }
        forEachChild({
          node,
          visit: (child) => {
            visit({ node: child });
          },
        });
      };
      visit({ node: file });
    },
  });
  return { kept, violations };
}

/** Every `.ts` and `.tsx` the console is drawn from, relative to `site/`. */
function consoleSources(): readonly string[] {
  return TREES.flatMap((tree) =>
    readdirSync(join(SITE, tree), { encoding: "utf8", recursive: true })
      .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
      .map((name) => `${tree}/${name.split("\\").join("/")}`),
  );
}

describe("textInputScan", () => {
  it("passes a checkbox, a radio and a select, which take no words", () => {
    const source = `const A = () => (<form>
      <input type="checkbox" checked readOnly />
      <input type={"radio"} name="pick" />
      <select value="a"><option value="a">a</option></select>
    </form>);`;
    expect(textInputScan({ path: "components/x/Form.tsx", source })).toEqual({ kept: [], violations: [] });
  });

  it("refuses a text, search, file or untyped input, and one whose type is not written as a literal", () => {
    const source = `const A = ({ kind }: { kind: string }) => (<div>
      <input type="text" />
      <input type="search" />
      <input type="file" />
      <input />
      <input type={kind} />
    </div>);`;
    expect(textInputScan({ path: "components/x/Form.tsx", source }).violations.map((one) => one.line)).toEqual([
      2, 3, 4, 5, 6,
    ]);
  });

  it("refuses an input carrying a spread, which can override a literal checkbox type, even in the chat's file", () => {
    const source = `const override = { type: "file" as const };
    const A = () => (<div>
      <input type="checkbox" {...override} />
      <input {...override} type="file" />
    </div>);`;
    expect(textInputScan({ path: CHAT_FILE, source })).toEqual({
      kept: [],
      violations: [
        { kind: "input", line: 3, path: CHAT_FILE },
        { kind: "input", line: 4, path: CHAT_FILE },
      ],
    });
  });

  it("keeps the chat's textarea and file picker, the list's textarea and the secret paste's password field, each only in its own file", () => {
    const chat = `const A = () => <textarea value="" />;`;
    const attach = `const A = () => <input type="file" hidden />;`;
    const secret = `const A = () => <input type="password" />;`;
    expect([
      textInputScan({ path: CHAT_FILE, source: chat }),
      textInputScan({ path: CHAT_FILE, source: attach }),
      textInputScan({ path: LIST_FILE, source: chat }),
      textInputScan({ path: SECRET_FILE, source: secret }),
      textInputScan({ path: SECRET_FILE, source: chat }).violations.map((one) => one.kind),
      textInputScan({ path: SECRET_FILE, source: attach }).violations.map((one) => one.kind),
      textInputScan({ path: CHAT_FILE, source: secret }).violations.map((one) => one.kind),
      textInputScan({ path: LIST_FILE, source: secret }).violations.map((one) => one.kind),
      textInputScan({ path: LIST_FILE, source: attach }).violations.map((one) => one.kind),
    ]).toEqual([
      { kept: [{ control: "chat", path: CHAT_FILE }], violations: [] },
      { kept: [{ control: "attach", path: CHAT_FILE }], violations: [] },
      { kept: [{ control: "list", path: LIST_FILE }], violations: [] },
      { kept: [{ control: "secret", path: SECRET_FILE }], violations: [] },
      ["textarea"],
      ["input"],
      ["input"],
      ["input"],
      ["input"],
    ]);
  });

  it("keeps a search box only in the two Settings files and the two Store files, and refuses any other typed field there", () => {
    const search = `const A = () => <input type="search" />;`;
    const text = `const A = () => <input type="text" />;`;
    expect([
      textInputScan({ path: SETTINGS_SEARCH_FILE, source: search }),
      textInputScan({ path: INTEGRATION_SEARCH_FILE, source: search }),
      textInputScan({ path: STORE_TABLES_SEARCH_FILE, source: search }),
      textInputScan({ path: STORE_FILTER_SEARCH_FILE, source: search }),
      textInputScan({ path: SETTINGS_SEARCH_FILE, source: text }).violations.map((one) => one.kind),
      textInputScan({ path: STORE_TABLES_SEARCH_FILE, source: text }).violations.map((one) => one.kind),
      textInputScan({ path: STORE_FILTER_SEARCH_FILE, source: text }).violations.map((one) => one.kind),
      textInputScan({ path: CHAT_FILE, source: search }).violations.map((one) => one.kind),
      textInputScan({ path: "components/console/StoreRowsGrid.tsx", source: search }).violations.map((one) => one.kind),
      textInputScan({ path: "components/x/Form.tsx", source: search }).violations.map((one) => one.kind),
    ]).toEqual([
      { kept: [{ control: "search", path: SETTINGS_SEARCH_FILE }], violations: [] },
      { kept: [{ control: "search", path: INTEGRATION_SEARCH_FILE }], violations: [] },
      { kept: [{ control: "search", path: STORE_TABLES_SEARCH_FILE }], violations: [] },
      { kept: [{ control: "search", path: STORE_FILTER_SEARCH_FILE }], violations: [] },
      ["input"],
      ["input"],
      ["input"],
      ["input"],
      ["input"],
      ["input"],
    ]);
  });

  it("refuses an Input or Textarea component, an editable element, a textbox role and a created input", () => {
    const source = `const A = () => (<div>
      <Input />
      <ui.Textarea />
      <div contentEditable />
      <span role="textbox" />
    </div>);
    const b = document.createElement("textarea");`;
    expect(textInputScan({ path: "components/x/Form.tsx", source }).violations).toEqual([
      { kind: "component", line: 2, path: "components/x/Form.tsx" },
      { kind: "component", line: 3, path: "components/x/Form.tsx" },
      { kind: "contenteditable", line: 4, path: "components/x/Form.tsx" },
      { kind: "textbox-role", line: 5, path: "components/x/Form.tsx" },
      { kind: "create-element", line: 7, path: "components/x/Form.tsx" },
    ]);
  });
});

describe("the console's text inputs", () => {
  const sources = consoleSources();
  const scans = sources.map((path) => textInputScan({ path, source: readFileSync(join(SITE, path), "utf8") }));

  it("reads every route and component the console is drawn from", () => {
    expect(sources.length).toBeGreaterThan(0);
    expect(sources).toContain(CHAT_FILE);
    expect(sources).toContain(LIST_FILE);
    expect(sources).toContain(SECRET_FILE);
  });

  it("holds no field a person types into outside the kept fields' own files", () => {
    expect(scans.flatMap((scan) => scan.violations)).toEqual([]);
  });

  it("draws exactly one chat field, one file picker, one list field and at least one secret field, so no exception outlives its control", () => {
    const kept = scans.flatMap((scan) => scan.kept);
    expect(kept.filter((one) => one.control === "chat")).toEqual([{ control: "chat", path: CHAT_FILE }]);
    expect(kept.filter((one) => one.control === "attach")).toEqual([{ control: "attach", path: CHAT_FILE }]);
    expect(kept.filter((one) => one.control === "list")).toEqual([{ control: "list", path: LIST_FILE }]);
    expect(kept.filter((one) => one.control === "secret").length).toBeGreaterThan(0);
    expect(kept.filter((one) => one.control === "search").toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
      { control: "search", path: INTEGRATION_SEARCH_FILE },
      { control: "search", path: SETTINGS_SEARCH_FILE },
      { control: "search", path: STORE_FILTER_SEARCH_FILE },
      { control: "search", path: STORE_TABLES_SEARCH_FILE },
    ]);
  });
});
