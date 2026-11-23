/**
 * The seat gate's criterion: which command lines build the type checker over the whole tree, and which
 * of the shapes a seat really types stay local. Every refused row below is a command a seat ran,
 * verbatim or trimmed to its shape.
 */

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { WHOLE_PROGRAM_GATES, WHOLE_TREE_GATES } from "../../../admit/devLintInvocation.js";
import { TSC_BOOLEAN_OPTIONS } from "../../../admit/tscInvocation.js";
import { classifyWholeTreeCheck } from "../../../admit/wholeTreeCheck.js";
import { lintChecks } from "../../../devLint/devLint.js";
import { startCompiler } from "../../../devLint/namedObjectParamsProgram.js";

/** What the classifier said about one command, as the refusal would name it. */
function what({ command, cwd }: { command: string; cwd?: string }): string {
  const judged = classifyWholeTreeCheck({ command, ...(cwd === undefined ? {} : { cwd }) });
  return judged.kind === "whole-tree" ? judged.what : "allowed";
}

describe("classifyWholeTreeCheck", () => {
  it.each([
    ["cd /wt/x; timeout 900 yarn lint 2>&1 | head -30", "yarn lint (the whole lint lap, tsgolint included)"],
    ["yarn typecheck 2>&1 | tail -20", "yarn typecheck (tsc over the whole project)"],
    ["yarn validate", "yarn validate (the whole lint lap, then tsc over the whole project)"],
    ["yarn tsc --noEmit -p . 2>&1 | tail -3", "tsc --noEmit -p . (tsc over the whole project)"],
    ["npx tsc", "tsc (tsc over the whole project)"],
    // `build.ts` is --outDir's value, so no file narrows the check
    ["tsc --outDir build.ts", "tsc --outDir build.ts (tsc over the whole project)"],
    ["tsc --noEmit --target es2022.ts", "tsc --noEmit --target es2022.ts (tsc over the whole project)"],
    // `--showConfig` is --outDir's value here, so tsc still checks the project
    ["tsc --outDir --showConfig", "tsc --outDir --showConfig (tsc over the whole project)"],
    // A response file is never opened, so its contents cannot narrow the check
    ["tsc @files.rsp", "tsc @files.rsp (tsc over the whole project)"],
    [
      "node --max-old-space-size=8192 node_modules/typescript/bin/tsc --noEmit -p site/tsconfig.json",
      "tsc --noEmit -p site/tsconfig.json (tsc over the whole project)",
    ],
    ["slopweaver dev lint", "slopweaver dev lint (the whole lint lap, tsgolint included)"],
    ["./bin/slopweaver dev lint --lane full", "slopweaver dev lint (the whole lint lap, tsgolint included)"],
    ["yarn tsx src/cli/index.ts dev lint > out.txt", "slopweaver dev lint (the whole lint lap, tsgolint included)"],
    [
      "slopweaver dev lint --only house-rules,oxlint 2>&1 | tail -15",
      "slopweaver dev lint --only oxlint (a whole-tree type-checker gate)",
    ],
    ["yarn lint --only named-object-params", "yarn lint --only named-object-params (a whole-tree type-checker gate)"],
    [
      "yarn oxlint --type-aware --tsconfig ./config/typescript/tsconfig.lint.json .",
      "oxlint --type-aware over . (tsgolint)",
    ],
    ["oxlint --type-aware", "oxlint --type-aware over the whole tree (tsgolint)"],
    ["oxlint --type-aware src/admit", "oxlint --type-aware over src/admit (tsgolint)"],
    ["git status && FOO=1 yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    // Every row below is a way past a first draft of this gate.
    [
      "yarn oxlint --type-aware --tsconfig config/typescript/tsconfig.lint.json src eval hooks",
      "oxlint --type-aware over src eval hooks (tsgolint)",
    ],
    ["oxlint --type-aware 'src/**/*.ts'", "oxlint --type-aware over src/**/*.ts (tsgolint)"],
    [
      "oxlint --type-aware --tsconfig config/typescript/tsconfig.lint.json",
      "oxlint --type-aware over the whole tree (tsgolint)",
    ],
    ["bash -lc 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    // A wrapper named by its path is still peeled
    ["/usr/bin/env yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    // npm's own aliases for `run`
    ["npm run-script typecheck", "yarn typecheck (tsc over the whole project)"],
    ["npm urn validate", "yarn validate (the whole lint lap, then tsc over the whole project)"],
    // A bare `&` ends a command as surely as `;`, and a subshell's `)` is not part of the script
    ["true & yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["true&yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["(yarn typecheck)", "yarn typecheck (tsc over the whole project)"],
    ["cd /tmp/app & yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["cd /tmp/app | yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["(cd /tmp/app) && yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["(cd /tmp/app; true); yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    // A command starts in more places than a segment's head
    ["case x in x) yarn typecheck;; esac", "yarn typecheck (tsc over the whole project)"],
    ["if true; then yarn lint; fi", "yarn lint (the whole lint lap, tsgolint included)"],
    ["time yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["echo . | xargs yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["nohup yarn lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["nice -n5 yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["case x in a) true;; b) yarn typecheck;; esac", "yarn typecheck (tsc over the whole project)"],
    // find's actions, and npm reading its own options on both sides of the script
    ["find . -name x -exec yarn typecheck ;", "yarn typecheck (tsc over the whole project)"],
    ["sudo /usr/bin/find . -execdir yarn typecheck ;", "yarn typecheck (tsc over the whole project)"],
    ["find package.json -exec echo {} \\; -exec yarn typecheck \\;", "yarn typecheck (tsc over the whole project)"],
    ['find package.json "-exec" yarn typecheck \\;', "yarn typecheck (tsc over the whole project)"],
    ["find . '-execdir' yarn typecheck ';'", "yarn typecheck (tsc over the whole project)"],
    ["find . -exec find . -exec yarn typecheck \\; \\;", "yarn typecheck (tsc over the whole project)"],
    ["find . -exec grep x {} + -exec yarn typecheck \\;", "yarn typecheck (tsc over the whole project)"],
    // A word quoted before a bare `&` does not hide the command after it.
    ['echo "x"&yarn typecheck', "yarn typecheck (tsc over the whole project)"],
    ["trap 'yarn typecheck' DEBUG; :", "yarn typecheck (tsc over the whole project)"],
    ["trap -- 'yarn lint' EXIT", "yarn lint (the whole lint lap, tsgolint included)"],
    ["echo \\>&yarn lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["npm run slopweaver -- dev lint", "slopweaver dev lint (the whole lint lap, tsgolint included)"],
    ["npm run slopweaver --silent -- dev lint", "slopweaver dev lint (the whole lint lap, tsgolint included)"],
    // `watch` without `-x` hands its words to `sh -c`.
    ["watch 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    ["watch -n 5 -d yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["npm exec --loglevel silent --yes tsc -- -p .", "tsc -- -p . (tsc over the whole project)"],
    // One option taking a value and the next not, in one line.
    [
      "tsx --tsconfig tsconfig.json --no-cache src/cli/index.ts dev lint",
      "slopweaver dev lint (the whole lint lap, tsgolint included)",
    ],
    // A wrapper at a command start the backstop did not list
    ["case x in x) env yarn typecheck;; esac", "yarn typecheck (tsc over the whole project)"],
    // oxlint's second checker mode, and a wrapper option that takes a value
    ["oxlint --type-check .", "oxlint --type-aware over . (tsgolint)"],
    ["stdbuf -o 0 yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["case x in x) stdbuf -o 0 yarn lint;; esac", "yarn lint (the whole lint lap, tsgolint included)"],
    ["watch -n 5 yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["arch -arm64 yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ['env -S "yarn typecheck"', "yarn typecheck (tsc over the whole project)"],
    ["coproc yarn typecheck; wait", "yarn typecheck (tsc over the whole project)"],
    ["f(){ yarn typecheck;};f", "yarn typecheck (tsc over the whole project)"],
    // Nested legacy backticks, npm's x and -c, BSD xargs -J
    ["echo `echo \\`yarn typecheck\\``", "yarn typecheck (tsc over the whole project)"],
    ["npm x -- tsc", "tsc (tsc over the whole project)"],
    ["tsc --help false", "tsc --help false (tsc over the whole project)"],
    // Line continuations, env -S's trailing argv, tsc's real entrypoints, yarn build
    ["yarn \\\n  typecheck", "yarn typecheck (tsc over the whole project)"],
    ["timeout 900 \\\n  yarn lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["yar\\\nn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["env -S yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    // A user shell's `-c` value is a command line of its own.
    ["runuser -c 'yarn typecheck' root", "yarn typecheck (tsc over the whole project)"],
    // A literal here-string is the source a shell reading stdin runs.
    ["bash <<< 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    ["sh <<<'yarn lint'", "yarn lint (the whole lint lap, tsgolint included)"],
    ["env bash <<< 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    ["echo x & bash <<< 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    // A long option not known to run nothing is read as running the payload.
    ["bash --protected -c 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    // `env -S` reads `\_` and the whitespace escapes as argument separators.
    ["env -S 'yarn\\_typecheck'", "yarn typecheck (tsc over the whole project)"],
    // A preload runs the compiler whatever the rest of the line evaluates.
    ["node --require=./node_modules/typescript/lib/tsc.js -e ''", "tsc (tsc over the whole project)"],
    ["node -r node_modules/typescript/lib/tsc.js x.js", "tsc (tsc over the whole project)"],
    ["NODE_OPTIONS=--require=./node_modules/typescript/lib/tsc.js node -e ''", "tsc (tsc over the whole project)"],
    ["NODE_OPTIONS='-r node_modules/typescript/lib/tsc.js' node x.js", "tsc (tsc over the whole project)"],
    ["export NODE_OPTIONS=--require=node_modules/typescript/lib/tsc.js; node x.js", "tsc (tsc over the whole project)"],
    ["env --split-string='yarn\\tlint'", "yarn lint (the whole lint lap, tsgolint included)"],
    // A short-circuit may skip the export, or the `cd`, before the check.
    [
      "false && export SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1; yarn typecheck",
      "yarn typecheck (tsc over the whole project)",
    ],
    [
      "true || export SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1; yarn typecheck",
      "yarn typecheck (tsc over the whole project)",
    ],
    ["bash --debugger -c 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    ["bash --restricted --debug -c 'yarn lint'", "yarn lint (the whole lint lap, tsgolint included)"],
    [
      "export SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 & wait; yarn typecheck",
      "yarn typecheck (tsc over the whole project)",
    ],
    // One source file beside a directory or a glob is still the whole tree.
    [
      "tsc src/admit/wholeTreeCheck.ts src/**/*.ts",
      "tsc src/admit/wholeTreeCheck.ts src/**/*.ts (tsc over the whole project)",
    ],
    ["tsc src/a.ts .", "tsc src/a.ts . (tsc over the whole project)"],
    ["yarn tsc src/a.ts src", "tsc src/a.ts src (tsc over the whole project)"],
    // A host's subcommand comes before the script it runs.
    ["tsx watch src/cli/index.ts dev lint", "slopweaver dev lint (the whole lint lap, tsgolint included)"],
    ["yarn tsx watch src/cli/index.ts dev lint", "slopweaver dev lint (the whole lint lap, tsgolint included)"],
    ["tsx watch node_modules/typescript/bin/tsc -p .", "tsc -p . (tsc over the whole project)"],
    ["node inspect node_modules/typescript/bin/tsc -p .", "tsc -p . (tsc over the whole project)"],
    ["SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 echo ok & yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["runuser root --command='yarn lint'", "yarn lint (the whole lint lap, tsgolint included)"],
    ["sudo su -c 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    ["su root -c'tsc -p .'", "tsc -p . (tsc over the whole project)"],
    ["node node_modules/typescript/lib/tsc.js --noEmit -p .", "tsc --noEmit -p . (tsc over the whole project)"],
    ["node node_modules/typescript/lib/_tsc.js", "tsc (tsc over the whole project)"],
    ["yarn build", "yarn build (tsc over the src/ build project, CI's compile leg)"],
    ["yarn typecheck --showConfig false", "yarn typecheck (tsc over the whole project)"],
    ["npm exec -c 'tsc -p .'", "tsc -p . (tsc over the whole project)"],
    ["npx --call='yarn lint'", "yarn lint (the whole lint lap, tsgolint included)"],
    ["xargs -J % yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["node node_modules/.bin/tsc", "tsc (tsc over the whole project)"],
    // yarn's workspace subcommand names the workspace before the script
    ["yarn workspace slopweaver typecheck", "yarn typecheck (tsc over the whole project)"],
    ["yarn workspace slopweaver run lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["yarn workspaces foreach -A run lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["coproc CHECK { yarn typecheck; }", "yarn typecheck (tsc over the whole project)"],
    ["function f { yarn lint; }; f", "yarn lint (the whole lint lap, tsgolint included)"],
    ["env --split-string='yarn lint'", "yarn lint (the whole lint lap, tsgolint included)"],
    ["/usr/bin/time -o /tmp/t yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["flock /tmp/lint.lock yarn lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["flock /tmp/lint.lock -c 'yarn typecheck'", "yarn typecheck (tsc over the whole project)"],
    ["flock -w 5 --command='yarn lint' /tmp/lint.lock", "yarn lint (the whole lint lap, tsgolint included)"],
    ["if true; then FORCE=1 timeout 60 yarn lint; fi", "yarn lint (the whole lint lap, tsgolint included)"],
    ["npm run lint --only jsdoc-tags", "yarn lint (the whole lint lap, tsgolint included)"],
    ["npm run lint --lane local", "yarn lint (the whole lint lap, tsgolint included)"],
    // An option value before the script is not the script
    ["node -r ./preload.cjs node_modules/typescript/bin/tsc -p .", "tsc -p . (tsc over the whole project)"],
    [
      "tsx --tsconfig tsconfig.json src/cli/index.ts dev lint",
      "slopweaver dev lint (the whole lint lap, tsgolint included)",
    ],
    // Nesting past the depth the walk reads is refused, never waved through
    ["echo $(echo $(echo $(echo $(echo $(yarn typecheck)))))", "a command nested more than 4 levels deep, unread"],
    ["echo $(echo $(echo $(echo $(yarn typecheck))))", "yarn typecheck (tsc over the whole project)"],
    ["sh -c 'yarn lint'", "yarn lint (the whole lint lap, tsgolint included)"],
    ['echo "$(yarn typecheck)"', "yarn typecheck (tsc over the whole project)"],
    ["eval 'yarn validate'", "yarn validate (the whole lint lap, then tsc over the whole project)"],
    ["yarn run lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["npm run typecheck", "yarn typecheck (tsc over the whole project)"],
    ["corepack yarn validate", "yarn validate (the whole lint lap, then tsc over the whole project)"],
    ["yarn --cwd . lint", "yarn lint (the whole lint lap, tsgolint included)"],
    // A value-taking front-end option read as the script.
    ["npm --prefix . run typecheck", "yarn typecheck (tsc over the whole project)"],
    ["npm --prefix=. run typecheck", "yarn typecheck (tsc over the whole project)"],
    ["pnpm -C . typecheck", "yarn typecheck (tsc over the whole project)"],
    ["yarn --workspace slopweaver validate", "yarn validate (the whole lint lap, then tsc over the whole project)"],
    ["SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 echo $(yarn typecheck)", "yarn typecheck (tsc over the whole project)"],
    // An npm option this does not know took a value, read as the program.
    ["npm --loglevel silent exec -- tsc -p .", "tsc -p . (tsc over the whole project)"],
    ["npm exec --allow-scripts typescript -- tsc -p .", "tsc -p . (tsc over the whole project)"],
    ["yarn workspaces foreach -A --since HEAD run typecheck", "yarn typecheck (tsc over the whole project)"],
    ["node --require ./preload.js node_modules/typescript/bin/tsc -p .", "tsc -p . (tsc over the whole project)"],
    // A wrapper option missing from the table took a value, read as the command.
    ["runuser -u root -s /bin/sh yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    // After `--` a print flag is a path, and `.` is still the whole tree.
    ["oxlint --type-aware -- . --help", "oxlint --type-aware over . --help (tsgolint)"],
    ["cat <<EOF\n$(yarn typecheck)\nEOF", "yarn typecheck (tsc over the whole project)"],
    ["eval -- yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    // Node's own package runner runs the same scripts.
    ["node --run typecheck", "yarn typecheck (tsc over the whole project)"],
    ["node --run=validate", "yarn validate (the whole lint lap, then tsc over the whole project)"],
    ["node --run lint", "yarn lint (the whole lint lap, tsgolint included)"],
    ["command yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    // The finding: three seats' laps took load to 61.7, prettier and knip among them.
    [
      "slopweaver dev lint --only prettier,oxlint,knip,constraints,hygiene",
      "slopweaver dev lint --only oxlint,prettier,knip (a whole-tree type-checker gate; a whole-tree CI gate)",
    ],
    ["yarn lint --only prettier", "yarn lint --only prettier (a whole-tree CI gate)"],
    ["yarn prettier --check . 2>&1 | tail", "prettier over . (a whole-tree format check, CI's lint job)"],
    ["npx prettier -c src docs", "prettier over src docs (a whole-tree format check, CI's lint job)"],
    ["time prettier --list-different '**/*.md'", "prettier over **/*.md (a whole-tree format check, CI's lint job)"],
    [
      "node node_modules/prettier/bin/prettier.cjs --check .",
      "prettier over . (a whole-tree format check, CI's lint job)",
    ],
    ["yarn knip", "knip (whole-project dependency resolution, CI's lint job)"],
    ["npx knip --production", "knip (whole-project dependency resolution, CI's lint job)"],
    ["node node_modules/.bin/knip", "knip (whole-project dependency resolution, CI's lint job)"],
    ["if true; then knip; fi", "knip (whole-project dependency resolution, CI's lint job)"],
    // A program's own `-c` was read as npx's call, which hid the program behind it.
    ["npx vitest run -c config/vitest/unit.ts", "vitest (a whole test lane, no file named)"],
    ["npx prettier -c prettier .", "prettier over prettier . (a whole-tree format check, CI's lint job)"],
  ])("refuses %s", (command, expected) => {
    expect(what({ command })).toBe(expected);
  });

  it.each([
    "yarn lint:local",
    "yarn validate:local",
    "slopweaver dev lint --lane local",
    "slopweaver dev lint --only jsdoc-tags,doc-links",
    "yarn tsx src/cli/index.ts dev lint --only file-size-ratchet",
    "slopweaver dev lint --help",
    "yarn oxlint src/admit/wholeTreeCheck.ts",
    // A literal bracket in a route file name is not a glob.
    "yarn oxlint --type-aware 'site/app/[slug]/page.tsx' 'src/a[1].ts'",
    "yarn oxlint .",
    "yarn oxlint --type-aware --tsconfig ./config/typescript/tsconfig.lint.json src/a.ts src/b.test.ts",
    "tsc --version",
    "tsc --noEmit src/a.ts",
    "tsc --outDir build src/a.ts",
    "tsc --noEmit --strict src/a.ts",
    "tsc --outDir --noEmit src/a.ts",
    // Every boolean tsc declares is valueless here, in any case or dash spelling
    "tsc --noResolve src/a.ts",
    "tsc -NOEMIT -strict false src/a.ts",
    "yarn vitest run --config config/vitest/unit.ts src/__tests__/unit/admit/wholeTreeCheck.test.ts",
    "slopweaver dev build",
    "echo yarn lint",
    "grep -n 'yarn typecheck' package.json",
    "SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 yarn lint",
    "oxlint --type-aware $(git diff --name-only -- '*.ts')",
    "yarn --cwd /tmp/app typecheck",
    "npm --prefix /tmp/app run typecheck",
    "yarn --cwd=/tmp/app typecheck",
    "cd /tmp/app && yarn typecheck",
    "(cd /tmp/app && yarn typecheck)",
    "pgrep -f tsgolint",
    "echo then yarn lint",
    "yarn build --help",
    "node scripts/report.js tsc",
    // A dry run runs nothing, and a path after `node -e` is the program's data.
    "yarn workspaces foreach -A --dry-run run typecheck",
    "yarn workspaces foreach -A -n run typecheck",
    "node -e 'console.log(process.argv.slice(1))' node_modules/typescript/lib/tsc.js",
    "pnpm exec -c prettier --check src/x.ts",
    // bash 5.3 runs `CHECK` here, not yarn: a coprocess name only precedes a compound command
    "coproc CHECK yarn typecheck; wait",
    "yarn oxlint --type-aware --debug=files .",
    "yarn oxlint --type-aware --debug files src/admit/wholeTreeCheck.ts",
    // A lookup names the command without running it.
    "command -v tsc",
    "node --run lint -- --only jsdoc-tags",
    "oxlint --type-aware --debug files,timings .",
    "oxlint --type-aware --debug=timings,files .",
    // An attached value and a declared flag take no next word, so `tsc` is grep's pattern.
    "xargs -n1 grep tsc notes.txt",
    "xargs -0 grep tsc notes.txt",
    "sudo -E grep tsc notes.txt",
    "command -V yarn typecheck",
    "sudo -l yarn typecheck",
    "yarn typecheck --help",
    "yarn typecheck --showConfig",
    "oxlint --type-aware --print-config",
    "xargs -n 1 grep tsc",
    "grep do tsc notes.txt",
    "npm run lint -- --only jsdoc-tags",
    "ps -eo args | grep -E oxlint",
    "sleep 1 & echo hi",
    "yarn oxlint src/a.ts 2>&1 & wait",
    "bash -c 'SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 yarn lint'",
    "runuser -c 'yarn oxlint src/a.ts' root",
    "su -- root yarn typecheck",
    "grep foo{ tsc notes.txt",
    "grep { tsc notes.txt",
    "cat <<< 'yarn typecheck'",
    "grep bash <<< 'yarn typecheck'",
    "node x.js --require=node_modules/typescript/lib/tsc.js",
    "grep -- -exec yarn typecheck notes.txt",
    'grep -- "-exec" yarn typecheck notes.txt',
    "npx --version tsc",
    "flock /tmp/lint.lock -c 'echo yarn typecheck'",
    "yarn --help typecheck",
    "find . -prune -exec grep -- -exec yarn typecheck \\;",
    'echo "x&yarn typecheck"',
    "trap - DEBUG",
    "trap -p EXIT",
    "echo trap 'yarn typecheck' DEBUG",
    "echo x 2>&1 yarn typecheck",
    'find . -name "$x" -exec echo yarn typecheck \\;',
    "NODE_OPTIONS=--max-old-space-size=4096 node x.js",
    "bash --help -c 'yarn typecheck'",
    "bash --version -c 'yarn typecheck'",
    "env -S 'echo\\c yarn typecheck'",
    "env -S 'yarn\\\\_typecheck'",
    "node --run typecheck -- --help",
    "arch -arm64 grep tsc notes.txt",
    "tsc --noEmit src/a.ts src/b.ts",
    "echo ok & SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 yarn typecheck",
    "SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 yarn typecheck & echo ok",
    // A lint-staged prettier pass, the formatter's write mode and a cheap-gate selection stay local.
    "yarn prettier --check src/admit/wholeTreeCheck.ts docs/toolchain.md",
    "git diff --name-only | xargs yarn prettier --check",
    "yarn prettier --check 'site/app/api/act/[verb]/route.ts'",
    "find docs -name '*.md' -exec prettier --check {} +",
    "npx -c 'ls node_modules/.bin/tsc'",
    "npm exec -c 'ls node_modules/.bin/vitest'",
    "yarn prettier --write .",
    "yarn format",
    "slopweaver dev lint --only constraints,hygiene",
    // The import organiser's whole-tree check is a cheap gate, measured in the guard's header.
    "node_modules/.bin/biome check .",
    "slopweaver dev lint --only biome-imports",
    "knip --help",
    "pgrep -f knip",
  ])("allows %s", (command) => {
    expect(what({ command })).toBe("allowed");
  });

  it("lets an inline hatch cover only its own segment, in either order", () => {
    expect(what({ command: "SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 yarn lint && yarn typecheck" })).toBe(
      "yarn typecheck (tsc over the whole project)",
    );
    expect(what({ command: "yarn typecheck; SLOPWEAVER_ALLOW_WHOLE_TREE_CHECK=1 yarn lint" })).toBe(
      "yarn typecheck (tsc over the whole project)",
    );
  });

  it("judges a typecheck by the directory it runs in, a sub-project of a checkout included", () => {
    // With no payload cwd, `app/..` is the root it names, never app/.
    expect(what({ command: "yarn --cwd /tmp/app/.. typecheck" })).toBe("allowed");
    expect(what({ command: "yarn --cwd app/.. typecheck" })).toBe("yarn typecheck (tsc over the whole project)");
    expect(what({ command: "yarn typecheck", cwd: "/dev/slopweaver/desktop" })).toBe(
      "yarn typecheck (tsc over the whole project)",
    );
    expect(what({ command: "yarn build", cwd: "/dev/slopweaver/desktop" })).toBe(
      "yarn build (tsc over the src/ build project, CI's compile leg)",
    );
    expect(what({ command: "cd .. && yarn typecheck", cwd: "/tmp/app/sub" })).toBe("allowed");
  });

  // `true || cd <elsewhere> && …` skips the `cd` and still runs the check here.
  it.each([
    ["true || cd /tmp/app && yarn typecheck", "yarn typecheck (tsc over the whole project)"],
    ["true || pushd /tmp/app && yarn typecheck", "yarn typecheck (tsc over the whole project)"],
  ])("refuses %s, whose cd may never have run", (command, expected) => {
    expect(what({ command, cwd: "/dev/slopweaver" })).toBe(expected);
  });

  // The shared lexer decodes ANSI-C and locale quoting as bash does, so those spellings are read.
  it.each(["$'yarn' typecheck", "yarn $'typecheck'", '$"yarn" typecheck'])("refuses %s", (command) => {
    expect(what({ command })).toBe("yarn typecheck (tsc over the whole project)");
  });

  // The declared gap, pinned so widening it is a decision in the diff: brace expansion is
  // a spelling the guard does not expand.
  it.each(["{yarn,} typecheck"])("leaves %s to the declared gap", (command) => {
    expect(what({ command })).toBe("allowed");
  });

  // Another project's `lint` or `build` script is its own, but a checker build is not.
  it("judges a script name only inside a slopweaver checkout", () => {
    expect(what({ command: "yarn lint", cwd: "/tmp/cheap-js-app" })).toBe("allowed");
    expect(what({ command: "yarn build", cwd: "/Users/x/dev/acme-admin" })).toBe("allowed");
    expect(
      what({ command: "yarn typecheck", cwd: "/Users/x/dev/personal/slopweaver/.claude/worktrees.noindex/w" }),
    ).toBe("yarn typecheck (tsc over the whole project)");
    expect(what({ command: "cd /tmp/app && yarn build", cwd: "/dev/slopweaver/slopweaver" })).toBe("allowed");
    expect(what({ command: "tsc -p .", cwd: "/Users/x/dev/acme-admin" })).toBe("tsc -p . (tsc over the whole project)");
    // A wrapper that changes directory moves the program, not the shell.
    expect(what({ command: "env -C /dev/slopweaver yarn typecheck", cwd: "/tmp" })).toBe(
      "yarn typecheck (tsc over the whole project)",
    );
    expect(what({ command: "true && sudo --chdir=/dev/slopweaver yarn lint", cwd: "/tmp" })).toBe(
      "yarn lint (the whole lint lap, tsgolint included)",
    );
    expect(what({ command: "env -C /dev/slopweaver true; yarn typecheck", cwd: "/tmp" })).toBe("allowed");
    expect(what({ command: "env -C /tmp/app yarn build", cwd: "/dev/slopweaver" })).toBe("allowed");
  });

  it.each(["echo $(pwd); yarn typecheck", "f(){ true; }; yarn typecheck"])(
    "keeps another project's directory across `%s`, which closes no subshell",
    (command) => {
      expect(what({ command, cwd: "/tmp/app" })).toBe("allowed");
    },
  );

  it("runs no quoted heredoc body", () => {
    expect(what({ command: "cat <<'EOF'\n$(yarn lint)\nEOF", cwd: "/dev/slopweaver" })).toBe("allowed");
  });

  // `cd`'s options were read as its destination, keeping a synthetic `<dir>/--` directory
  it.each([
    "cd -- /dev/slopweaver && yarn typecheck",
    "cd -P /dev/slopweaver && yarn typecheck",
    "pushd /dev/slopweaver && yarn typecheck",
    "cd - && yarn typecheck",
    "cd && yarn typecheck",
    "popd && yarn typecheck",
  ])("judges `%s` as leaving another project's directory", (command) => {
    expect(what({ command, cwd: "/tmp/app" })).toBe("yarn typecheck (tsc over the whole project)");
  });

  it("follows a cd with options into another project", () => {
    expect(what({ command: "cd -L -- /tmp/app && yarn typecheck", cwd: "/dev/slopweaver" })).toBe("allowed");
  });

  it("names only gates the real registry carries", () => {
    const names = new Set(lintChecks({ cwd: "/dev/slopweaver" }).map((check) => check.name));
    const gates = [...WHOLE_PROGRAM_GATES, ...WHOLE_TREE_GATES];
    expect(gates.length).toBeGreaterThan(0);
    expect(gates.filter((gate) => !names.has(gate))).toEqual([]);
  });

  it("runs every whole-Program gate exclusive, and no other", () => {
    const exclusive = lintChecks({ cwd: "/dev/slopweaver" })
      .filter((check) => check.exclusive === true)
      .map((check) => check.name);
    expect(exclusive).toEqual(["oxlint", "named-object-params"]);
    expect([...WHOLE_PROGRAM_GATES].toSorted()).toEqual(exclusive.toSorted());
  });

  it("caps the type-aware oxlint pass at the measured four workers", () => {
    const oxlint = lintChecks({ cwd: "/dev/slopweaver" }).find((check) => check.name === "oxlint")!;
    expect(oxlint.env).toEqual({ GOMAXPROCS: "4" });
  });
});

/**
 * The installed compiler's verdict codes that make a word NOT one of its own options here: unknown (5023), usable
 * only with `--build` (5093), and `--build` itself out of first place (6369). TypeScript 6 kept the build-mode
 * words out of `optionDeclarations` the same way.
 */
const NOT_AN_OPTION_HERE: ReadonlySet<number> = new Set([5023, 5093, 6369]);

describe("TSC_BOOLEAN_OPTIONS", () => {
  it("is exactly the valueless options the installed tsc declares", () => {
    // TypeScript 7 keeps its option table in the native binary, so the oracle is the compiler itself: every word its
    // own `--help --all` lists, kept when its own parser leaves the NEXT word a file rather than the option's value.
    const help = execFileSync(join(process.cwd(), "node_modules/.bin/tsc"), ["--help", "--all"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const words = help.split("\n").flatMap((line) => {
      const match = /^(--[A-Za-z]+)(?:, (-[A-Za-z?]))?$/u.exec(line);
      return match === null ? [] : [match[1]!, match[2]].filter((word) => word !== undefined);
    });
    const api = startCompiler({ cwd: process.cwd() });
    const valueless = words.filter((word) => {
      const parsed = api.parseCommandLine([word, "probe.ts"]);
      const known = !parsed.errors.some((error) => NOT_AN_OPTION_HERE.has(error.code));
      return known && parsed.fileNames.some((name) => name.endsWith("/probe.ts"));
    });
    expect(words.length).toBeGreaterThan(0);
    expect([...TSC_BOOLEAN_OPTIONS].toSorted()).toEqual(
      [...new Set(valueless.map((word) => word.replace(/^-+/u, "").toLowerCase()))].toSorted(),
    );
  });
});
