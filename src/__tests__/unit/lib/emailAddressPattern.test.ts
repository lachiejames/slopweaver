import { describe, expect, it } from "vitest";
import { emailAddressPattern } from "#lib/emailAddressPattern.js";

const replaced = ({ text }: { text: string }): string => text.replace(emailAddressPattern(), "[email]");

describe("emailAddressPattern — what it matches", () => {
  it("matches a bare address", () => {
    expect(replaced({ text: "write to jane.doe@example.com now" })).toBe("write to [email] now");
  });

  it("matches a quoted local part carrying a space, whole", () => {
    expect(replaced({ text: 'write to "jane doe"@example.com now' })).toBe("write to [email] now");
  });

  it("matches a quoted local part carrying an at-sign as ONE address", () => {
    expect(replaced({ text: '"a@b"@example.com' })).toBe("[email]");
  });

  it("matches a quoted local part at the 62-character cap, and stops one past it", () => {
    expect(replaced({ text: `"${"a".repeat(62)}"@example.com` })).toBe("[email]");
    const over = `"${"a".repeat(63)}"@example.com`;
    expect(replaced({ text: over })).toBe(over);
  });

  it("counts an escape pair as one character against the cap — the stated over-redacting residue", () => {
    expect(replaced({ text: `"${"\\x".repeat(62)}"@example.com` })).toBe("[email]");
    const over = `"${"\\x".repeat(63)}"@example.com`;
    expect(replaced({ text: over })).toBe(over);
  });
});

describe("emailAddressPattern — what it leaves alone", () => {
  it("leaves quoted prose with no address after the closing quote", () => {
    expect(replaced({ text: 'they said "hi" and left' })).toBe('they said "hi" and left');
  });

  it("leaves a bare @mention", () => {
    expect(replaced({ text: "ping @alice about it" })).toBe("ping @alice about it");
  });
});

describe("emailAddressPattern — a fresh regex every call", () => {
  it("returns a distinct global regex each call, so one caller's lastIndex never reaches another's", () => {
    const first = emailAddressPattern();
    const second = emailAddressPattern();
    expect(first).not.toBe(second);
    expect(first.global).toBe(true);
    expect(first.test("jane@example.com")).toBe(true);
    expect(first.lastIndex).toBe(16);
    expect(second.lastIndex).toBe(0);
    expect(second.test("jane@example.com")).toBe(true);
  });
});
