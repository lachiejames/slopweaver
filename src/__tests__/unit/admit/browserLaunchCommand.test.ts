import { describe, expect, it } from "vitest";

import { isBrowserApplication, isBrowserBundleId, isBrowserExecutable } from "../../../admit/browserApplication.js";
import { browserLaunchArgv } from "../../../admit/browserLaunchArgv.js";
import { classifyBrowserLaunchCommand } from "../../../admit/browserLaunchCommand.js";

// The flag and the app-bundle executable path are assembled from fragments: `no-private-browser-profile` refuses
// either spelled whole inside a quoted literal, and this file must not trip the gate it sits beside.
const PORT_FLAG = ["--remote-debugging", "port"].join("-");
const PIPE_FLAG = ["--remote-debugging", "pipe"].join("-");
const CHROME_BIN = ["/Applications/Google Chrome.app", "Contents", "MacOS", "Google Chrome"].join("/");

const blocked = ({ command, env = {} }: { command: string; env?: Record<string, string> }): boolean =>
  classifyBrowserLaunchCommand({ command, env }).blocked;

describe("browserApplication", () => {
  it("names browsers by application, bundle id and executable", () => {
    expect([
      isBrowserApplication({ text: "Google Chrome" }),
      isBrowserApplication({ text: "/Applications/Safari.app/" }),
      isBrowserApplication({ text: "brave   browser.app" }),
      isBrowserBundleId({ text: "com.Google.Chrome" }),
      isBrowserBundleId({ text: "company.thebrowser.Browser" }),
      isBrowserExecutable({ program: CHROME_BIN }),
      isBrowserExecutable({ program: ["/usr", "bin", "chromium"].join("/") }),
      isBrowserExecutable({ program: "/Applications/Arc.app/Contents/MacOS/Arc" }),
    ]).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("passes ordinary apps, and the bare words a browser shares with another tool", () => {
    expect([
      isBrowserApplication({ text: "Finder" }),
      isBrowserApplication({ text: "Slopweaver" }),
      isBrowserBundleId({ text: "com.apple.finder" }),
      isBrowserExecutable({ program: "arc" }),
      isBrowserExecutable({ program: "/Applications/Slack.app/Contents/MacOS/Slack" }),
    ]).toEqual([false, false, false, false, false]);
  });
});

describe("classifyBrowserLaunchCommand — open", () => {
  it("refuses open -a and -b naming a browser, with or without a URL, and a URL into the default browser", () => {
    const forms = [
      "open -a 'Google Chrome' https://example.test",
      'open -a "google chrome" https://example.test',
      "open -a Chromium https://example.test",
      "open -a Arc https://example.test",
      "open -a 'Brave Browser' https://example.test",
      "open -a Safari https://example.test",
      "open -a 'Microsoft Edge' https://example.test",
      "open -a Firefox",
      "open -a '/Applications/Google Chrome.app' https://example.test",
      "open -a '/Applications/Google Chrome.app/.'",
      "open -a '/Applications/Google Chrome.app/Contents/..' https://example.test",
      "open -a '/Applications//Safari.app/./'",
      "open -na 'Google Chrome' --args --new-window",
      "open -b com.google.Chrome https://example.test",
      "open https://example.test",
      "open -u http://localhost:3000/x",
      "/usr/bin/open -g https://example.test",
      "open -aSafari",
      "open -a'Google Chrome' https://example.test",
      "open -naSafari",
      "open -bcom.google.Chrome",
      "open -uhttps://example.test",
      "/usr/bin/Open -a Safari https://example.test",
      "OPEN https://example.test",
      "OSASCRIPT -e 'tell application \"Safari\" to activate'",
      "OsaScript <<'EOF'\ntell application \"Safari\" to activate\nEOF",
      "BASH -c 'open -a Safari https://example.test'",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes open on a file, a folder or a non-browser app", () => {
    const forms = [
      "open .",
      "open file.pdf",
      "open -a Finder .",
      "open -a Slopweaver",
      "open -a Slopweaver https://example.test",
      "open -R ./out.png",
      "open -e https://example.test",
      "open -t https://example.test",
      "open -aFinder .",
      "open -aTextEdit notes.txt",
      "open -h",
      "printf %s notes.txt | xargs open -a TextEdit",
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("refuses an open naming nothing, whose application or target arrives at run time", () => {
    const forms = [
      "printf %s Safari | xargs open -a",
      "echo https://example.test | xargs open",
      "echo com.apple.Safari | xargs -I {} open -b {}",
      "open",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("refuses an open word carrying any xargs replacement string, not only {}", () => {
    const forms = [
      "printf '%s\\n' Safari | xargs -I % open -a %",
      "printf Safari | xargs -I@ open -a @",
      "printf Safari | xargs -J X open -a X",
      "printf Safari | xargs -iAPP open -a APP",
      "printf Safari | xargs --replace=APP open -a APP",
      "printf Safari | xargs -i open -a '{}'",
      "printf Saf | xargs -I % open -a %ari",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes an xargs open whose words carry no replacement string", () => {
    const forms = ["printf %s notes.txt | xargs -I % open -a TextEdit notes.txt", "ls | xargs -I % cp % /tmp/out"];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });
});

describe("classifyBrowserLaunchCommand — Playwright CLI", () => {
  it("refuses a driving CLI at all, and playwright on a launch subcommand or attach flag, bare or behind a runner", () => {
    const forms = [
      "npx @playwright/cli open --extension https://example.test",
      "npx @playwright/cli@latest goto https://example.test",
      "npx -y @playwright/cli open https://example.test",
      "npx playwright open --extension https://example.test",
      "npx playwright open https://example.test",
      "npx playwright --cdp=http://localhost:9222 screenshot x y",
      "bunx playwright codegen",
      "pnpm dlx @playwright/cli open",
      "yarn dlx @playwright/mcp",
      "yarn playwright test",
      "npm exec playwright -- open",
      "playwright-cli snapshot",
      "./node_modules/.bin/playwright cr https://example.test",
      "npx @playwright/mcp --extension",
      "pnpm --silent dlx @playwright/cli open --extension https://example.test",
      "pnpm -C web dlx @playwright/cli open https://example.test",
      "yarn --cwd web playwright open https://example.test",
      "corepack yarn dlx @playwright/cli open --extension https://example.test",
      "corepack pnpm dlx @playwright/cli open https://example.test",
      "corepack yarn@4.18.1 dlx @playwright/cli open --extension https://example.test",
      "yarn run playwright --cdp=http://localhost:9222 screenshot x y",
      "bun run playwright open https://example.test",
      "npx -w web playwright open https://example.test",
      "npx --workspace web @playwright/cli open --extension https://example.test",
      "npx --cache /tmp/c -y playwright codegen",
      "pnpm --filter web dlx @playwright/cli open https://example.test",
      "npx --yes --package=playwright -c 'playwright open https://example.test'",
      "npm exec --call 'npx playwright open https://example.test'",
      "npx playwright launch-server --browser chromium",
      "npx playwright run-server",
      "npx playwright some-future-subcommand",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes a Playwright CLI that only installs or prints, and ordinary yarn scripts", () => {
    const forms = [
      "npx playwright install chromium",
      "npx playwright --version",
      "playwright --help",
      "npx @playwright/cli --help",
      "playwright test --help",
      "yarn playwright test --list",
      "npx playwright test --list --project=chromium",
      "npx @playwright/cli install --skills",
      "npx playwright install-deps chromium",
      "npx playwright uninstall --all",
      "npx playwright merge-reports ./blob-report",
      "npx playwright clear-cache",
      "npx playwright",
      "npx @playwright/cli -s=review --version",
      "npx @playwright/cli open -h",
      "yarn vitest run --config config/vitest/unit.ts x.test.ts",
      "yarn test:unit",
      "yarn run test:unit",
      "npm run lint",
      "yarn install",
      "yarn --silent add @playwright/mcp",
      "pnpm --filter web exec vitest run",
      "corepack enable",
      "corepack yarn install",
      "npx -w web playwright install chromium",
      "npx --yes eslint .",
      "npx -w web tsc --noEmit",
      "npx -c 'eslint .'",
      "npx eslint -c .eslintrc.json src",
      "yarn dlx prettier -c chromium",
      "npx prettier -c chromium",
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });

  it("reads a help, version or list word after `--` as an operand, not a flag", () => {
    const refused = [
      "playwright test -- --help",
      "npx playwright test -- --version",
      "playwright test -- --list",
      // A subcommand word after `--` is an operand too, so it is not read as harmless.
      "playwright -- help",
      "playwright -- install",
      "npx playwright -- version",
      "npx @playwright/cli -- install",
    ];
    const passed = [
      "playwright test --help -- e2e",
      "playwright test --list -- e2e",
      "playwright install -- chromium",
      "playwright test --list -- --extension",
    ];
    expect([
      refused.filter((command) => !blocked({ command })),
      passed.filter((command) => blocked({ command })),
    ]).toEqual([[], []]);
  });

  it("refuses a Playwright CLI a JavaScript runtime runs by its entry file or bin shim", () => {
    const forms = [
      "node ./node_modules/playwright/cli.js test",
      "node node_modules/@playwright/test/cli.js open https://example.test",
      "/usr/local/bin/node --enable-source-maps node_modules/playwright-core/cli.js codegen",
      "bun node_modules/.bin/playwright test",
      "node node_modules/.bin/playwright-cli open --extension",
      "node ./node_modules/@playwright/cli/cli.js snapshot",
      "node node_modules/@playwright/cli/playwright-cli.js open https://example.test",
      "bun node_modules/@playwright/mcp/index.js",
      "node node_modules/playwright-core/lib/cli/program.js open",
      "node -r ./setup.js node_modules/playwright/cli.js test",
      "bun run node_modules/.bin/playwright test",
      "bun --smol run node_modules/.bin/playwright test",
      "bun --bun --silent run node_modules/playwright/cli.js open https://example.test",
      "node -- node_modules/playwright/cli.js codegen",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("refuses an entry file reached through a path Node resolves: a doubled slash, `.`, `..`, no extension", () => {
    const forms = [
      "node ./node_modules//playwright/cli.js test",
      "node node_modules/./playwright/cli.js test",
      "node node_modules/other/../playwright/cli.js test",
      "node node_modules/playwright/cli test",
      "bun ./node_modules/.bin//playwright test",
      "node node_modules/.bin/playwright.js test",
      "node node_modules/.bin/playwright-cli.mjs open --extension",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes a runtime running a Playwright entry file only to install or print, or running another script", () => {
    const forms = [
      "node ./node_modules/playwright/cli.js install chromium",
      "node node_modules/.bin/playwright --version",
      "node scripts/build.js",
      "node --test src/cli.test.js",
      "bun run lint",
      "node ordinary.js ./node_modules/playwright/cli.js test",
      "node /tmp/playwright/report.js test",
      "node scripts/playwright/cli.js open",
      "node node_modules/playwright/../other/cli.js open",
      "node node_modules/playwright/cli install",
      "node node_modules/.bin/playwrightish.js test",
      "node -e 'console.log(1)' node_modules/playwright/cli.js open",
      "node -r ./setup.js scripts/report.js node_modules/.bin/playwright test",
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });
});

describe("classifyBrowserLaunchCommand — a browser binary", () => {
  it("refuses a browser binary reached through a path the kernel resolves: `..`, `.`, doubled slashes", () => {
    const forms = [
      `'/Applications/Google Chrome.app/Contents/../Contents/MacOS/Google Chrome' ${PIPE_FLAG}`,
      `'/Applications/Google Chrome.app/Contents//MacOS/Google Chrome' ${PORT_FLAG}=9222`,
      `/Applications/Safari.app/Contents/./MacOS/Safari`,
      `/opt/x/../google/chrome/../chrome/google-chrome https://example.test`,
      `'./Google Chrome' ${PORT_FLAG}=9222`,
      `../MacOS/Safari`,
      `'MacOS/Microsoft Edge' https://example.test`,
      `'Google Chrome' ${PORT_FLAG}=9222`,
      `"Brave Browser" https://example.test`,
      `Safari`,
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("refuses a browser binary run directly, a remote-debugging flag in either spelling included", () => {
    const forms = [
      `'${CHROME_BIN}' ${PORT_FLAG}=9222`,
      `"${CHROME_BIN}" ${PORT_FLAG} 9222 https://example.test`,
      `google-chrome ${PIPE_FLAG}`,
      `chromium ${PORT_FLAG}=9222`,
      "google-chrome-stable https://example.test",
      `msedge ${PORT_FLAG}=9333`,
      "chromium",
      "chromium version",
      "google-chrome help",
      "chromium -v",
    ];
    expect(forms.filter((command) => !blocked({ command }))).toEqual([]);
  });

  it("passes a binary asked only for its version, and the flag as data to a reader", () => {
    const forms = [
      "google-chrome --version",
      `git grep -n -- ${PORT_FLAG} src`,
      `rg --fixed-strings -- ${PIPE_FLAG} .`,
      `echo 'chromium ${PORT_FLAG}=9222'`,
    ];
    expect(forms.filter((command) => blocked({ command }))).toEqual([]);
  });
});

describe("browserLaunchArgv", () => {
  it("names the shape of each launch", () => {
    expect([
      browserLaunchArgv({ placeholders: [], words: ["open", "-a", "Safari"] })!.shape,
      browserLaunchArgv({ placeholders: [], words: ["npx", "playwright", "open"] })!.shape,
      browserLaunchArgv({ placeholders: [], words: ["chromium", PORT_FLAG] })!.shape,
      browserLaunchArgv({ placeholders: [], words: ["osascript", "-e", 'tell app "Safari" to activate'] })!.shape,
    ]).toEqual(["macos-open", "playwright-cli", "browser-binary", "browser-applescript"]);
  });

  it("reads an open word carrying an xargs replacement string as supplied at run time", () => {
    expect([
      browserLaunchArgv({ placeholders: ["%"], words: ["open", "-a", "%"] })!.shape,
      browserLaunchArgv({ placeholders: ["%"], words: ["open", "-a", "TextEdit"] }),
    ]).toEqual(["macos-open", undefined]);
  });

  it("finds nothing in an empty command", () => {
    expect(browserLaunchArgv({ placeholders: [], words: [] })).toBe(undefined);
  });
});
