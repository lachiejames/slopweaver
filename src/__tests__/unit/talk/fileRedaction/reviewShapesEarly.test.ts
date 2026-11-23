/*
 * The credential shapes the r4 to r9 reviews read back, masked by `redactCredentials`: a value however long,
 * numbered, patch and grep lines, list items, flow maps, bare and backticked `*_KEY` names, a transcript row's
 * first line, a next-line value, any auth scheme and the key tools' flags. Every secret-shaped fixture is
 * assembled at run time, so this file is not itself a hit for the hygiene gate it exercises.
 */
import { describe, expect, it } from "vitest";

import { redactCredentials } from "../../../../talk/fileRedaction.js";

describe("redactCredentials", () => {
  it("masks a value to its end however long, and the shapes the r4 review read back", () => {
    const long = "A".repeat(6000);
    const vault = `${["hv", "s."].join("")}${"V".repeat(24)}`;
    const age = `${["AGE-SECRET", "-KEY-1"].join("")}${"Q".repeat(58)}`;
    const text = [
      `ANDROID_KEYSTORE_BASE64=${long}`,
      `"credentials": "${long}"`,
      "$db = ['password' => 'phpPw9'];",
      'pw, secret := "goSecret9", 1',
      "DefaultEndpointsProtocol=https;AccountKey=azureKey9==;EndpointSuffix=x",
      "https://x.blob.core.windows.net/c?sv=1&sig=sasSig9%3D&se=2",
      "Authorization: Token tokenHeader9",
      "curl -uadmin:p@ss https://x && mariadb -u root -pmariaPw",
      "sqlplus scott/tigerPw@db && zip -P zipPw out.zip in",
      `${vault} ${age}`,
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "ANDROID_KEYSTORE_BASE64=[redacted:secret-env]",
        '"credentials": "[redacted:secret-quoted]"',
        "$db = ['password' => '[redacted:secret-quoted]'];",
        'pw, secret := "[redacted:secret-quoted]", 1',
        "DefaultEndpointsProtocol=https;AccountKey=[redacted:secret-param];EndpointSuffix=x",
        "https://x.blob.core.windows.net/c?sv=1&sig=[redacted:secret-param]&se=2",
        "Authorization: Token [redacted:auth-header]",
        "curl -uadmin:[redacted:secret-flag] https://x && mariadb -u root -p[redacted:secret-flag]",
        "sqlplus scott/[redacted:secret-flag]@db && zip -P [redacted:secret-flag] out.zip in",
        "[redacted:vault-token] [redacted:age-key]",
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r5 review read back: numbered and patch lines, list items, flow maps, bare KEY names", () => {
    const text = [
      "1\tdatabase:",
      "2\t  password: numberedPw9",
      "3\t  api_key: |",
      "4\t    blockBody9",
      "5\t  port: 5432",
      "     6→  token: arrowPw9",
      "+  password: patchPw9",
      "  - password: listPw9",
      "db: {user: app, password: flowPw9}",
      '"DD_APP_KEY": "ddAppKey9", "SIGNING_KEY": "signKey9"',
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "1\tdatabase:",
        "2\t  password: [redacted:secret-config]",
        "3\t  api_key: |",
        "4\t[redacted:secret-block]",
        "5\t  port: 5432",
        "     6→  token: [redacted:secret-config]",
        "+  password: [redacted:secret-config]",
        "  - password: [redacted:secret-config]",
        "db: {user: app, password: [redacted:secret-config]",
        '"DD_APP_KEY": "[redacted:secret-quoted]", "SIGNING_KEY": "[redacted:secret-quoted]"',
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r6 review read back: grep hits, a row's first line, unquoted *_KEY names", () => {
    const text = [
      "config/app.yml:3:  password: grepPw9",
      "12:    db_password: grepPw10",
      "++  password: mergePw9",
      ">   password: replyPw9",
      String.raw`{"content":"password: firstLinePw9\napi_key: |\n  firstBlock9\nport: 1"}`,
      '  SIGNING_KEY: "composeKey9"',
      "FERNET_KEY = 'pyKey9'",
      "<li><b>Plan auth:</b> wraps the CLI</li>",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "config/app.yml:3:  password: [redacted:secret-config]",
        "12:    db_password: [redacted:secret-config]",
        "++  password: [redacted:secret-config]",
        ">   password: [redacted:secret-config]",
        String.raw`{"content":"password: [redacted:secret-config] |\n[redacted:secret-block]\nport: 1"}`,
        '  SIGNING_KEY: "[redacted:secret-quoted]"',
        "FERNET_KEY = '[redacted:secret-quoted]'",
        "<li><b>Plan auth:</b> wraps the CLI</li>",
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r7 review read back: spaced values, long names, backticks, '' and grep -A context", () => {
    const text = [
      "passphrase: correct horse battery staple",
      "password = my Welcome1",
      "export MY_COMPANY_PRODUCTION_ENVIRONMENT_DATABASE_PASSWORD=longNamePw9",
      "password: `tickPw9`",
      "password: 'it''s quotePw9'",
      "config/app.yml-3-  api_key: |",
      "config/app.yml-4-    grepBlock9",
      "config/app.yml-5-  port: 1",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "passphrase: [redacted:secret-config]",
        "password = [redacted:secret-config]",
        "export MY_COMPANY_PRODUCTION_ENVIRONMENT_DATABASE_PASSWORD=[redacted:secret-env]",
        "password: `[redacted:secret-quoted]`",
        "password: '[redacted:secret-quoted]'",
        "config/app.yml-3-  api_key: |",
        "config/app.yml-4-[redacted:secret-block]",
        "config/app.yml-5-  port: 1",
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r8 review read back: *_KEY backticks, a row's spaced first line, a next-line value", () => {
    const text = [
      "- SIGNING_KEY: `signTick9`",
      String.raw`{"content":"passphrase: correct horse battery staple\nport: 1"}`,
      String.raw`{"content":"1\tpassphrase: numbered horse staple\n2\tport: 1"}`,
      String.raw`{"content":"cfg/app.yml:1:passphrase: grep horse staple\n"}`,
      "db:",
      "  password:",
      "    nextLinePw9",
      "  port: 1",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        "- SIGNING_KEY: `[redacted:secret-quoted]`",
        String.raw`{"content":"passphrase: [redacted:secret-config]\nport: 1"}`,
        String.raw`{"content":"1\tpassphrase: [redacted:secret-config]\n2\tport: 1"}`,
        String.raw`{"content":"cfg/app.yml:1:passphrase: [redacted:secret-config]\n"}`,
        "db:",
        "  password:",
        "[redacted:secret-block]",
        "  port: 1",
        "",
      ].join("\n"),
    );
  });

  it("masks the shapes the r9 review read back: any auth scheme, key-tool flags, every secret word, a row's > and +", () => {
    const text = [
      'curl -H "Authorization: ApiKey fakeApiKeyValue9"',
      "Authorization: SSWS fakeSswsValue9",
      "gpg --batch --passphrase gpgPhrase9 -d x.gpg",
      "ssh-keygen -t ed25519 -N keygenPw9 -f k",
      "ssh-keygen -p -P oldKeygenPw9 -N newKeygenPw9 -f k",
      "unzip -P unzipPw9 a.zip",
      "openssl enc -d -k opensslPw9 -in a",
      "cd app && db_pass=paramPw9 ./run",
      "?user=app&pass=queryPw9",
      "x credentials=credPw9 client_auth=authPw9",
      String.raw`{"content":"> passphrase: reply horse staple\n"}`,
      String.raw`{"content":"+passphrase: diff horse staple\n"}`,
      "Authorization: required everywhere",
      "",
    ].join("\n");
    expect(redactCredentials({ denylist: [], source: false, text }).text).toBe(
      [
        'curl -H "Authorization: ApiKey [redacted:auth-header]"',
        "Authorization: SSWS [redacted:auth-header]",
        "gpg --batch --passphrase [redacted:secret-flag] -d x.gpg",
        "ssh-keygen -t ed25519 -N [redacted:secret-flag] -f k",
        "ssh-keygen -p -P [redacted:secret-flag] -N [redacted:secret-flag] -f k",
        "unzip -P [redacted:secret-flag] a.zip",
        "openssl enc -d -k [redacted:secret-flag] -in a",
        "cd app && db_pass=[redacted:secret-param] ./run",
        "?user=app&pass=[redacted:secret-param]",
        "x credentials=[redacted:secret-param] client_auth=[redacted:secret-param]",
        String.raw`{"content":"> passphrase: [redacted:secret-config]\n"}`,
        String.raw`{"content":"+passphrase: [redacted:secret-config]\n"}`,
        "Authorization: required [redacted:auth-header]",
        "",
      ].join("\n"),
    );
  });
});
