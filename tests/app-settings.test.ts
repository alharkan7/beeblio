import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { appSetting, integerSetting, openRouterApiKey, saveSettings, settingsSnapshot } from "../lib/app-settings.ts";
import { defaultPreferences, saveAiSettings } from "../lib/local-ai-settings.ts";

const SAVED_KEY = "sk-or-v1-saved-key-0000000000abcd";
const ENV_KEY = "sk-or-v1-env-key-00000000000wxyz";
const MANAGED_ENV = ["OPENROUTER_API_KEY", "OPENROUTER_MODEL_ID", "OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS", "OPENROUTER_REQUEST_TIMEOUT_MS", "BEEBLIO_DATA_DIR", "LOCAL_DB_PATH"] as const;

describe("merged app settings", () => {
  const originalEnv = Object.fromEntries(MANAGED_ENV.map((name) => [name, process.env[name]]));
  let dir: string;
  const settingsFile = () => path.join(dir, "settings.json");
  const aiFile = () => path.join(dir, "ai-settings.json");
  const writeRaw = (contents: string, name = "settings.json") => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), contents);
  };

  beforeEach(() => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), "beeblio-settings-")), "data");
    for (const name of MANAGED_ENV) delete process.env[name];
    process.env.BEEBLIO_DATA_DIR = dir;
  });

  afterEach(() => {
    rmSync(path.dirname(dir), { recursive: true, force: true });
    for (const name of MANAGED_ENV) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
  });

  test("reports required settings that are missing", () => {
    assert.equal(openRouterApiKey(), undefined);
    assert.deepEqual(settingsSnapshot().missingRequired, ["Main model", "Context window (tokens)", "OpenRouter"]);
  });

  test("reads environment defaults with whitespace removed", () => {
    process.env.OPENROUTER_API_KEY = `  ${ENV_KEY}\n`;
    process.env.OPENROUTER_MODEL_ID = "provider/model ";
    assert.equal(openRouterApiKey(), ENV_KEY);
    assert.deepEqual(settingsSnapshot().settings.OPENROUTER_MODEL_ID, { source: "env", value: "provider/model" });
  });

  test("uses the encrypted AI store for the key and model", async () => {
    process.env.OPENROUTER_API_KEY = ENV_KEY;
    const preferences = defaultPreferences();
    preferences.chat = { modelId: "provider/saved", contextLength: 64000 };
    await saveAiSettings(preferences, SAVED_KEY);
    assert.equal(openRouterApiKey(), SAVED_KEY);
    assert.equal(appSetting("OPENROUTER_MODEL_ID"), "provider/saved");
    assert.deepEqual(settingsSnapshot().settings.OPENROUTER_API_KEY, { source: "settings", last4: "abcd" });
    assert.ok(!readFileSync(aiFile(), "utf8").includes(SAVED_KEY));
    assert.equal(statSync(aiFile()).mode & 0o777, 0o600);
  });

  test("migrates desktop-preview AI settings and removes their plaintext copy", () => {
    writeRaw(JSON.stringify({ version: 1, values: {
      OPENROUTER_API_KEY: SAVED_KEY,
      OPENROUTER_MODEL_ID: "provider/desktop",
      OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS: "64000",
      GOOGLE_API_KEY: "google-key",
    } }));
    assert.equal(openRouterApiKey(), SAVED_KEY);
    assert.equal(appSetting("OPENROUTER_MODEL_ID"), "provider/desktop");
    assert.equal(appSetting("GOOGLE_API_KEY"), "google-key");
    assert.ok(!readFileSync(aiFile(), "utf8").includes(SAVED_KEY));
    assert.ok(!readFileSync(settingsFile(), "utf8").includes(SAVED_KEY));
  });

  test("keeps existing encrypted preferences when migrating a preview file", async () => {
    const preferences = defaultPreferences();
    preferences.chat = { modelId: "provider/current", contextLength: 128000 };
    await saveAiSettings(preferences, ENV_KEY);
    writeRaw(JSON.stringify({ version: 1, values: { OPENROUTER_API_KEY: SAVED_KEY, OPENROUTER_MODEL_ID: "provider/older" } }));
    assert.equal(openRouterApiKey(), ENV_KEY);
    assert.equal(appSetting("OPENROUTER_MODEL_ID"), "provider/current");
    assert.ok(!readFileSync(settingsFile(), "utf8").includes(SAVED_KEY));
  });

  test("moves an older desktop credentials file into encrypted storage", () => {
    writeRaw(JSON.stringify({ openRouterApiKey: SAVED_KEY }), "credentials.json");
    assert.equal(openRouterApiKey(), SAVED_KEY);
    assert.equal(existsSync(path.join(dir, "credentials.json")), false);
    assert.ok(!readFileSync(aiFile(), "utf8").includes(SAVED_KEY));
  });

  test("saves non-AI settings in settings.json", () => {
    saveSettings({ OPENROUTER_REQUEST_TIMEOUT_MS: "250", GOOGLE_API_KEY: "google-key" });
    assert.equal(integerSetting("OPENROUTER_REQUEST_TIMEOUT_MS", 5, 1), 250);
    assert.equal(appSetting("GOOGLE_API_KEY"), "google-key");
    assert.equal(statSync(settingsFile()).mode & 0o777, 0o600);
    assert.throws(() => saveSettings({ OPENROUTER_API_KEY: SAVED_KEY }), /Save AI settings/);
  });

  test("ignores malformed settings.json and repairs it on save", () => {
    writeRaw("{ not json");
    const warn = console.warn;
    console.warn = () => {};
    try {
      assert.equal(appSetting("GOOGLE_API_KEY"), undefined);
      saveSettings({ GOOGLE_API_KEY: "google-key" });
      assert.equal(appSetting("GOOGLE_API_KEY"), "google-key");
    } finally {
      console.warn = warn;
    }
  });
});
