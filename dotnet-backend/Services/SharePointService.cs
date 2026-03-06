using Azure.Identity;
using Microsoft.Graph;
using Microsoft.Graph.Models;
using RagBackend.Models;
using System.Text.RegularExpressions;

namespace RagBackend.Services;

/// <summary>
/// Service for fetching SharePoint metadata using Microsoft Graph API
/// Uses Application-Only authentication (no user interaction)
/// </summary>
public class SharePointService
{
    private readonly ILogger<SharePointService> _logger;
    private readonly IConfiguration _config;
    private GraphServiceClient? _graphClient;
    private bool _isConfigured;

    public SharePointService(ILogger<SharePointService> logger, IConfiguration config)
    {
        _logger = logger;
        _config = config;
        InitializeGraphClient();
    }

    private void InitializeGraphClient()
    {
        var tenantId = _config["SharePoint:TenantId"] ?? Environment.GetEnvironmentVariable("SHAREPOINT_TENANT_ID");
        var clientId = _config["SharePoint:ClientId"] ?? Environment.GetEnvironmentVariable("SHAREPOINT_CLIENT_ID");
        var clientSecret = _config["SharePoint:ClientSecret"] ?? Environment.GetEnvironmentVariable("SHAREPOINT_CLIENT_SECRET");

        if (string.IsNullOrWhiteSpace(tenantId) || string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            _logger.LogWarning("SharePoint credentials not configured. Set SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET environment variables.");
            _isConfigured = false;
            return;
        }

        try
        {
            var credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
            _graphClient = new GraphServiceClient(credential);
            _isConfigured = true;
            _logger.LogInformation("✓ SharePoint service initialized with Application-Only authentication");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize Microsoft Graph client");
            _isConfigured = false;
        }
    }

    public bool IsConfigured => _isConfigured;

    /// <summary>
    /// Fetch metadata for multiple SharePoint URLs
    /// </summary>
    public async Task<SharePointFetchResponse> FetchMetadataAsync(List<string> sharePointUrls, bool includeColumns = true)
    {
        if (!_isConfigured || _graphClient == null)
        {
            return new SharePointFetchResponse
            {
                Success = false,
                AuthenticationRequired = true,
                ErrorMessage = "SharePoint service not configured. Configure Azure AD app credentials."
            };
        }

        var response = new SharePointFetchResponse { Success = true };

        foreach (var url in sharePointUrls.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            try
            {
                var siteMetadata = await FetchSiteMetadataAsync(_graphClient, url, includeColumns);
                response.Sites.Add(siteMetadata);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to fetch SharePoint data for URL: {Url}", url);
                response.Sites.Add(new SharePointMetadata
                {
                    SiteUrl = url,
                    ErrorMessage = $"Failed to fetch: {ex.Message}"
                });
            }
        }

        response.Success = response.Sites.Any(s => s.ErrorMessage == null);
        return response;
    }

    /// <summary>
    /// Fetch metadata using user-provided access token
    /// </summary>
    public async Task<SharePointFetchResponse> FetchMetadataWithUserTokenAsync(string accessToken, List<string> sharePointUrls, bool includeColumns = true)
    {
        var response = new SharePointFetchResponse { Success = true };

        try
        {
            // Create a Graph client with the user's access token
            var tokenCredential = new UserAccessTokenCredential(accessToken);
            var userGraphClient = new GraphServiceClient(tokenCredential);

            foreach (var url in sharePointUrls.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                try
                {
                    var siteMetadata = await FetchSiteMetadataAsync(userGraphClient, url, includeColumns);
                    response.Sites.Add(siteMetadata);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to fetch SharePoint data for URL: {Url}", url);
                    response.Sites.Add(new SharePointMetadata
                    {
                        SiteUrl = url,
                        ErrorMessage = $"Failed to fetch: {ex.Message}"
                    });
                }
            }

            response.Success = response.Sites.Any(s => s.ErrorMessage == null);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create Graph client with user token");
            response.Success = false;
            response.ErrorMessage = $"Authentication failed: {ex.Message}";
        }

        return response;
    }

    /// <summary>
    /// Fetch metadata for a single SharePoint site
    /// </summary>
    private async Task<SharePointMetadata> FetchSiteMetadataAsync(GraphServiceClient graphClient, string sharePointUrl, bool includeColumns)
    {
        var metadata = new SharePointMetadata { SiteUrl = sharePointUrl };

        try
        {
            // Extract site info from URL
            var (hostName, sitePath) = ParseSharePointUrl(sharePointUrl);
            if (hostName == null || sitePath == null)
            {
                metadata.ErrorMessage = "Invalid SharePoint URL format";
                return metadata;
            }

            // Get site ID using the Graph API
            var site = await graphClient.Sites[$"{hostName}:{sitePath}"].GetAsync();
            
            if (site == null)
            {
                metadata.ErrorMessage = "Site not found";
                return metadata;
            }

            metadata.SiteId = site.Id ?? "";
            metadata.SiteName = site.DisplayName ?? site.Name ?? "";

            // Fetch lists
            var listsResponse = await graphClient.Sites[site.Id].Lists.GetAsync();
            if (listsResponse?.Value != null)
            {
                foreach (var list in listsResponse.Value)
                {
                    // Skip hidden system lists (start with underscore)
                    if (list.DisplayName?.StartsWith("_") == true || list.Name?.StartsWith("_") == true)
                        continue;

                    // Add as SharePoint list
                    var spList = new SharePointList
                    {
                        Id = list.Id ?? "",
                        Name = list.Name ?? "",
                        DisplayName = list.DisplayName ?? "",
                        Description = list.Description,
                        WebUrl = list.WebUrl ?? ""
                    };

                    // Fetch columns if requested
                    if (includeColumns)
                    {
                        try
                        {
                            var columnsResponse = await graphClient.Sites[site.Id].Lists[list.Id].Columns.GetAsync();
                            if (columnsResponse?.Value != null)
                            {
                                spList.Columns = columnsResponse.Value
                                    .Where(c => !c.Hidden.GetValueOrDefault() && !c.ReadOnly.GetValueOrDefault())
                                    .Select(c => new SharePointColumn
                                    {
                                        Name = c.Name ?? "",
                                        DisplayName = c.DisplayName ?? "",
                                        Type = c.ColumnGroup ?? "text",
                                        Required = c.Required.GetValueOrDefault(),
                                        ReadOnly = c.ReadOnly.GetValueOrDefault()
                                    })
                                    .ToList();
                            }
                        }
                        catch (Exception ex)
                        {
                            _logger.LogWarning(ex, "Failed to fetch columns for list {ListName}", list.Name);
                        }
                    }

                    metadata.Lists.Add(spList);
                }
            }

            // Fetch document libraries (drives)
            try
            {
                var drivesResponse = await graphClient.Sites[site.Id].Drives.GetAsync();
                if (drivesResponse?.Value != null)
                {
                    foreach (var drive in drivesResponse.Value)
                    {
                        metadata.Libraries.Add(new SharePointLibrary
                        {
                            Id = drive.Id ?? "",
                            Name = drive.Name ?? "",
                            DisplayName = drive.Name ?? "",
                            Description = drive.Description,
                            WebUrl = drive.WebUrl ?? "",
                            DriveType = drive.DriveType ?? "documentLibrary"
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to fetch drives for site {SiteName}", site.Id);
            }

            _logger.LogInformation("✓ Fetched SharePoint metadata: {SiteName} ({ListCount} lists, {LibCount} libraries)",
                metadata.SiteName, metadata.Lists.Count, metadata.Libraries.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error fetching SharePoint site: {Url}", sharePointUrl);
            metadata.ErrorMessage = ex.Message;
        }

        return metadata;
    }

    /// <summary>
    /// Parse SharePoint URL to extract hostname and site path
    /// Example: https://contoso.sharepoint.com/sites/Marketing -> (contoso.sharepoint.com, /sites/Marketing)
    /// </summary>
    private (string? hostName, string? sitePath) ParseSharePointUrl(string url)
    {
        try
        {
            var uri = new Uri(url);
            var hostName = uri.Host;
            var sitePath = uri.AbsolutePath.TrimEnd('/');

            // Handle root site
            if (string.IsNullOrEmpty(sitePath))
                sitePath = "/";

            return (hostName, sitePath);
        }
        catch
        {
            return (null, null);
        }
    }

    /// <summary>
    /// Extract SharePoint site URL from a list/library URL
    /// Example: https://contoso.sharepoint.com/sites/Marketing/Lists/Tasks -> https://contoso.sharepoint.com/sites/Marketing
    /// </summary>
    public string ExtractSiteUrl(string sharePointUrl)
    {
        try
        {
            var uri = new Uri(sharePointUrl);
            var path = uri.AbsolutePath;

            // Remove common suffixes like /Lists/ListName, /Shared Documents, etc.
            var sitePathMatch = Regex.Match(path, @"^(/sites/[^/]+|/teams/[^/]+)", RegexOptions.IgnoreCase);
            if (sitePathMatch.Success)
            {
                return $"{uri.Scheme}://{uri.Host}{sitePathMatch.Value}";
            }

            // Root site
            return $"{uri.Scheme}://{uri.Host}";
        }
        catch
        {
            return sharePointUrl;
        }
    }
}

/// <summary>
/// Custom TokenCredential that wraps a user-provided access token
/// </summary>
internal class UserAccessTokenCredential : Azure.Core.TokenCredential
{
    private readonly string _accessToken;

    public UserAccessTokenCredential(string accessToken)
    {
        _accessToken = accessToken ?? throw new ArgumentNullException(nameof(accessToken));
    }

    public override Azure.Core.AccessToken GetToken(Azure.Core.TokenRequestContext requestContext, CancellationToken cancellationToken)
    {
        return new Azure.Core.AccessToken(_accessToken, DateTimeOffset.UtcNow.AddHours(1));
    }

    public override ValueTask<Azure.Core.AccessToken> GetTokenAsync(Azure.Core.TokenRequestContext requestContext, CancellationToken cancellationToken)
    {
        return new ValueTask<Azure.Core.AccessToken>(GetToken(requestContext, cancellationToken));
    }
}
