/*
 * The credential shapes the r10 to r17 reviews read back, masked by `redactCredentials`: quoted flag values
 * whole, XML attributes, CDATA and `<Value>`, string prefixes and triple quotes, URLs, HAR and Postman forms, real
 * provider prefixes and a scheme-less key — and an Authorization line with nothing secret in it left readable.
 * Every secret-shaped fixture is assembled at run time, so this file is not itself a hit for the hygiene gate it
 * exercises.
 */
import { describe, expect, it } from "vitest";

import { redactCredentials } from "../../../../talk/fileRedaction.js";

describe("redactCredentials", () => {
  it("masks the shapes the r10 review read back: quoted flag values whole, sqlplus flags, XML attributes", () => {
    const text = [
      "mysql -u root -p'mysqlPw9'",
      'mysql -p"mysqlPw10"',
      "sshpass -p 'sshpassPw9' ssh host",
      'gpg --passphrase "correct horse battery staple" -d x',
      'docker login -u me -p "docker horse staple" r',
      'keytool -storepass "store horse staple" -list',
      "sqlplus -s scott/sqlplusPw9@orcl @run.sql",
      '<Pass encoding="base64">ZmFrZVBhc3M=</Pass>',
      '<password type="plain">xmlPw9</password>',
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "mysql -u root -p'[redacted:secret-flag]'",
        'mysql -p"[redacted:secret-flag]"',
        "sshpass -p '[redacted:secret-flag]' ssh host",
        'gpg --passphrase "[redacted:secret-flag]" -d x',
        'docker login -u me -p "[redacted:secret-flag]" r',
        'keytool -storepass "[redacted:secret-flag]" -list',
        "sqlplus -s scott/[redacted:secret-flag]@orcl @run.sql",
        '<Pass encoding="base64">[redacted:secret-xml]</Pass>',
        '<password type="plain">[redacted:secret-xml]</password>',
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r11 review read back: quoted curl -u and -passin, CDATA and <Value>, joined flags", () => {
    const text = [
      "curl -u 'admin:curl horse staple' https://x",
      'openssl enc -passin "pass:passin horse staple" -in a',
      "<password><![CDATA[cdataPw9]]></password>",
      "<AdministratorPassword>\n  <Value>unattendPw9</Value>",
      "ldapsearch -x -wldapPw9 -b dc=x",
      "ssh-keygen -p -PoldPw9 -NnewPw9 -f k",
      "openssl req -new -key k.pem -out r.csr",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "curl -u 'admin:[redacted:secret-flag]' https://x",
        'openssl enc -passin "pass:[redacted:secret-flag]" -in a',
        "<password><![CDATA[[redacted:secret-xml]]]></password>",
        "<AdministratorPassword>\n  <Value>[redacted:secret-xml]</Value>",
        "ldapsearch -x -w[redacted:secret-flag] -b dc=x",
        "ssh-keygen -p -P[redacted:secret-flag] -N[redacted:secret-flag] -f k",
        "openssl req -new -key k.pem -out r.csr",
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r12 review read back: string prefixes, $'' and triple quotes, XML, URLs, HAR", () => {
    const text = [
      'x password=b"prefixPw9" y',
      'password = """triplePw9"""',
      "DB_PASSWORD=$'dollar horse staple'",
      "sshpass -p $'sshpass horse staple' ssh h",
      'sqlplus scott/"sqlplusQuoted9"@orcl',
      "curl -u :patToken9 https://dev.azure.com",
      '<wsse:Password Type="t">wssePw9</wsse:Password>',
      "<password><![CDATA[Welc]ome9]]></password>",
      "x smtp://me@example.com:smtpPw9@smtp.local y",
      '{"name":"Authorization","value":"SSWS harTokenValue9"}',
      "x glrt-abcdefghijklmnopqrstuvwx y",
      "db:",
      "  password: | # rotated",
      "    blockPw9",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        'x password=[redacted:secret-param]"[redacted:secret-quoted]" y',
        'password = """[redacted:secret-quoted]"""',
        "DB_PASSWORD=[redacted:secret-config]'",
        "sshpass -p $'[redacted:secret-flag]' ssh h",
        'sqlplus scott/"[redacted:secret-flag]"@orcl',
        "curl -u :[redacted:secret-flag] https://dev.azure.com",
        '<wsse:Password Type="t">[redacted:secret-xml]</wsse:Password>',
        "<password><![CDATA[[redacted:secret-xml]]]></password>",
        "x smtp://me@example.com:[redacted:url-password]@smtp.local y",
        '{"name":"Authorization","value":"SSWS [redacted:auth-header]"}',
        "x [redacted:gitlab-token] y",
        "db:",
        "  password: [redacted:secret-config]",
        "[redacted:secret-block]",
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r13 review read back: curl -u spacing, Postman's key form", () => {
    const text = [
      "curl -u  admin:spacedPw9 https://x",
      "curl -u\tadmin:tabbedPw9 https://x",
      '{"key":"Authorization","value":"SSWS postmanToken9"}',
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "curl -u  admin:[redacted:secret-flag] https://x",
        "curl -u\tadmin:[redacted:secret-flag] https://x",
        '{"key":"Authorization","value":"SSWS [redacted:auth-header]"}',
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r16 review read back: real Sentry, Vault and OpenAI prefixes, a scheme-less key", () => {
    const body = "Ab3".repeat(10);
    const tokens = ["sntr" + "ys_", "sntr" + "yu_", "hv" + "r.", "sk-" + "None-", "sb_" + "secret_"].map(
      (prefix) => prefix + body,
    );
    const text = [...tokens, "Authorization: bareKeyValue99", 'curl -H "Authorization: bareKeyValue99" x', ""].join(
      "\n",
    );
    const masked = redactCredentials({ denylist: [], source: false, text }).text;
    expect(masked.includes(body)).toBe(false);
    expect(masked.includes("bareKeyValue99")).toBe(false);
    expect(masked.split("\n").slice(5)).toEqual([
      "Authorization: [redacted:auth-header]",
      'curl -H "Authorization: [redacted:auth-header]" x',
      "",
    ]);
  });

  it("masks the shapes the r17 review read back: a scheme-less key before a comment, Bedrock and age PQ keys", () => {
    const body = "Ab3".repeat(10);
    const tokens = ["AB" + "SK" + body, "bedrock-" + "api-key-" + body, "AGE-SECRET-" + "KEY-PQ-1" + "Q7".repeat(30)];
    const text = [...tokens, "Authorization: prodKey2024abc # prod key", '{"Authorization": "prodKey2024abc prod"}'];
    const masked = redactCredentials({ denylist: [], source: false, text: text.join("\n") }).text;
    expect(masked.includes(body)).toBe(false);
    expect(masked.includes("Q7Q7Q7")).toBe(false);
    expect(masked.split("\n").slice(3)).toEqual([
      "Authorization: [redacted:auth-header] # prod key",
      '{"Authorization": "[redacted:auth-header] prod"}',
    ]);
  });

  it("leaves an Authorization line whose only word is its scheme, or a short word, readable", () => {
    const text = "Authorization: Basic\nAuthorization: none\nAuthorization: required by the gateway\n";
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(text);
  });
});
