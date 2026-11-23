/*
 * `processClass`, `isInteractiveShellArgv`, `isSystemShellPath` and `bareName`: a process is a shell, the login or a
 * program however it is spelled, a shell's command line is interactive only when nothing after its name could be a
 * script, and a shell is the one cmux starts only by an absolute path in a system shell directory.
 */
import { describe, expect, it } from "vitest";

import {
  bareName,
  isInteractiveShellArgv,
  isSystemShellPath,
  processClass,
} from "../../../../sessions/coldProcessClass.js";

describe("processClass and bareName", () => {
  it("classes a shell however it is spelled, the login, and everything else as a program", () => {
    expect(processClass({ name: "-/bin/zsh" })).toBe("shell");
    expect(processClass({ name: "bash" })).toBe("shell");
    expect(processClass({ name: "/usr/bin/login" })).toBe("login");
    expect(processClass({ name: "vim" })).toBe("program");
    expect(processClass({ name: "-vim" })).toBe("program");
  });

  it("reads a shell's command line as interactive only when nothing after its name could be a script", () => {
    expect(isInteractiveShellArgv({ argv: "-/bin/zsh" })).toBe(true);
    expect(isInteractiveShellArgv({ argv: "/bin/bash --login -i" })).toBe(true);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh /tmp/commands.fifo" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -c ps" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -s" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -ls" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -lc" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -li" })).toBe(true);
    // PowerShell reads its single-dash options case-insensitively, so a denylist of
    // lowercase `c` and `s` let `-COMMAND` through as a bundle of harmless letters.
    expect(isInteractiveShellArgv({ argv: "/usr/local/bin/pwsh -COMMAND -NOT$(WHILE($TRUE){})" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/usr/local/bin/pwsh -NoProfile" })).toBe(false);
    // fish's `-C <init command>` is uppercase too, and it attaches its argument.
    expect(isInteractiveShellArgv({ argv: "/opt/homebrew/bin/fish -Cwork" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/usr/local/bin/pwsh -File x.ps1" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -f" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -L" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/usr/local/bin/pwsh -l -i" })).toBe(true);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh -- script" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh --shinstdin" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh --shin-stdin" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/opt/homebrew/bin/fish --command ls" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/usr/local/bin/nu --stdin" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/bash --rcfile /tmp/rc" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/bin/zsh --no-rcs --NO_RCS --login --interactive" })).toBe(true);
    expect(isInteractiveShellArgv({ argv: "/bin/bash --norc --noprofile --posix" })).toBe(true);
    expect(isInteractiveShellArgv({ argv: "vim" })).toBe(false);
  });

  // A program at `/tmp/zsh` reading its stdin was a shell to every
  // name-only check. cmux starts a tab's shell by path, `-/bin/zsh` on every tab measured, so only that spelling is one.
  it("reads a shell as the one cmux starts only by an absolute path in a system shell directory", () => {
    expect(isSystemShellPath({ word: "-/bin/zsh" })).toBe(true);
    expect(isSystemShellPath({ word: "/bin/zsh" })).toBe(true);
    expect(isSystemShellPath({ word: "/usr/local/bin/bash" })).toBe(true);
    expect(isSystemShellPath({ word: "/opt/homebrew/bin/fish" })).toBe(true);
    expect(isSystemShellPath({ word: "zsh" })).toBe(false);
    expect(isSystemShellPath({ word: "-zsh" })).toBe(false);
    expect(isSystemShellPath({ word: "/tmp/zsh" })).toBe(false);
    expect(isSystemShellPath({ word: "/bin/vim" })).toBe(false);
    expect(isSystemShellPath({ word: "/bin/../tmp/zsh" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "zsh" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "-zsh" })).toBe(false);
    expect(isInteractiveShellArgv({ argv: "/tmp/zsh" })).toBe(false);
  });

  it("drops a login shell's leading dash and any directory, so two reads of one shell agree by bare name", () => {
    expect(bareName({ name: "-/bin/zsh" })).toBe("zsh");
    expect(bareName({ name: "-zsh" })).toBe("zsh");
    expect(bareName({ name: "zsh" })).toBe("zsh");
    expect(bareName({ name: "/opt/homebrew/bin/bash" })).toBe("bash");
  });
});
