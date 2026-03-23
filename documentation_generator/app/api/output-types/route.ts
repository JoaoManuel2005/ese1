import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]/route";
import { getAvailableOutputTypes } from "../../../lib/outputTypes";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const userId = session?.user?.email ?? null;
    const outputTypes = await getAvailableOutputTypes(userId);
    return NextResponse.json(outputTypes);
  } catch {
    return NextResponse.json(
      { error: "Failed to load output types config" },
      { status: 500 }
    );
  }
}
