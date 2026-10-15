import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { localAgentSecret } from "./local-secret";
import { AI_TASKS, type AiTask, type AiPreferences } from "./ai-settings-types";
import { writeAtomically } from "./atomic-write";
import { dataDir } from "./app-paths";

export { AI_TASKS };
type Stored = { preferences?: Partial<AiPreferences>; credential?: string };
const settingsPath = () => path.resolve(process.env.LOCAL_DB_PATH ? path.dirname(process.env.LOCAL_DB_PATH) : dataDir(), "ai-settings.json");
const modelPattern = /^[a-zA-Z0-9._:/~-]{3,200}$/;

export function isValidModelId(value: string) { return modelPattern.test(value); }
export function defaultPreferences(): AiPreferences {
  const main = process.env.OPENROUTER_MODEL_ID?.trim() || "";
  const lite = process.env.OPENROUTER_MODEL_ID_LITE?.trim() || main;
  const review = process.env.OPENROUTER_MODEL_ID_REVIEW?.trim() || main;
  const window = Number(process.env.OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS) || 128_000;
  return {
    chat: { modelId: main, contextLength: window },
    conversationTitle: { modelId: lite, contextLength: 128_000 },
    sentenceSuggestion: { modelId: lite, contextLength: 128_000 },
    documentReview: { modelId: review, contextLength: 128_000 },
    equation: { modelId: lite, contextLength: 128_000 },
    imageAnalysis: { modelId: process.env.OPENROUTER_VISION_MODEL_ID?.trim() || main, contextLength: 128_000 },
  };
}
async function readStored(): Promise<Stored> {
  try { return JSON.parse(await readFile(settingsPath(), "utf8")) as Stored; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
function readStoredSync(): Stored {
  try { return JSON.parse(readFileSync(settingsPath(), "utf8")) as Stored; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}
export function getAiPreferencesSync(): AiPreferences {
  const stored = readStoredSync();
  const defaults = defaultPreferences();
  return Object.fromEntries(AI_TASKS.map((task) => {
    const choice = stored.preferences?.[task];
    return [task, choice && isValidModelId(choice.modelId) && Number.isSafeInteger(choice.contextLength) && choice.contextLength >= 8192 ? choice : defaults[task]];
  })) as AiPreferences;
}
export function getAiSettingsSources(): { preferences: Partial<Record<AiTask, boolean>>; credential: boolean } {
  const stored = readStoredSync();
  return {
    preferences: Object.fromEntries(AI_TASKS.map((task) => [task, Boolean(stored.preferences?.[task]?.modelId)])),
    credential: Boolean(stored.credential),
  };
}
export async function getAiPreferences(): Promise<AiPreferences> {
  const stored = await readStored();
  const defaults = defaultPreferences();
  return Object.fromEntries(AI_TASKS.map((task) => {
    const choice = stored.preferences?.[task];
    return [task, choice && isValidModelId(choice.modelId) && Number.isSafeInteger(choice.contextLength) && choice.contextLength >= 8192 ? choice : defaults[task]];
  })) as AiPreferences;
}
export function getAiKeySync(): string | null {
  const stored = readStoredSync();
  if (!stored.credential) return process.env.OPENROUTER_API_KEY?.trim() || null;
  const [ivHex, tagHex, ciphertext] = stored.credential.split(":");
  const key = createHash("sha256").update(localAgentSecret()).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/** Moves AI values saved by desktop previews into the existing encrypted settings store. */
export function migrateDesktopAiSettings(values: Record<string, string>): void {
  const stored = readStoredSync();
  const defaults = defaultPreferences();
  const preferences = { ...defaults, ...stored.preferences } as AiPreferences;
  const setModel = (task: AiTask, name: string) => {
    const modelId = values[name]?.trim();
    if (modelId && !stored.preferences?.[task]) preferences[task] = { ...preferences[task], modelId };
  };
  setModel("chat", "OPENROUTER_MODEL_ID");
  setModel("conversationTitle", "OPENROUTER_MODEL_ID_LITE");
  setModel("sentenceSuggestion", "OPENROUTER_MODEL_ID_LITE");
  setModel("equation", "OPENROUTER_MODEL_ID_LITE");
  setModel("documentReview", "OPENROUTER_MODEL_ID_REVIEW");
  setModel("imageAnalysis", "OPENROUTER_VISION_MODEL_ID");
  const contextLength = Number(values.OPENROUTER_MODEL_CONTEXT_WINDOW_TOKENS);
  if (!stored.preferences?.chat && Number.isSafeInteger(contextLength) && contextLength >= 8192) {
    preferences.chat = { ...preferences.chat, contextLength };
  }
  let credential = stored.credential;
  if (!credential && values.OPENROUTER_API_KEY) {
    const iv = randomBytes(12);
    const key = createHash("sha256").update(localAgentSecret()).digest();
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(values.OPENROUTER_API_KEY, "utf8"), cipher.final()]);
    credential = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("base64")}`;
  }
  writeAtomically(settingsPath(), JSON.stringify({ preferences, credential }));
}
export async function getAiKey(): Promise<string | null> {
  const stored = await readStored();
  if (!stored.credential) return process.env.OPENROUTER_API_KEY?.trim() || null;
  const [ivHex, tagHex, ciphertext] = stored.credential.split(":");
  const key = createHash("sha256").update(localAgentSecret()).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
export async function saveAiSettings(preferences: AiPreferences, apiKey?: string | null) {
  const stored = await readStored();
  let credential = stored.credential;
  if (apiKey === null) credential = undefined;
  else if (apiKey) {
    const iv = randomBytes(12);
    const key = createHash("sha256").update(localAgentSecret()).digest();
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
    credential = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("base64")}`;
  }
  await mkdir(path.dirname(settingsPath()), { recursive: true });
  const temporary = `${settingsPath()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify({ preferences, credential }), { mode: 0o600 });
  await rename(temporary, settingsPath());
}
export async function getAiTaskConfig(task: AiTask) {
  return { ...(await getAiPreferences())[task], apiKey: await getAiKey() };
}
