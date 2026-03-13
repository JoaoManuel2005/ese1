# SharePoint Integration Setup Guide

## Overview

The application automatically fetches SharePoint metadata (lists, libraries, columns, schemas) when parsing Power Platform solutions that reference SharePoint sites. This supports **two authentication modes**:

1. **Application-Only Authentication** (for developers) - Uses service principal credentials from `.env`
2. **User Delegation Authentication** (for clients) - Interactive browser popup for user login

## Features

✅ **Automatic Detection** - Detects SharePoint URLs in solution exports  
✅ **Rich Metadata** - Fetches lists, libraries, columns, and schemas  
✅ **Dual Authentication** - App credentials (developers) OR user login popup (clients)  
✅ **Documentation Integration** - SharePoint data included in generated docs  
✅ **Offline Fallback** - Works without credentials (skips metadata fetch)

## Authentication Modes

### Mode 1: Application-Only (for Developers)

**Use when:** You have Azure AD admin access to create app registrations  
**How it works:** Service principal with client secret credentials in `.env`  
**User experience:** Fully automatic, no popup required

### Mode 2: User Delegation (for Clients)

**Use when:** Running without configured `.env` credentials  
**How it works:** User signs in with their Microsoft account via browser popup  
**User experience:** One-time login popup when SharePoint URLs detected

## Setup Instructions

### Option A: Application-Only Authentication Setup (Recommended for Developers)

#### Step 1: Register Azure AD Application

1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Fill in:
   - **Name**: `PowerPlatform-Doc-Generator-SharePoint`
   - **Supported account types**: `Accounts in this organizational directory only`
   - **Redirect URI**: Leave empty (not needed for app-only auth)
5. Click **Register**

### Step 2: Grant API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission** > **Microsoft Graph** > **Application permissions**
3. Add the following permissions:
   - `Sites.Read.All` (Read items in all site collections)
4. Click **Add permissions**
5. Click **Grant admin consent for [Your Organization]** (requires admin)
   - ⚠️ **Admin consent is required** - Ask your Azure AD admin if needed

### Step 3: Create Client Secret

1. In your app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `PowerPlatform-Doc-Generator`
4. Expires: Choose appropriate duration (e.g., 12 months)
5. Click **Add**
6. **Copy the secret value immediately** (you won't see it again!)

### Step 4: Configure Environment Variables

Add the following to your `.env` file in the `dotnet-backend/` directory:

```env
# SharePoint Integration (Microsoft Graph API)
SHAREPOINT_TENANT_ID=your-tenant-id-here
SHAREPOINT_CLIENT_ID=your-client-id-here
SHAREPOINT_CLIENT_SECRET=your-client-secret-here
```

**Where to find these values:**

- **SHAREPOINT_TENANT_ID**: 
  - Azure Portal > Azure Active Directory > Overview > "Tenant ID"
  - Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

- **SHAREPOINT_CLIENT_ID**: 
  - Your app registration > Overview > "Application (client) ID"
  - Format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

- **SHAREPOINT_CLIENT_SECRET**: 
  - The secret value you copied in Step 3
  - Format: `xxx~xxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### Step 5: Rebuild and Restart

```bash
# If using Docker
docker-compose down
docker-compose up --build -d

# If running locally
cd dotnet-backend
dotnet restore
dotnet build
dotnet run
```

### Step 6: Verify Configuration

Check the SharePoint service status:

```bash
curl http://localhost:8001/sharepoint-status
```

Expected response:
```json
{
  "configured": true,
  "message": "SharePoint service is configured and ready"
}
```

## How It Works

1. **User uploads** Power Platform solution (.zip)
2. **Parser detects** SharePoint URLs in solution components
3. **Service auto-fetches** metadata from SharePoint (if configured)
4. **Documentation includes** SharePoint lists, libraries, and column schemas
5. **User sees** enriched documentation with actual SharePoint structure

## Without Configuration

If SharePoint credentials are **not configured**:
- ✅ Solution parsing still works
- ✅ Documentation generation works
- ❌ SharePoint metadata not fetched (URLs will be shown but no details)
- ℹ️ Log message: "SharePoint service not configured"

## Troubleshooting

### "SharePoint service not configured"

**Cause**: Environment variables missing or invalid  
**Solution**: Verify variables in `.env` file and restart backend

### "Failed to fetch SharePoint metadata"

**Possible causes:**
1. **Invalid credentials** - Check tenant ID, client ID, and secret
2. **Missing permissions** - Ensure `Sites.Read.All` is granted
3. **Admin consent not granted** - Ask Azure AD admin to grant consent
4. **Invalid SharePoint URL** - Check that URLs are in correct format

### "Unauthorized" or "403 Forbidden"

**Cause**: App doesn't have `Sites.Read.All` permission or admin consent not granted  
**Solution**: 
1. Go to app registration > API permissions
2. Verify `Sites.Read.All` is present
3. Click "Grant admin consent" (requires admin)

### Check Logs

View backend logs for detailed error messages:

```bash
# Docker
docker logs dotnet-backend

# Local
# Check console output where dotnet run is executing
```

## Security Best Practices

✅ **Never commit** `.env` files to version control  
✅ **Rotate secrets** regularly (e.g., every 6-12 months)  
✅ **Use least privilege** - Only grant `Sites.Read.All`, nothing more  
✅ **Monitor usage** - Check Azure AD sign-in logs periodically  
✅ **Separate environments** - Use different apps for dev/staging/prod

---

### Option B: User Delegation Authentication (For Clients Without .env)

If the `.env` file is not configured (e.g., when distributing to clients), the application will automatically prompt users to sign in with their Microsoft account when SharePoint URLs are detected.

#### How It Works

1. **Solution Upload** - User uploads Power Platform solution ZIP
2. **SharePoint Detection** - Backend detects SharePoint URLs during parsing
3. **Authentication Prompt** - Frontend shows popup: "SharePoint Access Required"
4. **User Login** - User clicks "Sign in with Microsoft" → OAuth popup opens
5. **Token Acquisition** - MSAL acquires access token with `Sites.Read.All` scope
6. **Metadata Fetch** - Frontend sends token to backend → backend fetches metadata
7. **Documentation Generation** - Continues with SharePoint data included

#### User Experience

**When SharePoint URLs are detected:**

![SharePoint Login Modal](#)

- ✅ Shows list of detected SharePoint sites
- ✅ Explains what data will be accessed (read-only)
- ✅ Allows skipping authentication (continues without SharePoint data)
- ✅ One-time login per session (token cached)

#### Technical Details

- **Frontend**: Uses `@azure/msal-browser` with PublicClientApplication
- **Backend Endpoint**: `POST /fetch-sharepoint-metadata-with-user-token`
- **Scopes Required**: `Sites.Read.All`, `User.Read`
- **Demo App ID**: Uses Microsoft Graph Explorer app (public client)
- **Token Lifetime**: ~1 hour (automatic silent renewal)

#### For Production Deployment

If deploying to clients without `.env` credentials:

1. **No Azure AD setup required** - Users authenticate with their own Microsoft accounts
2. **User must have access** - User's Microsoft account must have permissions to access the SharePoint sites
3. **Popup blockers** - Ensure browser allows popups from your application domain
4. **Session storage** - Tokens are stored in browser session storage (cleared on tab close)

**Limitations:**
- User must be signed in to Microsoft 365 with access to the SharePoint sites
- Token expires after ~1 hour (requires re-authentication)
- Cannot access sites the user doesn't have permissions for

#### Skip Authentication

Users can click **Skip** to:
- Continue without SharePoint metadata
- Generate documentation with basic solution info only
- Avoid Microsoft sign-in (useful for offline/restricted environments)

---

## API Endpoints

### Check Status
```http
GET /sharepoint-status
```

### Manually Fetch Metadata (App-Only Auth)
```http
POST /fetch-sharepoint-metadata
Content-Type: application/json

{
  "sharePointUrls": [
    "https://contoso.sharepoint.com/sites/Marketing",
    "https://contoso.sharepoint.com/sites/Sales"
  ],
  "includeColumns": true
}
```

### Fetch Metadata with User Token (User Delegation)
```http
POST /fetch-sharepoint-metadata-with-user-token
Content-Type: application/json

{
  "accessToken": "eyJ0eXAiOiJKV1QiLCJhbGciOiJSUz...",
  "sharePointUrls": [
    "https://contoso.sharepoint.com/sites/Marketing"
  ],
  "includeColumns": true
}
```

## Example Documentation Output

When SharePoint metadata is fetched, the generated documentation includes:

```markdown
## SharePoint Integration Details

### Marketing Site
**Site URL:** https://contoso.sharepoint.com/sites/Marketing

#### SharePoint Lists
- **Projects**
  - URL: https://contoso.sharepoint.com/sites/Marketing/Lists/Projects
  - Columns:
    - `Title` (text) (Required)
    - `StartDate` (dateTime)
    - `Status` (choice)

#### Document Libraries
- **Documents**
  - URL: https://contoso.sharepoint.com/sites/Marketing/Shared%20Documents

*This data was automatically fetched from SharePoint using Microsoft Graph API*
```

## Need Help?

- [Microsoft Graph Documentation](https://learn.microsoft.com/en-us/graph/overview)
- [SharePoint Sites API](https://learn.microsoft.com/en-us/graph/api/resources/sharepoint)
- [Azure AD App Registration](https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app)

## Optional: Disable SharePoint Integration

To disable SharePoint metadata fetching entirely:

1. Remove or comment out the environment variables from `.env`
2. Restart the backend

The application will continue to work normally, just without SharePoint metadata enrichment.
