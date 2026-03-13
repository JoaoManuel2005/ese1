import NextAuth, { NextAuthOptions } from "next-auth";
import AzureADProvider from 'next-auth/providers/azure-ad';
import { BASE_LOGIN_AUTHORIZATION_PARAMS } from "../../../auth/authRequests";

function getTenantIdFromProfile(profile: unknown): string | undefined {
  if (!profile || typeof profile !== "object") return undefined;
  const candidate = (profile as Record<string, unknown>).tid;
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : undefined;
}

function getTenantIdFromIdToken(idToken?: string): string | undefined {
  if (!idToken) return undefined;
  const parts = idToken.split(".");
  if (parts.length < 2) return undefined;

  try {
    const payloadBase64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const paddedPayload = payloadBase64.padEnd(Math.ceil(payloadBase64.length / 4) * 4, "=");
    const payload = JSON.parse(Buffer.from(paddedPayload, "base64").toString("utf8")) as Record<string, unknown>;
    const tid = payload.tid;
    return typeof tid === "string" && tid.trim().length > 0 ? tid : undefined;
  } catch {
    return undefined;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: "organizations",
      authorization: {
        params: BASE_LOGIN_AUTHORIZATION_PARAMS,
      },
    })
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.access_token = account.access_token;
        token.expires_at = account.expires_at;
        if (account.refresh_token) {
          token.refresh_token = account.refresh_token;
        }
      }

      const tenantId = getTenantIdFromProfile(profile) || getTenantIdFromIdToken(account?.id_token);
      if (tenantId) {
        token.tenantId = tenantId;
      }
      return token;
    },
    async session({ session, token }) {
      session.access_token = typeof token.access_token === "string" ? token.access_token : undefined;
      session.expires_at = typeof token.expires_at === "number" ? token.expires_at : undefined;
      session.tenantId = typeof token.tenantId === "string" ? token.tenantId : undefined;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
