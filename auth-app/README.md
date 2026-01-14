## Application Architecture

### Technology Stack
- Framework: Next.js 15.5.9 (Pages Router)
- Authentication: NextAuth.js v4.24.13
- UI: React 19.1.0 with Tailwind CSS 4
- Language: TypeScript 5
- Microsoft Integration: @microsoft/microsoft-graph-client v3.0.7 (installed but not actively used in current code)

### Project Structure
```
auth-app/
├── pages/
│   ├── _app.tsx              # App wrapper with SessionProvider
│   ├── index.tsx             # Home page
│   └── api/
│       └── auth/
│           └── [...nextauth].ts  # NextAuth API route handler
├── components/
│   └── Header/               # Authentication UI component
├── api/examples/             # Example API routes for session handling
└── styles/                   # Global styles
```

## Authentication Architecture

### 1. NextAuth.js Configuration (`pages/api/auth/[...nextauth].ts`)

Uses the Azure AD provider with:
- Client ID: `AZURE_AD_CLIENT_ID`
- Client Secret: `AZURE_AD_CLIENT_SECRET`
- Tenant ID: `AZURE_AD_TENANT_ID`

The `[...nextauth].ts` catch-all route handles:
- `/api/auth/signin`
- `/api/auth/signout`
- `/api/auth/callback`
- `/api/auth/session`

### 2. Session Management

Client-side (`pages/_app.tsx`):
- Wraps the app with `SessionProvider` to provide session context

Server-side (example routes):
- `api/examples/session.ts`: Retrieves session data
- `api/examples/admin-protected.ts`: Protects routes by checking session

### 3. Authentication Flow

1. User clicks "Sign in" → triggers `signIn()` from `next-auth/react`
2. Redirect to Azure Entra ID → user authenticates
3. Azure callback → NextAuth processes the OAuth response
4. Session creation → NextAuth creates a session (stored server-side)
5. Client receives session → `useSession()` hook provides session data
6. UI updates → Header shows user info (email/name, avatar)

### 4. User Interface

The `Header` component (`components/Header/header.tsx`):
- Shows "Sign in" when unauthenticated
- Shows user info (email/name, avatar) and "Sign out" when authenticated
- Uses `useSession()` to read session state

## Azure Entra ID Integration

### Required Environment Variables
```env
AZURE_AD_CLIENT_ID=        # From Azure registration
AZURE_AD_CLIENT_SECRET=    # From Azure registration
AZURE_AD_TENANT_ID=        # From Azure registration
NEXTAUTH_SECRET=           # Random secret for JWT encryption
```

### Azure App Registration Requirements

In Azure Entra ID, configure:
1. Redirect URI: `https://your-domain.com/api/auth/callback/azure-ad` (or `http://localhost:3000/api/auth/callback/azure-ad` for dev)
2. API permissions: Basic profile and email (usually included by default)
3. Authentication: Enable implicit grant if needed (NextAuth typically uses authorization code flow)

## Security Features

1. Server-side session validation: API routes use `unstable_getServerSession()` to verify authentication
2. Protected routes: Example shows how to restrict access to authenticated users
3. Secure token handling: NextAuth manages OAuth tokens securely
4. CSRF protection: Built into NextAuth

The app provides a foundation for Azure Entra ID authentication with NextAuth.js, with examples for session handling and route protection.