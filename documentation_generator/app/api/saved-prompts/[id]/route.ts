import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import {
  deleteSavedPrompt,
  getSavedPrompt,
  SavedPromptConflictError,
  SavedPromptNotFoundError,
  SavedPromptValidationError,
  selectSavedPromptForUser,
  updateSavedPrompt,
} from "../../../../lib/savedPrompts";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const prompt = getSavedPrompt(userId, id, true);
    if (!prompt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ prompt });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to load prompt" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (body?.select === true) {
      const prompt = selectSavedPromptForUser(userId, id);
      return NextResponse.json({ prompt });
    }

    const prompt = updateSavedPrompt(userId, id, {
      name: body?.name,
      promptText: body?.promptText ?? body?.prompt_text,
    });
    return NextResponse.json({ prompt });
  } catch (error: any) {
    if (
      error instanceof SavedPromptValidationError ||
      error instanceof SavedPromptConflictError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SavedPromptNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(
      { error: error?.message || "Failed to update prompt" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    deleteSavedPrompt(userId, id);
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    if (error instanceof SavedPromptNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error?.message || "Failed to delete prompt" },
      { status: 500 }
    );
  }
}

