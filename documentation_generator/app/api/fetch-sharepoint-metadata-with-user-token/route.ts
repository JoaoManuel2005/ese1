import { NextResponse } from "next/server";

const DOTNET_BACKEND_URL = process.env.DOTNET_BACKEND_URL || "http://localhost:5001";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accessToken, sharePointUrls, includeColumns } = body;

    if (!accessToken) {
      return NextResponse.json(
        { error: "Access token is required" },
        { status: 400 }
      );
    }

    if (!sharePointUrls || !Array.isArray(sharePointUrls) || sharePointUrls.length === 0) {
      return NextResponse.json(
        { error: "SharePoint URLs are required" },
        { status: 400 }
      );
    }

    // Forward request to .NET backend
    const response = await fetch(
      `${DOTNET_BACKEND_URL}/fetch-sharepoint-metadata-with-user-token`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accessToken,
          sharePointUrls,
          includeColumns: includeColumns !== false,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Failed to fetch SharePoint metadata" },
        { status: response.status }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("SharePoint user token fetch error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
