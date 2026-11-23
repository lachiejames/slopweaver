import { describe, expect, it } from "vitest";

import { appleScriptAddressesBrowser } from "../../../admit/browserAppleScript.js";
import { classifyBrowserLaunchCommand } from "../../../admit/browserLaunchCommand.js";

const blocked = ({ command, env = {} }: { command: string; env?: Record<string, string> }): boolean =>
  classifyBrowserLaunchCommand({ command, env }).blocked;

describe("classifyBrowserLaunchCommand — AppleScript", () => {
  it("refuses osascript telling a browser, by name, id or JXA, inline or from stdin", () => {
    const forms = [
      `osascript -e 'tell application "Google Chrome" to open location "https://example.test"'`,
      `osascript -e 'tell app "Safari"' -e 'activate' -e 'end tell'`,
      `osascript -e 'tell application id "com.google.Chrome" to activate'`,
      `osascript -l JavaScript -e 'Application("Arc").activate()'`,
      `osascript <<'APPLESCRIPT'\ntell application "Google Chrome"\n  activate\nend tell\nAPPLESCRIPT`,
      `osascript <<< 'tell application "Safari" to activate'`,
      `osascript <<< 'tell application "Google Chrome" to activate' &`,
      `osascript -e'tell application "Google Chrome" to open location "https://example.test"'`,
      `osascript -lJavaScript -e'Application("Arc").activate()'`,
      "osascript -l JavaScript -e 'Application(`Google Chrome`).activate()'",
      "osascript -l JavaScript -e '`${Application(\"Safari\").activate()}`'",
      `osascript - ignored <<'APPLESCRIPT'\ntell application "Safari" to activate\nAPPLESCRIPT`,
      `osascript -- - one two <<< 'tell application "Safari" to activate'`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes osascript running a script FILE whose argument names a browser", () => {
    expect(blocked({ command: `osascript tidy.scpt Safari <<< 'tell application "Safari" to activate'` })).toBe(false);
  });

  it("passes osascript on a non-browser app, and a heredoc that only quotes a browser line as data", () => {
    const forms = [
      `osascript -e 'tell application "Finder" to activate'`,
      `osascript -e 'display notification "done"'`,
      `cat <<'EOF'\ntell application "Safari" to activate\nopen -a Safari https://example.test\nEOF`,
      `slopweaver hand post --literal 'open -a Safari https://example.test'`,
      `cat <<'DATA' & osascript <<'SCRIPT'\ntell application "Safari" to activate\nDATA\ntell application "Finder" to activate\nSCRIPT`,
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("refuses a backgrounded osascript whose OWN heredoc tells a browser, beside a data heredoc", () => {
    const forms = [
      `cat <<'DATA' & osascript <<'SCRIPT'\ntell application "Finder" to activate\nDATA\ntell application "Safari" to activate\nSCRIPT`,
      `osascript <<'SCRIPT' & cat <<'DATA'\ntell application "Safari" to activate\nSCRIPT\nnothing here\nDATA`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes a browser named only inside a comment or a string the script holds, in either language (r3)", () => {
    const forms = [
      `osascript -e '-- tell application "Safari" to activate' -e 'tell application "Finder" to activate'`,
      `osascript -e '# tell app "Safari"' -e 'tell app "Finder" to activate'`,
      `osascript -e '(* tell app "Safari" (* nested *) still a comment *) tell app "Finder" to activate'`,
      `osascript -l JavaScript -e '// Application("Arc").activate()' -e 'Application("Finder").activate()'`,
      `osascript -l JavaScript -e '/* Application("Arc") */ Application("Finder").activate()'`,
      `osascript -l JavaScript -e '<!-- Application("Safari").activate()' -e 'Application("Finder").activate()'`,
      `osascript -l JavaScript -e "var note = 'Application(\\"Arc\\").activate()'; Application('Finder').activate()"`,
      'osascript -l JavaScript -e \'var note = `Application("Safari") ${1}`; Application("Finder").activate()\'',
      `osascript -l JavaScript -e 'var pattern = /Application("Safari")/; Application("Finder").activate()'`,
      `osascript -e 'display dialog "tell app \\"Safari\\" to activate"'`,
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("still refuses a browser beside a comment marker that sits inside a string or after the tell", () => {
    const forms = [
      `osascript -e 'tell application "Google Chrome" to open location "https://example.test" -- go'`,
      `osascript -e 'display dialog "a -- b"' -e 'tell app "Safari" to activate'`,
      `osascript -e "set w to window 1's name" -e 'tell app "Safari" to activate'`,
      `osascript -l JavaScript -e "var u = 'https://example.test'; Application(\\"Arc\\").activate()"`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("refuses a JXA browser call after a regular expression holding `//` or a quote, or after a division", () => {
    const forms = [
      `osascript -l JavaScript -e 'var r = /\\//; Application("Safari").activate()'`,
      `osascript -l JavaScript -e 'var r = (/* c */ /\\//); Application("Safari").activate()'`,
      `osascript -l JavaScript -e 'var r = /"/; Application("Safari").activate()'`,
      `osascript -l JavaScript -e 'var x = ({}) / Application("Safari").activate() / 1'`,
      `osascript -l JavaScript -e 'var o = {return: 4}; var x = o.return / Application("Safari").activate() / 1'`,
      `osascript -l JavaScript -e 'var of = 4; var x = of / Application("Safari").activate() / 1'`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes a browser named only in a regular expression after a keyword such as return", () => {
    const forms = [
      `osascript -l JavaScript -e 'function f() { return /Application("Safari")/; } Application("Finder").activate()'`,
      `osascript -l JavaScript -e 'var t = typeof /Application("Arc")/; Application("Finder").activate()'`,
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("refuses a browser call inside an interpolation holding a brace or backtick in a string, or a slash", () => {
    const forms = [
      'osascript -l JavaScript -e \'`${"}", Application("Safari").activate()}`\'',
      'osascript -l JavaScript -e \'`${"`"}${Application("Safari").activate()}`\'',
      "osascript -l JavaScript -e '`${`}`}${Application(\"Safari\").activate()}`'",
      "osascript -l JavaScript -e '`${/}/.source, Application(\"Safari\").activate()}`'",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("still passes a browser named only in a template's text around a readable interpolation", () => {
    const forms = [
      'osascript -l JavaScript -e \'var n = `${"}"} Application("Safari")`; Application("Finder").activate()\'',
      'osascript -l JavaScript -e \'var n = `${{a: 1}.a} Application("Arc")`; Application("Finder").activate()\'',
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("still refuses a browser call after a keyword-led regular expression closes", () => {
    const forms = [`osascript -l JavaScript -e 'function f() { return /x/; } Application("Safari").activate()'`];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("refuses a JXA Application call whose target is computed at run time, unread", () => {
    const forms = [
      `osascript -l JavaScript -e 'Application("Saf" + "ari").activate()'`,
      `osascript -l JavaScript -e 'var n = "Safari"; Application(n).activate()'`,
      "osascript -l JavaScript -e 'var n = \"Saf\"; Application(`${n}ari`).activate()'",
      `osascript -l JavaScript -e 'Application ( ["Saf", "ari"].join("") ).activate()'`,
      `osascript -l JavaScript -e 'Application("\\x53afari").activate()'`,
      `osascript -l JavaScript -e "Application('\\u0053afari').activate()"`,
      "osascript -l JavaScript -e 'Application(`\\x53afari`).activate()'",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("still passes a JXA script whose every Application call names a non-browser literal", () => {
    const forms = [
      `osascript -l JavaScript -e 'Application("Finder").activate()'`,
      `osascript -l JavaScript -e 'var app = Application.currentApplication(); app.includeStandardAdditions = true'`,
      "osascript -l JavaScript -e 'Application(`System Events`).processes()'",
      `osascript -l JavaScript -e '// Application(name)' -e 'Application("Finder").activate()'`,
      `osascript -e 'tell application "Finder" to activate'`,
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("refuses at the first browser call, before reading every call after it", () => {
    // Read whole, the calls after the first cost time quadratic in their count and run past the test's own timeout.
    const program = `Application("Safari");${'Application("TextEdit");'.repeat(300_000)}`;
    expect(appleScriptAddressesBrowser({ language: "javascript", program })).toBe(true);
  });
});
