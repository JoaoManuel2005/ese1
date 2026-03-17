namespace RagBackend.Models;

/// <summary>
/// SharePoint site and list metadata fetched from Microsoft Graph
/// </summary>
public class SharePointMetadata
{
    public string SiteUrl { get; set; } = "";
    public string SiteId { get; set; } = "";
    public string SiteName { get; set; } = "";
    public List<SharePointList> Lists { get; set; } = new();
    public List<SharePointLibrary> Libraries { get; set; } = new();
    public string? ErrorMessage { get; set; }
}

public class SharePointList
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Description { get; set; }
    public List<SharePointColumn> Columns { get; set; } = new();
    public string WebUrl { get; set; } = "";
    public int ItemCount { get; set; }
}

public class SharePointLibrary
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Description { get; set; }
    public string WebUrl { get; set; } = "";
    public string DriveType { get; set; } = "";
}

public class SharePointColumn
{
    public string Name { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Type { get; set; } = "";
    public bool Required { get; set; }
    public bool ReadOnly { get; set; }
}

/// <summary>
/// Request to fetch SharePoint data for detected URLs
/// </summary>
public class SharePointFetchRequest
{
    public List<string> SharePointUrls { get; set; } = new();
    public bool IncludeColumns { get; set; } = true;
}

/// <summary>
/// Request to fetch SharePoint data using user-provided access token
/// </summary>
public class SharePointUserTokenRequest
{
    public string AccessToken { get; set; } = "";
    public List<string> SharePointUrls { get; set; } = new();
    public bool IncludeColumns { get; set; } = true;
}

/// <summary>
/// Response containing enriched SharePoint metadata
/// </summary>
public class SharePointFetchResponse
{
    public bool Success { get; set; }
    public List<SharePointMetadata> Sites { get; set; } = new();
    public string? ErrorMessage { get; set; }
    public bool AuthenticationRequired { get; set; }
}
