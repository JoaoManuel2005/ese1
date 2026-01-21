import { NextResponse } from "next/server";
import { readFileSync } from "fs";

type OllamaModel = { name: string };

const FALLBACK_HOSTS = [
  "http://localhost:11434",
  "http://127.0.0.1:11434",
  "http://host.docker.internal:11434",
];

export async function GET() {
  const hostCandidates = buildHostCandidates();
  const errors: string[] = [];

  for (const host of hostCandidates) {
    try {
      const models = await fetchModels(host);
      return NextResponse.json({
        ok: true,
        hostUsed: host,
        models,
      });
    } catch (err: any) {
      errors.push(`${host}: ${err?.message || "unreachable"}`);
    }
  }

  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "OLLAMA_UNREACHABLE",
        message: "Unable to reach Ollama on any known host.",
        hint: "Start Ollama and enable listening on port 11434.",
        details: errors.slice(0, 4),
      },
    },
    { status: 503 }
  );
}

function buildHostCandidates() {
  const candidates: string[] = [];
  const envHost = process.env.OLLAMA_HOST || process.env.LOCAL_LLM_BASE_URL;
  if (envHost) {
    candidates.push(envHost.replace(/\/$/, ""));
  }
  candidates.push(...FALLBACK_HOSTS);

  const resolvHost = resolveWindowsHostFromResolv();
  if (resolvHost) {
    candidates.push(resolvHost);
  }

  return Array.from(new Set(candidates));
}

function resolveWindowsHostFromResolv() {
  try {
    const content = readFileSync("/etc/resolv.conf", "utf8");
    const match = content.match(/^nameserver\s+([0-9.]+)/m);
    if (!match?.[1]) return null;
    return `http://${match[1]}:11434`;
  } catch {
    return null;
  }
}

async function fetchModels(host: string): Promise<OllamaModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);
  try {
    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const models = Array.isArray(data?.models) ? data.models : [];
    return models
      .map((model: any) => ({ name: model?.name }))
      .filter((model: OllamaModel) => Boolean(model?.name));
  } finally {
    clearTimeout(timeout);
  }
}
