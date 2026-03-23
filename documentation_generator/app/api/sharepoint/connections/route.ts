import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import { sharePointConnectionStore } from "../../../../lib/sharePointConnections";

type ServerSessionLike = {
  tenantId?: string;
  user?: { email?: string | null } | null;
} | null;

function resolveTenantId(session: ServerSessionLike): string {
  if (session?.tenantId && session.tenantId.trim().length > 0) {
    return session.tenantId;
  }

  const email = session?.user?.email;
  if (email && email.includes("@")) {
    return email.split("@")[1].toLowerCase();
  }

  return "unknown-tenant";
}

export async function POST() {
  const session = (await getServerSession(authOptions)) as ServerSessionLike;
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.email;
  const accountEmail = session.user.email;
  const tenantId = resolveTenantId(session);
  const createdAt = new Date().toISOString();

  const connection = sharePointConnectionStore.create(userId, {
    id: randomUUID(),
    label: `${tenantId} | ${accountEmail}`,
    tenantId,
    accountEmail,
    createdAt,
    status: "active",
  });

  return NextResponse.json({ connection });
}
