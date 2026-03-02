using Microsoft.AspNetCore.Mvc;
using RagBackend.Services;

namespace RagBackend.Controllers;

[ApiController]
[Route("[controller]")]
public class HealthController : ControllerBase
{
    private readonly PacParserService _pac;

    public HealthController(PacParserService pac)
    {
        _pac = pac;
    }

    [HttpGet("/health")]
    public IActionResult Get() => Ok(new
    {
        status           = "healthy",
        pac_cli_available = _pac.PacAvailable
    });
}
