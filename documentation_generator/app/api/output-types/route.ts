import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export async function GET() {
  try {
    const configPath = path.join(process.cwd(), "config", "output-types.json");
    const raw = await readFile(configPath, "utf-8");
    const outputTypes = JSON.parse(raw);
    return NextResponse.json(outputTypes);
  } catch {
    return NextResponse.json(
      { error: "Failed to load output types config" },
      { status: 500 }
    );
  }
}
