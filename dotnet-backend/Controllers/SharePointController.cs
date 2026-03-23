using Microsoft.AspNetCore.Mvc;
using RagBackend.Models;
using RagBackend.Services;

namespace RagBackend.Controllers;

[ApiController]
public class SharePointController : ControllerBase
{
    private readonly SharePointService _sharePoint;
    private readonly ILogger<SharePointController> _logger;

    public SharePointController(SharePointService sharePoint, ILogger<SharePointController> logger)
    {
        _sharePoint = sharePoint;
        _logger = logger;
    }

    /// <summary>
    /// Fetch SharePoint metadata for detected URLs
    /// Uses Application-Only authentication (no user interaction required)
    /// </summary>
    [HttpPost("fetch-sharepoint-metadata")]
    public async Task<IActionResult> FetchMetadata([FromBody] SharePointFetchRequest request)
    {
        if (request.SharePointUrls == null || request.SharePointUrls.Count == 0)
        {
            return BadRequest(new { 
                ok = false, 
                error = new { 
                    code = "INVALID_REQUEST", 
                    message = "No SharePoint URLs provided" 
                } 
            });
        }

        if (!_sharePoint.IsConfigured)
        {
            return Ok(new SharePointFetchResponse
            {
                Success = false,
                AuthenticationRequired = true,
                ErrorMessage = "SharePoint service not configured. Please set up Azure AD app credentials."
            });
        }

        try
        {
            var response = await _sharePoint.FetchMetadataAsync(
                request.SharePointUrls, 
                request.IncludeColumns);

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch SharePoint metadata");
            return StatusCode(500, new SharePointFetchResponse
            {
                Success = false,
                ErrorMessage = $"Internal server error: {ex.Message}"
            });
        }
    }

    /// <summary>
    /// Fetch SharePoint metadata using user-provided access token
    /// Uses User Delegation authentication (interactive login)
    /// </summary>
    [HttpPost("fetch-sharepoint-metadata-with-user-token")]
    public async Task<IActionResult> FetchMetadataWithUserToken([FromBody] SharePointUserTokenRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.AccessToken))
        {
            return BadRequest(new { 
                ok = false, 
                error = new { 
                    code = "INVALID_TOKEN", 
                    message = "Access token is required" 
                } 
            });
        }

        if (request.SharePointUrls == null || request.SharePointUrls.Count == 0)
        {
            return BadRequest(new { 
                ok = false, 
                error = new { 
                    code = "INVALID_REQUEST", 
                    message = "No SharePoint URLs provided" 
                } 
            });
        }

        try
        {
            var response = await _sharePoint.FetchMetadataWithUserTokenAsync(
                request.AccessToken,
                request.SharePointUrls, 
                request.IncludeColumns);

            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to fetch SharePoint metadata with user token");
            return StatusCode(500, new SharePointFetchResponse
            {
                Success = false,
                ErrorMessage = $"Internal server error: {ex.Message}"
            });
        }
    }

    /// <summary>
    /// Check if SharePoint service is configured and ready
    /// </summary>
    [HttpGet("sharepoint-status")]
    public IActionResult GetStatus()
    {
        return Ok(new
        {
            configured = _sharePoint.IsConfigured,
            message = _sharePoint.IsConfigured 
                ? "SharePoint service is configured and ready" 
                : "SharePoint service requires Azure AD app configuration"
        });
    }
}
