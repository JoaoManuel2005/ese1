import "server-only";

import fs from "fs/promises";
import path from "path";

export type RuntimeConfig = {
  provider?: "cloud" | "local";
  model?: string;
  openaiApiKey?: string | null;
  azureOpenAiEndpoint?: string | null;
  updatedAt?: string;
};

export type RuntimeConfigInput = {
  provider?: "cloud" | "local" | null;
  model?: string | null;
  openaiApiKey?: string | null;
  azureOpenAiEndpoint?: string | null;
};

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "runtime-data", ".runtime-config.json");
const CONFIG_PATH = process.env.RUNTIME_CONFIG_PATH || DEFAULT_CONFIG_PATH;

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normalizeProvider(value: unknown): "cloud" | "local" | undefined {
  if (value === "cloud" || value === "local") return value;
  return undefined;
}

function normalizePartial(input: RuntimeConfigInput): Partial<RuntimeConfig> {
  const updates: Partial<RuntimeConfig> = {};

  if ("provider" in input) {
    const provider = normalizeProvider(input.provider ?? undefined);
    if (provider) updates.provider = provider;
  }

  if ("model" in input) {
    const model = normalizeOptionalString(input.model);
    updates.model = model ?? undefined;
  }

  if ("openaiApiKey" in input) {
    updates.openaiApiKey = normalizeOptionalString(input.openaiApiKey);
  }

  if ("azureOpenAiEndpoint" in input) {
    updates.azureOpenAiEndpoint = normalizeOptionalString(input.azureOpenAiEndpoint);
  }

  return updates;
}

async function readConfigFile(): Promise<RuntimeConfig> {
  try {
    const data = await fs.readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(data) as RuntimeConfig;
    return {
      provider: normalizeProvider(parsed.provider),
      model: normalizeOptionalString(parsed.model) ?? undefined,
      openaiApiKey: normalizeOptionalString(parsed.openaiApiKey),
      azureOpenAiEndpoint: normalizeOptionalString(parsed.azureOpenAiEndpoint),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
    };
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

async function writeConfigFile(config: RuntimeConfig): Promise<void> {
  const payload = JSON.stringify(config, null, 2);
  await fs.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fs.writeFile(CONFIG_PATH, payload, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.chmod(CONFIG_PATH, 0o600);
  } catch {
    // Best effort on platforms that don't support chmod.
  }
}

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  const fileConfig = await readConfigFile();
  const envConfig: RuntimeConfig = {
    provider: normalizeProvider(process.env.LLM_PROVIDER),
    model: normalizeOptionalString(process.env.DEFAULT_MODEL || process.env.OPENAI_MODEL) ?? undefined,
    openaiApiKey: normalizeOptionalString(process.env.OPENAI_API_KEY),
    azureOpenAiEndpoint: normalizeOptionalString(process.env.AZURE_OPENAI_ENDPOINT),
  };

  return {
    provider: fileConfig.provider ?? envConfig.provider,
    model: fileConfig.model ?? envConfig.model,
    openaiApiKey: fileConfig.openaiApiKey ?? envConfig.openaiApiKey,
    azureOpenAiEndpoint: fileConfig.azureOpenAiEndpoint ?? envConfig.azureOpenAiEndpoint,
    updatedAt: fileConfig.updatedAt,
  };
}

export async function setRuntimeConfig(input: RuntimeConfigInput): Promise<RuntimeConfig> {
  const current = await readConfigFile();
  const updates = normalizePartial(input);
  const next: RuntimeConfig = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await writeConfigFile(next);
  return next;
}

