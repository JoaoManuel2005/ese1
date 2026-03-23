import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import {
  createSavedPrompt,
  listSavedPrompts,
  SavedPromptConflictError,
  SavedPromptValidationError,
} from "../../../lib/savedPrompts";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.json({ prompts: listSavedPrompts(userId) });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load saved prompts" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const name = body?.name;
    const promptText = body?.promptText ?? body?.prompt_text;

    const prompt = createSavedPrompt(userId, name, promptText);
    return NextResponse.json({ prompt }, { status: 201 });
  } catch (error: any) {
    if (error instanceof SavedPromptValidationError || error instanceof SavedPromptConflictError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: error?.message || "Failed to save prompt" },
      { status: 500 }
    );
  }
}

