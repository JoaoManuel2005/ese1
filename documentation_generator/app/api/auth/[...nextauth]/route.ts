import NextAuth, { NextAuthOptions } from "next-auth";
import AzureADProvider from 'next-auth/providers/azure-ad';

export const authOptions: NextAuthOptions = {
  providers: [
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      tenantId: "organizations",
      authorization: {
        params: {
          prompt: "select_account",
          scope: "openid profile email User.Read Sites.Read.All offline_access",
        },
      },
    })
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.access_token = account.access_token;
        token.expires_at = account.expires_at;
        if (account.refresh_token) {
          token.refresh_token = account.refresh_token;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.access_token = typeof token.access_token === "string" ? token.access_token : undefined;
      session.expires_at = typeof token.expires_at === "number" ? token.expires_at : undefined;
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

