import { describe, expect, it } from "vitest";

import { classifyBrowserLaunchCommand } from "../../../admit/browserLaunchCommand.js";
import { evaluateHookPayload } from "../../../admit/hookPayload.js";

const blocked = ({ command, env = {} }: { command: string; env?: Record<string, string> }): boolean =>
  classifyBrowserLaunchCommand({ command, env }).blocked;

describe("classifyBrowserLaunchCommand — walking and the hatch", () => {
  it("looks through a shell that a peeled wrapper fronts (the r1 review)", () => {
    const forms = [
      `sudo bash -lc "open -a 'Google Chrome' https://example.test"`,
      "timeout 5 sh -c 'npx playwright open https://example.test'",
      `caffeinate -i zsh -c "sudo bash -c 'open https://example.test'"`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes a wrapper-fronted shell whose script launches nothing", () => {
    expect(blocked({ command: "sudo bash -lc 'git status && echo done'" })).toBe(false);
  });

  it("looks past zsh's precommand modifiers, noglob and nocorrect", () => {
    const forms = [
      "zsh -c 'noglob open https://example.test'",
      "noglob open https://example.test",
      "nocorrect open -a Safari",
      "noglob npx playwright open https://example.test",
      "nocorrect noglob osascript -e 'tell application \"Safari\" to activate'",
      "noglob watch 'open https://example.test'",
      `nocorrect env -S "open -a Safari"`,
      "noglob su -c 'open https://example.test' me",
      "noglob find . -exec open https://example.test ';'",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("peels a wrapper spelled in another case, as macOS resolves its path", () => {
    const forms = [
      "printf x | /usr/bin/XARGS open https://example.test",
      "/usr/bin/Nohup open -a Safari",
      "SUDO open https://example.test",
      "/usr/bin/TIMEOUT 5 npx playwright open https://example.test",
      "/opt/homebrew/bin/GTIMEOUT 5 open https://example.test",
      "printf x | /opt/homebrew/bin/Gxargs open https://example.test",
      `/opt/homebrew/bin/genv -S "open -a Safari https://example.test"`,
      `/opt/homebrew/bin/GENV -S "open -a Safari https://example.test"`,
      `/usr/bin/ENV -S "npx playwright open https://example.test"`,
      `/usr/bin/SU -c "open https://example.test" me`,
      `/usr/bin/SUDO /usr/bin/SU -c 'open https://example.test' root`,
      `/usr/bin/Nohup /usr/bin/ENV -S "open -a Safari"`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("judges the program at every command start, a wrapper's argv command included", () => {
    const forms = [
      "watch -x open https://example.test",
      "watch --exec open -a Safari",
      "watch -n 5 -x npx playwright open https://example.test",
      "find . -name x -exec open https://example.test ';'",
      "/usr/bin/FIND . -name x -exec open -a Safari ';'",
      "find . -maxdepth 0 -execdir osascript -e 'tell application \"Safari\" to activate' ';'",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes a wrapper's argv command that launches nothing", () => {
    const forms = [
      "watch -x git status",
      "find . -name '*.ts' -exec grep -l open {} +",
      "find . -name notes.txt -exec open -a TextEdit notes.txt ';'",
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("passes a precommand modifier in front of a command that launches nothing", () => {
    const forms = ["noglob git log --grep=*fix*", "nocorrect open -a Finder", "zsh -c 'noglob ls *.ts'"];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("looks through the line a wrapper runs from an option's value", () => {
    const forms = [
      `/usr/bin/env -S "open -a Safari https://example.test"`,
      "env -iS 'npx playwright open https://example.test'",
      `env -u HOME --split "open -a 'Brave Browser' https://example.test"`,
      `env -S "env -S 'open -a Safari https://example.test'"`,
      `bash -c "env -iS 'open -a Safari https://example.test'"`,
      `env -S "bash -c 'open https://example.test'"`,
      `sudo env --split-string="open -a 'Google Chrome' https://example.test"`,
      "su me -c 'open -a Arc https://example.test'",
      "watch 'open https://example.test'",
      `bash -c 'echo "$(open -a Safari https://example.test)"'`,
      `echo "$(open -a Safari https://example.test)"`,
      "cat <(open https://example.test)",
      "bash -c 'echo `open -a Safari https://example.test`'",
      "cat <<EOF\n$(open -a Safari https://example.test)\nEOF",
      "bash <<'EOF'\nopen -a Safari https://example.test\nEOF",
      "sudo sh -s <<< 'open https://example.test'",
      "bash -s arg <<'EOF'\nopen -a Safari https://example.test\nEOF",
      "bash -xs -- one two <<'EOF'\nopen https://example.test\nEOF",
      "zsh -- <<'EOF'\nopen https://example.test\nEOF",
      "case x in x) open -a Safari https://example.test;; esac",
      "case x in y) true;; x) open https://example.test;; esac",
      "! open -a Safari https://example.test",
      "coproc open https://example.test",
      "true & open -a Safari https://example.test",
      "sleep 1 & sleep 2 & npx playwright open https://example.test &",
      `true & osascript <<'EOF'\ntell application "Safari" to activate\nEOF`,
      `case x in x) osascript <<'EOF'\ntell application "Safari" to activate\nEOF\n;; esac`,
      `case x in x) bash <<'EOF'\nopen -a Safari https://example.test\nEOF\n;; esac`,
      `bash -o errexit <<'EOF'\nopen -a Safari https://example.test\nEOF`,
      `bash -euo pipefail <<'EOF'\nopen -a Safari https://example.test\nEOF`,
      `bash +o posix -O extglob <<'EOF'\nopen -a Safari https://example.test\nEOF`,
      `bash --rcfile x.rc <<'EOF'\nopen -a Safari https://example.test\nEOF`,
      `osascript <<'EOF'\ntell application ¬\n"Safari" to activate\nEOF`,
      `osascript -e 'tell application id ¬' -e '"com.apple.Safari" to activate'`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  /** `inner` behind `depth` nested `$( )` substitutions, each one line deeper than the last. */
  const deep = ({ depth, inner }: { depth: number; inner: string }): string =>
    Array.from({ length: depth }).reduce<string>((line) => `echo $(${line})`, inner);

  it("reads four nested shells whole, refusing a launch on its own shape and passing a search", () => {
    const fourDeep = ({ inner }: { inner: string }): string =>
      `bash -c "bash -c \\"bash -c \\\\\\"bash -c '${inner}'\\\\\\"\\""`;
    const verdict = classifyBrowserLaunchCommand({
      command: fourDeep({ inner: "open -a Safari https://example.test" }),
      env: {},
    });
    expect((verdict as { message: string }).message).toContain("macos-open");
    expect(blocked({ command: fourDeep({ inner: "git grep Safari" }) })).toBe(false);
    expect(blocked({ command: fourDeep({ inner: "git status" }) })).toBe(false);
  });

  it("refuses a launch-like line nested past what it reads rather than allowing it unread", () => {
    const pastBound = deep({ depth: 20, inner: "open -a Safari https://example.test" });
    const verdict = classifyBrowserLaunchCommand({ command: pastBound, env: {} });
    expect(verdict.blocked).toBe(true);
    expect((verdict as { message: string }).message).toContain("nested-past-reading");
    expect(blocked({ command: pastBound, env: { SLOPWEAVER_ALLOW_BROWSER_LAUNCH: "1" } })).toBe(false);
    expect(blocked({ command: deep({ depth: 16, inner: "git grep Safari" }) })).toBe(false);
  });

  it("passes a line past the bound that names nothing launch-like, and refuses a split or encoded one", () => {
    expect(blocked({ command: deep({ depth: 20, inner: "git status" }) })).toBe(false);
    expect(blocked({ command: deep({ depth: 20, inner: `o"p"en -a S"a"fari` }) })).toBe(true);
    expect(blocked({ command: deep({ depth: 20, inner: "$(printf \\\\157)pen x" }) })).toBe(true);
  });

  it("still reads three nested lines, refusing a launch and passing a harmless one", () => {
    expect(blocked({ command: `bash -c "sudo bash -c \\"env -S 'open https://example.test'\\""` })).toBe(true);
    expect(blocked({ command: `bash -c "sudo bash -c \\"env -S 'git status'\\""` })).toBe(false);
  });

  it("passes a wrapper payload that launches nothing", () => {
    expect(blocked({ command: `env -S "git status" && su me -c 'yarn test'` })).toBe(false);
    expect(blocked({ command: "cat <<'EOF'\n$(open -a Safari https://example.test)\nEOF" })).toBe(false);
    expect(blocked({ command: "bash script.sh <<EOF\nopen -a Safari https://example.test\nEOF" })).toBe(false);
    expect(blocked({ command: "bash -o pipefail script.sh <<EOF\nopen -a Safari https://example.test\nEOF" })).toBe(
      false,
    );
  });

  it("reads a wrapper payload only where the wrapper starts a command, never as an argument", () => {
    const passes = [
      `echo trap 'open -a Safari https://example.test' DEBUG`,
      `echo watch 'open -a Safari https://example.test'`,
      `printf '%s\\n' su me -c 'open -a Safari https://example.test'`,
      `echo env -S 'open -a Safari https://example.test'`,
    ];
    expect(passes.filter((command) => blocked({ command }))).toEqual([]);
    const refused = [
      `trap 'open -a Safari https://example.test' DEBUG`,
      `true && watch 'open -a Safari https://example.test'`,
      `sudo su me -c 'open -a Safari https://example.test'`,
    ];
    expect(refused.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("looks through a shell wrapper, prefix wrappers and a compound line", () => {
    const forms = [
      "bash -c 'open -a Safari https://example.test'",
      'zsh -lc "npx playwright open https://example.test"',
      "timeout 30 open https://example.test",
      "sudo -u me open -a Safari",
      "caffeinate -i npx @playwright/cli open",
      "nohup chromium &",
      "cd /tmp && open -a 'Google Chrome' https://example.test",
      "true; open https://example.test",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes the browser verbs that ARE the door", () => {
    const forms = [
      "slopweaver browser open --url https://example.test",
      "slopweaver browser read --session s",
      "slopweaver browser act --session s --do reload --observation o",
      "slopweaver browser close --session s",
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("renders the four-line refusal naming the launch, the verbs and its own hatch", () => {
    const verdict = classifyBrowserLaunchCommand({ command: "open -a Safari https://example.test", env: {} });
    expect(verdict.blocked).toBe(true);
    const lines = (verdict as { message: string }).message.split("\n");
    expect(lines.length).toBe(4);
    expect(lines[0]).toContain("open -a Safari https://example.test blocked because it launches or drives a browser");
    expect(lines[0]).toContain("macos-open: use `slopweaver browser open --url <url>`");
    expect(lines[2]).toBe(
      "To override use the designated escape hatch SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1 open -a Safari https://example.test.",
    );
  });

  it("opens on its own hatch only, ambient or inline on the one segment it prefixes", () => {
    const launch = "open -a Safari https://example.test";
    expect([
      blocked({ command: launch, env: { SLOPWEAVER_ALLOW_BROWSER_LAUNCH: "1" } }),
      blocked({ command: `SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1 ${launch}` }),
      blocked({ command: `SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1 ${launch} && open https://example.test` }),
      blocked({ command: launch, env: { SLOPWEAVER_ALLOW_RAW: "1" } }),
      blocked({ command: launch, env: { SLOPWEAVER_ALLOW_BASH: "1" } }),
      blocked({ command: `SLOPWEAVER_ALLOW_RAW=1 ${launch}` }),
    ]).toEqual([false, false, true, true, true, true]);
  });

  it("scopes an inline hatch to its own piece of a bare-& list, and keeps an export across it", () => {
    const launch = "open -a Safari https://example.test";
    expect([
      blocked({ command: `SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1 true & ${launch}` }),
      blocked({ command: `SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1 ${launch} & true` }),
      blocked({ command: `true & SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1 ${launch}` }),
      blocked({ command: `export SLOPWEAVER_ALLOW_BROWSER_LAUNCH=1; true & ${launch}` }),
      blocked({ command: `true & ${launch}`, env: { SLOPWEAVER_ALLOW_BROWSER_LAUNCH: "1" } }),
    ]).toEqual([true, false, false, false, false]);
  });
});

describe("evaluateHookPayload — the browser-launch walk", () => {
  const payload = ({ command }: { command: string }) => ({ tool_input: { command }, tool_name: "Bash" });

  it("refuses a launch whatever the raw and Python hatches say, and with no environment at all", () => {
    const decisions = [
      evaluateHookPayload({
        allowArtifact: false,
        allowPython: false,
        allowRaw: false,
        payload: payload({ command: "npx @playwright/cli open --extension" }),
      }),
      evaluateHookPayload({
        allowArtifact: true,
        allowPython: true,
        allowRaw: true,
        env: {},
        payload: payload({ command: "open -a 'Google Chrome' https://example.test" }),
      }),
    ];
    expect(decisions.map((decision) => decision.block)).toEqual([true, true]);
  });

  it("still returns another walk's refusal when an osascript heredoc has no body yet (the r2 review)", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      payload: payload({ command: "curl https://example.test && osascript <<EOF" }),
    });
    expect(decision.block).toBe(true);
    expect((decision as { message: string }).message).toContain("raw curl bypasses the door");
  });

  it("lifts only the browser refusal under its hatch, leaving an independent raw refusal standing", () => {
    const decision = evaluateHookPayload({
      allowArtifact: false,
      allowPython: false,
      allowRaw: false,
      env: { SLOPWEAVER_ALLOW_BROWSER_LAUNCH: "1" },
      payload: payload({ command: "open https://example.test && curl https://example.test" }),
    });
    expect(decision.block).toBe(true);
    const message = (decision as { message: string }).message;
    expect(message).toContain("raw curl bypasses the door");
    expect(message).not.toContain("SLOPWEAVER_ALLOW_BROWSER_LAUNCH");
  });
});
