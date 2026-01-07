import { NextResponse } from "next/server";

export async function GET() {
  try {
    const res = await fetch(`${process.env.OLLAMA_BASE_URL}/api/tags`);

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { models: [], error: text || "Failed to fetch models" },
        { status: 500 }
      );
    }

    const data = await res.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => m?.name).filter(Boolean)
      : [];

    return NextResponse.json({ models });
  } catch (e: any) {
    return NextResponse.json(
      { models: [], error: e?.message ?? "Failed to fetch models" },
      { status: 500 }
    );
  }
}
