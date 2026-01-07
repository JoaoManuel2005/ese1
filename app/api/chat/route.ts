import { NextResponse } from "next/server";

type IncomingFile = {
  name: string;
  type?: string;
  size?: number;
  text?: string | null;
  truncated?: boolean;
  isText?: boolean;
  error?: string | null;
};

function formatSize(size?: number) {
  if (typeof size !== "number" || Number.isNaN(size)) return "unknown size";
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function buildFileContext(files: IncomingFile[] = []) {
  if (!Array.isArray(files) || files.length === 0) return "";

  const parts: string[] = [];

  for (const file of files) {
    const name = file?.name || "unnamed";
    const sizeStr = formatSize(file?.size);
    const typeStr = file?.type || "unknown type";
    const isText = !!file?.isText && typeof file?.text === "string";
    const truncated = !!file?.truncated;
    const error = file?.error;

    const header = `--- ${name} (${typeStr}, ${sizeStr}) ---`;
    const footer = `--- end ${name} ---`;

    if (error) {
      parts.push(`${header}\n[Error reading file: ${error}]\n${footer}`);
      continue;
    }

    if (isText) {
      const content = file.text ?? "";
      const note = truncated ? "\n[Content truncated]" : "";
      parts.push(`${header}\n${content}${note}\n${footer}`);
    } else {
      parts.push(`${header}\n[Metadata only: preview not supported]\n${footer}`);
    }
  }

  return parts.join("\n");
}

export async function POST(req: Request) {
  const { message, model, systemPrompt, temperature, files } = await req.json();

  const modelToUse = model || process.env.OLLAMA_MODEL;
  const tempValue = typeof temperature === "number" ? temperature : undefined;

  const fileContext = buildFileContext(files);

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  if (fileContext) {
    messages.push({ role: "system", content: `Attached files:\n${fileContext}` });
  }
  messages.push({ role: "user", content: message });

  const ollamaRes = await fetch(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelToUse,
      messages,
      options: tempValue !== undefined ? { temperature: tempValue } : undefined,
      stream: true,
    }),
  });

  if (!ollamaRes.ok || !ollamaRes.body) {
    const text = await ollamaRes.text();
    return new Response(text, { status: 500 });
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";
  let full = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = ollamaRes.body!.getReader();

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Ollama streams JSON lines (NDJSON)
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;

            const obj = JSON.parse(line);

            const chunk = obj?.message?.content ?? "";
            if (chunk) {
              full += chunk;

              // strip <think> on the fly so UI stays clean
              const cleaned = chunk.replace(/<think>[\s\S]*?<\/think>/gi, "");

              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ delta: cleaned })}\n\n`)
              );
            }

            if (obj?.done) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
              controller.close();
              return;
            }
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      } catch (e: any) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: e?.message ?? "stream error" })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

