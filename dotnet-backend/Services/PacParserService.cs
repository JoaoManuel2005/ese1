using RagBackend.Models;
using System.Diagnostics;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Xml.Linq;

namespace RagBackend.Services;

/// <summary>
/// Equivalent to Python pac_parser.py
/// Parses Power Platform solution ZIP files using PAC CLI (via Docker)
/// and falls back to direct XML parsing when PAC is unavailable.
/// </summary>
public class PacParserService
{
    private readonly ILogger<PacParserService> _logger;
    private readonly IConfiguration _config;
    private string? _pacPath;
    private bool _pacChecked;
    private bool? _pacAvailable;

    private static readonly HashSet<string> SolutionMarkers = new(StringComparer.OrdinalIgnoreCase)
        { "solution.xml", "[content_types].xml" };

    public PacParserService(ILogger<PacParserService> logger, IConfiguration config)
    {
        _logger = logger;
        _config = config;
    }

    public bool PacAvailable
    {
        get
        {
            if (_pacChecked) return _pacAvailable!.Value;
            _pacPath      = FindPacCli();
            _pacAvailable = _pacPath != null;
            _pacChecked   = true;
            return _pacAvailable.Value;
        }
    }

    // ── PAC CLI detection ───────────────────────────────────────────────────────
    private string? FindPacCli()
    {
        // 1. Check if Docker is available and pac-cli container is running
        try
        {
            // First confirm Docker daemon is reachable
            var dockerCheck = RunProcess("docker", new[] { "info", "--format", "{{.ServerVersion}}" }, timeoutSeconds: 10);
            if (dockerCheck.ExitCode == 0)
            {
                // Check if pac-cli container exists and is running
                var containerCheck = RunProcess("docker", new[] { "inspect", "-f", "{{.State.Running}}", "pac-cli" }, timeoutSeconds: 10);
                if (containerCheck.ExitCode == 0 && containerCheck.Output.Trim() == "true")
                {
                    // Container is running — verify PAC CLI works inside it
                    var pacCheck = RunProcess("docker", new[] { "exec", "pac-cli", "pac", "help" }, timeoutSeconds: 30);
                    if (pacCheck.ExitCode == 0)
                    {
                        _logger.LogInformation("✓ Found PAC CLI in Docker container 'pac-cli'");
                        return "docker-container";
                    }
                    _logger.LogWarning("pac-cli container running but 'pac help' failed (exit {Code})", pacCheck.ExitCode);
                }
                else
                {
                    _logger.LogWarning("pac-cli Docker container is not running. Start it with: docker-compose up -d pac-cli");
                }
            }
            else
            {
                _logger.LogWarning("Docker daemon not reachable.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning("Docker check failed: {Msg}", ex.Message);
        }

        // 2. Try local PAC CLI install
        var localCandidates = new[]
        {
            "pac",
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".dotnet", "tools", "pac"),
            "/root/.dotnet/tools/pac",
            "/usr/local/bin/pac",
        };

        foreach (var candidate in localCandidates)
        {
            try
            {
                var r = RunProcess(candidate, new[] { "--version" }, timeoutSeconds: 10);
                if (r.ExitCode == 0)
                {
                    _logger.LogInformation("✓ Found local PAC CLI at: {Path} ({V})", candidate, r.Output.Trim());
                    return candidate;
                }
            }
            catch { /* not found at this path */ }
        }

        _logger.LogWarning("PAC CLI not found. Run: docker-compose up -d pac-cli  (or install PAC CLI locally)");
        return null;
    }

    // ── Public API ──────────────────────────────────────────────────────────────
    public ParsedSolution ParseSolution(string zipPath, string tempDir)
    {
        ParsedSolution solution;
        if (PacAvailable && _pacPath == "docker-container")
        {
            _logger.LogInformation("[PAC] Using PAC CLI Docker container to parse solution");
            solution = ParseViaPacDocker(zipPath, tempDir);
        }
        else
        {
            _logger.LogWarning("[PAC] PAC CLI not available, falling back to direct ZIP parsing");
            solution = ParseDirectly(zipPath);
        }

        PopulateSharepointRefs(solution);
        return solution;
    }

    public (string Type, string Reason) ClassifyUpload(string zipPath)
    {
        try
        {
            using var zip = ZipFile.OpenRead(zipPath);
            var names = zip.Entries.Select(e => e.FullName.ToLower()).ToList();
            bool isSolution = names.Any(n => SolutionMarkers.Any(m => n.EndsWith(m)));
            return isSolution
                ? ("solution_zip", "solution marker found in zip")
                : ("unknown",      "zip missing solution markers");
        }
        catch
        {
            return ("unknown", "invalid zip");
        }
    }

    // Test helper: parse an already extracted solution directory without PAC/docker path.
    public ParsedSolution ParseExtractedDirectoryForTests(string extractedDir)
    {
        var solution = ParseExtractedDirectory(extractedDir);
        PopulateSharepointRefs(solution);
        return solution;
    }

    // ── PAC CLI via Docker ──────────────────────────────────────────────────────
    private ParsedSolution ParseViaPacDocker(string zipPath, string tempDir)
    {
        var opId = Guid.NewGuid().ToString("N");
        var containerWorkDir = $"/pac-workspace/{opId}";
        var containerZip = $"{containerWorkDir}/solution.zip";
        var containerExtractDir = $"{containerWorkDir}/extracted";

        try
        {
            _logger.LogInformation("[PAC] Docker unpack workspace: {Workspace}", containerWorkDir);

            RunProcessChecked("docker", new[] { "exec", "pac-cli", "mkdir", "-p", containerWorkDir }, timeoutSeconds: 30);
            RunProcessChecked("docker", new[] { "cp", zipPath, $"pac-cli:{containerZip}" }, timeoutSeconds: 30);
            RunProcessChecked("docker", new[] { "exec", "pac-cli", "rm", "-rf", containerExtractDir }, timeoutSeconds: 30);
            RunProcessChecked("docker", new[] { "exec", "pac-cli", "mkdir", "-p", containerExtractDir }, timeoutSeconds: 30);

            RunProcessChecked("docker", new[]
            {
                "exec", "pac-cli", "pac", "solution", "unpack",
                "--zipfile", containerZip,
                "--folder", containerExtractDir
            }, timeoutSeconds: 180);

            var extractDir = Path.Combine(tempDir, "pac_extracted");
            Directory.CreateDirectory(extractDir);
            RunProcessChecked("docker", new[] { "cp", $"pac-cli:{containerExtractDir}/.", extractDir }, timeoutSeconds: 60);

            return ParseExtractedDirectory(extractDir);
        }
        catch (Exception ex)
        {
            _logger.LogWarning("PAC Docker parse failed ({Msg}), falling back to direct XML.", ex.Message);
            return ParseDirectly(zipPath);
        }
        finally
        {
            // Best-effort cleanup of container workspace.
            try { RunProcess("docker", new[] { "exec", "pac-cli", "rm", "-rf", containerWorkDir }, timeoutSeconds: 20); }
            catch { /* no-op */ }
        }
    }

    // ── Direct XML parsing (no PAC CLI needed) ──────────────────────────────────
    private ParsedSolution ParseDirectly(string zipPath)
    {
        using var zip = ZipFile.OpenRead(zipPath);

        // Find solution.xml
        var solutionEntry = zip.Entries.FirstOrDefault(e =>
            e.Name.Equals("solution.xml", StringComparison.OrdinalIgnoreCase));

        if (solutionEntry == null)
            return new ParsedSolution { SolutionName = "Unknown", Publisher = "Unknown" };

        using var stream = solutionEntry.Open();
        var xDoc = XDocument.Load(stream);

        var solution  = new ParsedSolution();
        var manifest  = xDoc.Root;

        solution.SolutionName = manifest?.Element("SolutionManifest")
            ?.Element("UniqueName")?.Value
            ?? manifest?.Element("UniqueName")?.Value
            ?? "Unknown";

        solution.Version = manifest?.Element("SolutionManifest")
            ?.Element("Version")?.Value
            ?? manifest?.Element("Version")?.Value
            ?? "1.0.0";

        solution.Publisher = manifest?.Element("SolutionManifest")
            ?.Element("Publisher")?.Element("UniqueName")?.Value
            ?? "Unknown";

        // Parse components
        var componentsEl = manifest?.Element("SolutionManifest")?.Element("RootComponents")
            ?? manifest?.Element("RootComponents");

        if (componentsEl != null)
        {
            foreach (var comp in componentsEl.Elements("RootComponent"))
            {
                var typeCode = comp.Attribute("type")?.Value ?? "0";
                solution.Components.Add(new SolutionComponent
                {
                    Name        = comp.Attribute("schemaName")?.Value ?? comp.Attribute("id")?.Value ?? "Unknown",
                    Type        = MapComponentType(typeCode),
                    Description = $"Component type {typeCode}",
                    Metadata    = new Dictionary<string, object>
                    {
                        ["id"]       = comp.Attribute("id")?.Value ?? "",
                        ["typeCode"] = typeCode
                    }
                });
            }
        }

        // Supplement with other XML files in the zip
        EnrichFromZipEntries(zip, solution);

        return solution;
    }

    private ParsedSolution ParseExtractedDirectory(string dir)
    {
        _logger.LogInformation("[PAC] Parsing extracted directory: {Dir}", dir);
        
        // List all top-level directories to see what PAC CLI extracted
        if (Directory.Exists(dir))
        {
            var topDirs = Directory.GetDirectories(dir).Select(Path.GetFileName).ToArray();
            _logger.LogInformation("[PAC] Top-level directories found: {Dirs}", string.Join(", ", topDirs));
            
            // Count all files
            var allFiles = Directory.GetFiles(dir, "*.*", SearchOption.AllDirectories);
            _logger.LogInformation("[PAC] Total files extracted: {Count}", allFiles.Length);
        }
        
        // Search for solution.xml case-insensitively
        var solutionXml = Directory.GetFiles(dir, "*.*", SearchOption.AllDirectories)
            .FirstOrDefault(f => Path.GetFileName(f).Equals("solution.xml", StringComparison.OrdinalIgnoreCase));
        
        if (solutionXml == null)
        {
            _logger.LogWarning("[PAC] No solution.xml found in extracted directory!");
            return new ParsedSolution { SolutionName = "Unknown", Publisher = "Unknown" };
        }

        _logger.LogInformation("[PAC] Found solution.xml at: {Path}", solutionXml);
        
        var xDoc      = XDocument.Load(solutionXml);
        var solution  = new ParsedSolution();
        var root  = xDoc.Root;

        // Try different XML structures (PAC CLI may output different formats)
        var manifest = root?.Element("SolutionManifest") ?? root;
        
        solution.SolutionName = manifest?.Element("UniqueName")?.Value 
            ?? root?.Element("UniqueName")?.Value 
            ?? FindElementIgnoreCase(root, "UniqueName") 
            ?? "Unknown";
            
        solution.Version = manifest?.Element("Version")?.Value 
            ?? root?.Element("Version")?.Value 
            ?? FindElementIgnoreCase(root, "Version") 
            ?? "1.0.0";
            
        solution.Publisher = manifest?.Element("Publisher")?.Element("UniqueName")?.Value 
            ?? root?.Element("Publisher")?.Element("UniqueName")?.Value
            ?? FindElementIgnoreCase(root, "Publisher")
            ?? "Unknown";

        _logger.LogInformation("[PAC] Solution metadata: Name={Name}, Version={Ver}, Publisher={Pub}", 
            solution.SolutionName, solution.Version, solution.Publisher);

        // Now scan the unpacked directory structure for components
        EnrichFromExtractedDirectory(dir, solution);

        return solution;
    }

    private void EnrichFromExtractedDirectory(string dir, ParsedSolution solution)
    {
        _logger.LogInformation("[PAC] Starting component enrichment from directory: {Dir}", dir);
        int initialCount = solution.Components.Count;

        var useMirror = (_config["PAC_USE_CSHARP_MIRROR"] ?? "true")
            .Equals("true", StringComparison.OrdinalIgnoreCase);
        if (useMirror && TryEnrichWithCSharpMirror(dir, solution))
        {
            AddDataSourceSummaryComponents(solution);
            int mirrorAdded = solution.Components.Count - initialCount;
            _logger.LogInformation("[PAC] C# mirror enrichment added {Added} components (total: {Total})", mirrorAdded, solution.Components.Count);
            var mirrorTypeSummary = solution.Components
                .GroupBy(c => c.Type)
                .OrderByDescending(g => g.Count())
                .Select(g => $"{g.Key}={g.Count()}");
            _logger.LogInformation("[PAC] Component type summary: {Summary}", string.Join(", ", mirrorTypeSummary));
            return;
        }
        
        // Workflows (Cloud Flows)
        ScanWorkflowsDetailed(dir, solution);

        // Entities (Tables) - scan directories only from Entities folder.
        // dvtablesearchentities is a different artifact type and is parsed separately.
        var entitiesDir = Path.Combine(dir, "Entities");
        if (!Directory.Exists(entitiesDir))
            entitiesDir = Path.Combine(dir, "entities");
        
        if (Directory.Exists(entitiesDir))
        {
            var entityDirs = Directory.GetDirectories(entitiesDir);
            _logger.LogInformation("[PAC] Found {Count} entities in {Dir}", entityDirs.Length, Path.GetFileName(entitiesDir));
            
            foreach (var entityDir in entityDirs)
            {
                var entityName = Path.GetFileName(entityDir);
                _logger.LogInformation("[PAC]   Scanning entity: {Entity}", entityName);
                
                // List subdirectories to see what's inside
                var subDirs = Directory.GetDirectories(entityDir).Select(Path.GetFileName).ToArray();
                _logger.LogInformation("[PAC]   Entity subdirectories: {Dirs}", string.Join(", ", subDirs));
                
                var entityXml = Path.Combine(entityDir, "Entity.xml");
                
                string displayName = entityName;
                if (File.Exists(entityXml))
                {
                    try
                    {
                        var doc = XDocument.Load(entityXml);
                        displayName = doc.Root?.Element("Name")?.Element("LocalizedName")?.Attribute("description")?.Value ?? entityName;
                    }
                    catch { /* use folder name */ }
                }
                
                solution.Components.Add(new SolutionComponent
                {
                    Name = entityName,
                    Type = "entity",
                    Description = $"Table: {displayName}"
                });

                // Count INDIVIDUAL attributes/fields
                var attrsDir = Path.Combine(entityDir, "Attributes");
                if (Directory.Exists(attrsDir))
                {
                    var attrFiles = Directory.GetFiles(attrsDir, "*.xml");
                    _logger.LogInformation("[PAC]   Found {Count} attributes in {Entity}", attrFiles.Length, entityName);
                    
                    foreach (var attrFile in attrFiles)
                    {
                        var attrName = Path.GetFileNameWithoutExtension(attrFile);
                        solution.Components.Add(new SolutionComponent
                        {
                            Name = $"{entityName}.{attrName}",
                            Type = "attribute",
                            Description = $"Field: {attrName} (in {entityName})",
                            Metadata = new Dictionary<string, object> { ["entity"] = entityName }
                        });
                    }
                }
                else
                {
                    _logger.LogInformation("[PAC]   No Attributes directory found for {Entity}", entityName);
                }

                // Count INDIVIDUAL forms
                var formsDir = Path.Combine(entityDir, "FormXml");
                if (Directory.Exists(formsDir))
                {
                    var formFiles = Directory.GetFiles(formsDir, "*.xml");
                    _logger.LogInformation("[PAC]   Found {Count} forms in {Entity}", formFiles.Length, entityName);
                    
                    foreach (var formFile in formFiles)
                    {
                        solution.Components.Add(new SolutionComponent
                        {
                            Name = Path.GetFileNameWithoutExtension(formFile),
                            Type = "form",
                            Description = $"Form: {Path.GetFileNameWithoutExtension(formFile)} ({entityName})",
                            Metadata = new Dictionary<string, object> { ["entity"] = entityName }
                        });
                    }
                }

                // Count INDIVIDUAL views (SavedQueries)
                var savedQueriesDir = Path.Combine(entityDir, "SavedQueries");
                if (Directory.Exists(savedQueriesDir))
                {
                    var viewFiles = Directory.GetFiles(savedQueriesDir, "*.xml");
                    _logger.LogInformation("[PAC]   Found {Count} views in {Entity}", viewFiles.Length, entityName);
                    
                    foreach (var viewFile in viewFiles)
                    {
                        solution.Components.Add(new SolutionComponent
                        {
                            Name = Path.GetFileNameWithoutExtension(viewFile),
                            Type = "view",
                            Description = $"View: {Path.GetFileNameWithoutExtension(viewFile)} ({entityName})",
                            Metadata = new Dictionary<string, object> { ["entity"] = entityName }
                        });
                    }
                }

                // Ribbons
                var ribbonDir = Path.Combine(entityDir, "RibbonDiff");
                if (Directory.Exists(ribbonDir))
                {
                    var ribbonFiles = Directory.GetFiles(ribbonDir, "*.xml");
                    if (ribbonFiles.Length > 0)
                    {
                        _logger.LogInformation("[PAC]   Found {Count} ribbon customizations in {Entity}", ribbonFiles.Length, entityName);
                        foreach (var ribbonFile in ribbonFiles)
                        {
                            solution.Components.Add(new SolutionComponent
                            {
                                Name = $"{entityName}_ribbon",
                                Type = "ribbon",
                                Description = $"Ribbon customization for {entityName}"
                            });
                        }
                    }
                }
            }
        }

        // Bots (Copilot Studio)
        ScanBots(dir, solution);

        // Bot Components (Topics, GPT, Dialogs)
        var botComponentsDir = Path.Combine(dir, "botcomponents");
        if (Directory.Exists(botComponentsDir))
        {
            var componentDirs = Directory.GetDirectories(botComponentsDir);
            var componentFiles = Directory.GetFiles(botComponentsDir, "*.*", SearchOption.TopDirectoryOnly);
            _logger.LogInformation("[PAC] Found {DirCount} bot component directories and {FileCount} files in botcomponents/",
                componentDirs.Length, componentFiles.Length);
            
            foreach (var componentDir in componentDirs)
            {
                var name = Path.GetFileName(componentDir);
                var type = name.Contains(".topic.") ? "bot_topic" :
                           name.Contains(".gpt.") ? "bot_gpt" : "bot_component";
                var topicName = name.Split('.').Last();
                
                solution.Components.Add(new SolutionComponent
                {
                    Name = topicName,
                    Type = type,
                    Description = $"Copilot {type.Replace("bot_", "")}: {topicName}",
                    Metadata = new Dictionary<string, object>
                    {
                        ["full_name"] = name,
                        ["file_count"] = Directory.GetFiles(componentDir, "*.*", SearchOption.AllDirectories).Length
                    }
                });
            }

            foreach (var componentFile in componentFiles)
            {
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileNameWithoutExtension(componentFile),
                    Type = "bot_component_file",
                    Description = $"Bot Component File: {Path.GetFileName(componentFile)}",
                    Metadata = new Dictionary<string, object>
                    {
                        ["extension"] = Path.GetExtension(componentFile),
                        ["size_bytes"] = new FileInfo(componentFile).Length
                    }
                });
            }
        }

        // Dataverse Search (Knowledge Sources)
        ScanKnowledgeSources(dir, "dvtablesearchs", solution);
        ScanKnowledgeSources(dir, "dvtablesearches", solution);
        ScanDataverseSearchEntities(dir, solution);

        // OptionSets (Choices)
        ScanDirectory(dir, "OptionSets", "*.xml", "optionset", "Choice", solution);

        // Canvas Apps
        var canvasAppsDir = Path.Combine(dir, "CanvasApps");
        if (Directory.Exists(canvasAppsDir))
        {
            var appDirs = Directory.GetDirectories(canvasAppsDir);
            var appFiles = Directory.GetFiles(canvasAppsDir, "*.*", SearchOption.TopDirectoryOnly);
            
            _logger.LogInformation("[PAC] Found {DirCount} canvas app directories and {FileCount} files in CanvasApps/", 
                appDirs.Length, appFiles.Length);
            
            foreach (var appDir in appDirs)
            {
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileName(appDir),
                    Type = "canvas_app",
                    Description = $"Canvas App: {Path.GetFileName(appDir)}"
                });
            }
            
            // Also check for .msapp files
            foreach (var appFile in appFiles.Where(f => f.EndsWith(".msapp", StringComparison.OrdinalIgnoreCase)))
            {
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileNameWithoutExtension(appFile),
                    Type = "canvas_app",
                    Description = $"Canvas App: {Path.GetFileName(appFile)}"
                });
            }
        }

        // WebResources
        ScanDirectory(dir, "WebResources", "*.js", "webresource", "JavaScript", solution);
        ScanDirectory(dir, "WebResources", "*.html", "webresource", "HTML", solution);
        ScanDirectory(dir, "WebResources", "*.css", "webresource", "CSS", solution);
        ScanDirectory(dir, "WebResources", "*.xml", "webresource", "Data XML", solution);

        // Plugin Assemblies
        var pluginDir = Path.Combine(dir, "PluginAssemblies");
        if (Directory.Exists(pluginDir))
        {
            foreach (var pluginFolder in Directory.GetDirectories(pluginDir))
            {
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileName(pluginFolder),
                    Type = "plugin_assembly",
                    Description = $"Plugin Assembly: {Path.GetFileName(pluginFolder)}"
                });
            }
        }

        // SDK Message Processing Steps (Plugin Steps)
        var sdkStepsDir = Path.Combine(dir, "SdkMessageProcessingSteps");
        if (Directory.Exists(sdkStepsDir))
        {
            foreach (var stepFile in Directory.GetFiles(sdkStepsDir, "*.xml", SearchOption.AllDirectories))
            {
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileNameWithoutExtension(stepFile),
                    Type = "plugin_step",
                    Description = $"Plugin Step: {Path.GetFileNameWithoutExtension(stepFile)}"
                });
            }
        }

        // Security Roles
        ScanDirectory(dir, "Roles", "*.xml", "security_role", "Security Role", solution);

        // Reports
        ScanDirectory(dir, "Reports", "*.xml", "report", "Report", solution);

        // Connection References
        ScanConnectionReferences(dir, solution);

        // Environment Variables (try multiple possible names)
        ScanEnvironmentVariables(dir, solution);

        // Assets (images, icons, etc.)
        var assetsDir = Path.Combine(dir, "Assets");
        if (Directory.Exists(assetsDir))
        {
            var assetFiles = Directory.GetFiles(assetsDir, "*.*", SearchOption.AllDirectories);
            if (assetFiles.Length > 0)
            {
                _logger.LogInformation("[PAC] Found {Count} asset files in Assets/", assetFiles.Length);
                foreach (var assetFile in assetFiles)
                {
                    solution.Components.Add(new SolutionComponent
                    {
                        Name = Path.GetFileName(assetFile),
                        Type = "asset",
                        Description = $"Asset: {Path.GetFileName(assetFile)}"
                    });
                }
            }
        }

        // Parse customizations.xml for detailed entity metadata (attributes, forms, views)
        ParseCustomizationsXml(dir, solution);
        var usePythonParity = (_config["PAC_USE_PYTHON_PARITY"] ?? "false")
            .Equals("true", StringComparison.OrdinalIgnoreCase);
        if (usePythonParity)
            TryEnrichWithPythonParity(dir, solution);
        AddDataSourceSummaryComponents(solution);

        int addedCount = solution.Components.Count - initialCount;
        _logger.LogInformation("[PAC] Enriched solution with {Added} new components (total: {Total})", addedCount, solution.Components.Count);
        var typeSummary = solution.Components
            .GroupBy(c => c.Type)
            .OrderByDescending(g => g.Count())
            .Select(g => $"{g.Key}={g.Count()}");
        _logger.LogInformation("[PAC] Component type summary: {Summary}", string.Join(", ", typeSummary));
    }

    private bool TryEnrichWithCSharpMirror(string dir, ParsedSolution solution)
    {
        try
        {
            var mirror = new DataverseMirrorParser(dir);
            var result = mirror.ParseAll();

            var existing = solution.Components
                .Select(c => $"{c.Type}|{c.Name}".ToLowerInvariant())
                .ToHashSet();

            int added = 0;

            foreach (var form in result.Artifacts.Forms)
                if (AddComponentIfMissing(solution, existing, GetVal(form, "name"), "form", $"Form: {GetVal(form, "name")}", form)) added++;
            foreach (var view in result.Artifacts.Views)
                if (AddComponentIfMissing(solution, existing, GetVal(view, "name"), "view", $"View: {GetVal(view, "name")}", view)) added++;
            foreach (var dash in result.Artifacts.Dashboards)
                if (AddComponentIfMissing(solution, existing, GetVal(dash, "name"), "dashboard", $"Dashboard: {GetVal(dash, "name")}", dash)) added++;
            foreach (var app in result.Artifacts.ModelDrivenApps)
                if (AddComponentIfMissing(solution, existing, GetVal(app, "display_name", "unique_name"), "model_driven_app", $"Model-driven App: {GetVal(app, "display_name", "unique_name")}", app)) added++;
            foreach (var app in result.Artifacts.CanvasApps)
                if (AddComponentIfMissing(solution, existing, GetVal(app, "app_name", "name"), "canvas_app", $"Canvas App: {GetVal(app, "app_name", "name")}", app)) added++;
            foreach (var bot in result.Artifacts.Bots)
                if (AddComponentIfMissing(solution, existing, GetVal(bot, "display_name", "name"), "bot", $"Copilot Bot: {GetVal(bot, "display_name", "name")}", bot)) added++;
            foreach (var bc in result.Artifacts.BotComponents)
            {
                var bt = GetVal(bc, "type");
                var mapped = bt == "topic" ? "bot_topic" : bt == "gpt" ? "bot_gpt" : "bot_component";
                if (AddComponentIfMissing(solution, existing, GetVal(bc, "topic_name", "name"), mapped, $"Copilot {bt}: {GetVal(bc, "topic_name", "name")}", bc)) added++;
            }
            foreach (var br in result.Artifacts.BusinessRules)
                if (AddComponentIfMissing(solution, existing, GetVal(br, "name"), "business_rule", $"Business Rule: {GetVal(br, "name")}", br)) added++;
            foreach (var wr in result.Artifacts.WebResources)
                if (AddComponentIfMissing(solution, existing, GetVal(wr, "name"), "webresource", $"Web Resource: {GetVal(wr, "name")}", wr)) added++;
            foreach (var a in result.Artifacts.Assets)
                if (AddComponentIfMissing(solution, existing, GetVal(a, "name"), "asset", $"Asset: {GetVal(a, "name")}", a)) added++;

            foreach (var dv in result.Artifacts.DvSearches)
            {
                var name = GetVal(dv, "name");
                if (AddComponentIfMissing(solution, existing, name, "knowledge_source", $"Knowledge Source: {name}", dv)) added++;

                if (dv.TryGetValue("knowledge_sources", out var ksObj) && ksObj is List<Dictionary<string, object>> ksList)
                {
                    foreach (var ks in ksList)
                    {
                        var itemName = GetVal(ks, "display_name", "name");
                        var url = GetVal(ks, "web_url", "site_url");
                        var desc = string.IsNullOrWhiteSpace(url) ? $"Knowledge Source Item: {itemName}" : $"Knowledge Source Item: {itemName} ({url})";
                        if (AddComponentIfMissing(solution, existing, itemName, "knowledge_source_item", desc, ks)) added++;
                    }
                }
            }

            foreach (var se in result.Artifacts.DvSearchEntities)
            {
                var logical = GetVal(se, "entity_logical_name", "name");
                var name = GetVal(se, "name", "entity_logical_name");
                if (AddComponentIfMissing(solution, existing, logical, "search_entity", $"Dataverse Search Entity: {name} ({logical})", se)) added++;
            }

            foreach (var flow in result.Automation.CloudFlows)
            {
                var flowName = GetVal(flow, "display_name", "flow_id");
                if (AddComponentIfMissing(solution, existing, flowName, "cloud_flow", $"Cloud Flow: {flowName}", flow)) added++;
            }
            foreach (var wf in result.Automation.ClassicWorkflows)
                if (AddComponentIfMissing(solution, existing, GetVal(wf, "name"), "workflow", $"Workflow: {GetVal(wf, "name")}", wf)) added++;
            foreach (var ps in result.Automation.PluginSteps)
                if (AddComponentIfMissing(solution, existing, GetVal(ps, "name"), "plugin_step", $"Plugin Step: {GetVal(ps, "name")}", ps)) added++;
            foreach (var pa in result.Automation.PluginAssemblies)
                if (AddComponentIfMissing(solution, existing, GetVal(pa, "name"), "plugin_assembly", $"Plugin Assembly: {GetVal(pa, "name")}", pa)) added++;
            foreach (var cr in result.Automation.ConnectionReferences)
                if (AddComponentIfMissing(solution, existing, GetVal(cr, "name"), "connection_reference", $"Connection Reference: {GetVal(cr, "display_name", "name")}", cr)) added++;
            foreach (var ev in result.Automation.EnvironmentVariables)
                if (AddComponentIfMissing(solution, existing, GetVal(ev, "name"), "environment_variable", $"Env Variable: {GetVal(ev, "display_name", "name")}", ev)) added++;

            foreach (var role in result.Security.Roles)
                if (AddComponentIfMissing(solution, existing, GetVal(role, "name"), "security_role", $"Security Role: {GetVal(role, "name")}", role)) added++;

            foreach (var link in result.Dependencies.Links)
            {
                var source = GetVal(link, "source");
                var target = GetVal(link, "target");
                var relation = GetVal(link, "relationship");
                var name = $"{source}->{target}";
                if (AddComponentIfMissing(solution, existing, name, "dependency_link", $"Dependency: {source} {relation} {target}", link)) added++;
            }

            _logger.LogInformation("[PAC] C# mirror parser produced {Count} mapped components", added);
            return true;
        }
        catch (Exception ex)
        {
            _logger.LogWarning("[PAC] C# mirror parser failed: {Msg}", ex.Message);
            return false;
        }
    }

    private static string GetVal(Dictionary<string, object> d, string primary, string? fallback = null)
    {
        if (d.TryGetValue(primary, out var v) && v != null && !string.IsNullOrWhiteSpace(v.ToString()))
            return v.ToString()!;
        if (!string.IsNullOrWhiteSpace(fallback) && d.TryGetValue(fallback!, out var f) && f != null)
            return f.ToString() ?? "";
        return "";
    }

    private void TryEnrichWithPythonParity(string dir, ParsedSolution solution)
    {
        try
        {
            var ragBackendDir = Path.GetFullPath(Path.Combine(Directory.GetCurrentDirectory(), "..", "rag_backend"));
            if (!Directory.Exists(ragBackendDir))
            {
                _logger.LogDebug("[PAC] Python parity skipped: rag_backend directory not found at {Dir}", ragBackendDir);
                return;
            }

            // Reuse Python DataverseParser.parse_all for schema-level parity.
            const string script = @"
import json, sys
extract_dir = sys.argv[1]
rag_backend_dir = sys.argv[2]
sys.path.insert(0, rag_backend_dir)
from pac_parser import DataverseParser
result = DataverseParser(extract_dir, verbose=False).parse_all()
print(json.dumps(result))
";

            var python = RunProcess("python3", new[] { "-c", script, dir, ragBackendDir }, timeoutSeconds: 120);
            if (python.ExitCode != 0 || string.IsNullOrWhiteSpace(python.Output))
            {
                python = RunProcess("python", new[] { "-c", script, dir, ragBackendDir }, timeoutSeconds: 120);
            }

            if (python.ExitCode != 0 || string.IsNullOrWhiteSpace(python.Output))
            {
                _logger.LogDebug("[PAC] Python parity skipped: parser command failed");
                return;
            }

            using var doc = JsonDocument.Parse(python.Output);
            ApplyPythonParityResult(doc.RootElement, solution);
        }
        catch (Exception ex)
        {
            _logger.LogDebug("[PAC] Python parity skipped: {Msg}", ex.Message);
        }
    }

    private void ApplyPythonParityResult(JsonElement root, ParsedSolution solution)
    {
        var existing = solution.Components
            .Select(c => $"{c.Type}|{c.Name}".ToLowerInvariant())
            .ToHashSet();

        int added = 0;

        // artifacts
        var artifacts = TryGetProperty(root, "artifacts");
        added += AddPythonArrayComponents(artifacts, "forms", "form", "display_name", "name", solution, existing, "Form");
        added += AddPythonArrayComponents(artifacts, "views", "view", "name", "view_id", solution, existing, "View");
        added += AddPythonArrayComponents(artifacts, "dashboards", "dashboard", "name", "form_id", solution, existing, "Dashboard");
        added += AddPythonArrayComponents(artifacts, "model_driven_apps", "model_driven_app", "display_name", "unique_name", solution, existing, "Model-driven App");
        added += AddPythonArrayComponents(artifacts, "canvas_apps", "canvas_app", "app_name", "name", solution, existing, "Canvas App");
        added += AddPythonArrayComponents(artifacts, "bots", "bot", "display_name", "name", solution, existing, "Copilot Bot");
        added += AddPythonArrayComponents(artifacts, "business_rules", "business_rule", "name", "id", solution, existing, "Business Rule");
        added += AddPythonArrayComponents(artifacts, "web_resources", "webresource", "name", "path", solution, existing, "Web Resource");
        added += AddPythonArrayComponents(artifacts, "assets", "asset", "name", solution, existing, "Asset");
        added += AddPythonArrayComponents(artifacts, "site_maps", "sitemap", "name", solution, existing, "Site Map");

        var botComponents = TryGetProperty(artifacts, "bot_components");
        if (botComponents.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in botComponents.EnumerateArray())
            {
                var rawType = GetJsonStringFlexible(item, "type") ?? "component";
                var compType = rawType switch
                {
                    "topic" => "bot_topic",
                    "gpt" => "bot_gpt",
                    "file" => "bot_component_file",
                    _ => "bot_component"
                };
                var name = GetJsonStringFlexible(item, "topic_name")
                           ?? GetJsonStringFlexible(item, "name")
                           ?? "unknown";
                if (AddComponentIfMissing(solution, existing, name, compType, $"Copilot {rawType}: {name}", JsonElementToMetadata(item)))
                    added++;
            }
        }

        var dvSearches = TryGetProperty(artifacts, "dv_searches");
        if (dvSearches.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in dvSearches.EnumerateArray())
            {
                var name = GetJsonStringFlexible(item, "name") ?? "unknown_search";
                if (AddComponentIfMissing(solution, existing, name, "knowledge_source", $"Knowledge Source: {name}", JsonElementToMetadata(item)))
                    added++;

                var knowledgeSources = TryGetProperty(item, "knowledge_sources");
                if (knowledgeSources.ValueKind == JsonValueKind.Array)
                {
                    foreach (var ks in knowledgeSources.EnumerateArray())
                    {
                        var itemName = GetJsonStringFlexible(ks, "display_name") ?? name;
                        var webUrl = GetJsonStringFlexible(ks, "web_url") ?? GetJsonStringFlexible(TryGetProperty(ks, "sharepoint"), "site_url") ?? "";
                        var desc = string.IsNullOrWhiteSpace(webUrl)
                            ? $"Knowledge Source Item: {itemName}"
                            : $"Knowledge Source Item: {itemName} ({webUrl})";
                        if (AddComponentIfMissing(solution, existing, itemName, "knowledge_source_item", desc, JsonElementToMetadata(ks)))
                            added++;
                    }
                }
            }
        }

        var dvSearchEntities = TryGetProperty(artifacts, "dv_search_entities");
        if (dvSearchEntities.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in dvSearchEntities.EnumerateArray())
            {
                var logicalName = GetJsonStringFlexible(item, "entity_logical_name")
                                  ?? GetJsonStringFlexible(item, "name")
                                  ?? "unknown_search_entity";
                var displayName = GetJsonStringFlexible(item, "name") ?? logicalName;
                if (AddComponentIfMissing(solution, existing, logicalName, "search_entity",
                    $"Dataverse Search Entity: {displayName} ({logicalName})", JsonElementToMetadata(item)))
                {
                    added++;
                }
            }
        }

        // automation
        var automation = TryGetProperty(root, "automation");
        var cloudFlows = TryGetProperty(automation, "cloud_flows");
        if (cloudFlows.ValueKind == JsonValueKind.Array)
        {
            foreach (var flow in cloudFlows.EnumerateArray())
            {
                var flowName = GetJsonStringFlexible(flow, "display_name")
                               ?? GetJsonStringFlexible(flow, "flow_id")
                               ?? "unknown_flow";
                if (AddComponentIfMissing(solution, existing, flowName, "cloud_flow", $"Cloud Flow: {flowName}", JsonElementToMetadata(flow)))
                    added++;

                var tables = TryGetProperty(flow, "dataverse_tables");
                if (tables.ValueKind == JsonValueKind.Array)
                {
                    foreach (var t in tables.EnumerateArray())
                    {
                        var table = GetJsonStringFlexible(t, "table");
                        if (string.IsNullOrWhiteSpace(table)) continue;
                        if (AddComponentIfMissing(solution, existing, $"{flowName}:{table}", "flow_dataverse_table",
                            $"Flow '{flowName}' uses Dataverse table '{table}'", JsonElementToMetadata(t)))
                            added++;
                    }
                }
            }
        }

        added += AddPythonArrayComponents(automation, "classic_workflows", "workflow", "name", "file", solution, existing, "Workflow");
        added += AddPythonArrayComponents(automation, "plugin_steps", "plugin_step", "name", "message", solution, existing, "Plugin Step");
        added += AddPythonArrayComponents(automation, "plugin_assemblies", "plugin_assembly", "name", solution, existing, "Plugin Assembly");
        added += AddPythonArrayComponents(automation, "connection_references", "connection_reference", "display_name", "name", solution, existing, "Connection Reference");
        added += AddPythonArrayComponents(automation, "environment_variables", "environment_variable", "name", "display_name", solution, existing, "Environment Variable");

        // security
        var security = TryGetProperty(root, "security");
        added += AddPythonArrayComponents(security, "roles", "security_role", "name", "role_id", solution, existing, "Security Role");

        // dependencies
        var dependencies = TryGetProperty(root, "dependencies");
        var links = TryGetProperty(dependencies, "links");
        if (links.ValueKind == JsonValueKind.Array)
        {
            foreach (var link in links.EnumerateArray())
            {
                var source = GetJsonStringFlexible(link, "source") ?? "unknown";
                var target = GetJsonStringFlexible(link, "target") ?? "unknown";
                var relation = GetJsonStringFlexible(link, "relationship") ?? "depends_on";
                var name = $"{source}->{target}";
                if (AddComponentIfMissing(solution, existing, name, "dependency_link",
                    $"Dependency: {source} {relation} {target}", JsonElementToMetadata(link)))
                {
                    added++;
                }
            }
        }

        if (added > 0)
            _logger.LogInformation("[PAC] Python parity enrichment added {Count} components", added);
    }

    private int AddPythonArrayComponents(
        JsonElement parent,
        string arrayName,
        string type,
        string primaryNameKey,
        string? fallbackNameKey,
        ParsedSolution solution,
        HashSet<string> existing,
        string label)
    {
        var count = 0;
        var arr = TryGetProperty(parent, arrayName);
        if (arr.ValueKind != JsonValueKind.Array)
            return 0;

        foreach (var item in arr.EnumerateArray())
        {
            var name = GetJsonStringFlexible(item, primaryNameKey)
                       ?? (fallbackNameKey != null ? GetJsonStringFlexible(item, fallbackNameKey) : null)
                       ?? "unknown";
            if (AddComponentIfMissing(solution, existing, name, type, $"{label}: {name}", JsonElementToMetadata(item)))
                count++;
        }
        return count;
    }

    private int AddPythonArrayComponents(
        JsonElement parent,
        string arrayName,
        string type,
        string primaryNameKey,
        ParsedSolution solution,
        HashSet<string> existing,
        string label) =>
        AddPythonArrayComponents(parent, arrayName, type, primaryNameKey, null, solution, existing, label);

    private static bool AddComponentIfMissing(
        ParsedSolution solution,
        HashSet<string> existing,
        string name,
        string type,
        string description,
        Dictionary<string, object>? metadata = null)
    {
        var key = $"{type}|{name}".ToLowerInvariant();
        if (existing.Contains(key))
            return false;

        solution.Components.Add(new SolutionComponent
        {
            Name = name,
            Type = type,
            Description = description,
            Metadata = metadata
        });
        existing.Add(key);
        return true;
    }

    private static Dictionary<string, object> JsonElementToMetadata(JsonElement element)
    {
        var meta = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
        if (element.ValueKind != JsonValueKind.Object)
            return meta;

        foreach (var prop in element.EnumerateObject())
        {
            meta[prop.Name] = prop.Value.ValueKind switch
            {
                JsonValueKind.String => prop.Value.GetString() ?? "",
                JsonValueKind.Number => prop.Value.GetRawText(),
                JsonValueKind.True => true,
                JsonValueKind.False => false,
                _ => prop.Value.GetRawText()
            };
        }
        return meta;
    }

    private static string? GetJsonStringFlexible(JsonElement element, string key)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;

        foreach (var prop in element.EnumerateObject())
        {
            if (!prop.Name.Equals(key, StringComparison.OrdinalIgnoreCase))
                continue;
            return prop.Value.ValueKind switch
            {
                JsonValueKind.String => prop.Value.GetString(),
                JsonValueKind.Number => prop.Value.GetRawText(),
                JsonValueKind.True => "true",
                JsonValueKind.False => "false",
                _ => prop.Value.GetRawText()
            };
        }
        return null;
    }

    private void AddDataSourceSummaryComponents(ParsedSolution solution)
    {
        var dataverseItems = solution.Components
            .Where(c => c.Type is "search_entity" or "flow_dataverse_table" or "knowledge_source")
            .ToList();

        var sharePointUrls = solution.Components
            .Where(c => c.Type == "knowledge_source_item")
            .SelectMany(c =>
            {
                var urls = new List<string>();
                if (c.Metadata == null) return urls;
                if (c.Metadata.TryGetValue("web_url", out var wu) && wu is string web && !string.IsNullOrWhiteSpace(web))
                    urls.Add(web);
                if (c.Metadata.TryGetValue("site_url", out var su) && su is string site && !string.IsNullOrWhiteSpace(site))
                    urls.Add(site);
                return urls;
            })
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (dataverseItems.Count > 0)
        {
            solution.Components.Add(new SolutionComponent
            {
                Name = "Dataverse",
                Type = "data_source",
                Description = $"Dataverse detected ({dataverseItems.Count} related component(s))",
                Metadata = new Dictionary<string, object>
                {
                    ["source"] = "summary",
                    ["related_types"] = dataverseItems.Select(c => c.Type).Distinct().ToList()
                }
            });
        }

        if (sharePointUrls.Count > 0)
        {
            solution.Components.Add(new SolutionComponent
            {
                Name = "SharePoint",
                Type = "data_source",
                Description = $"SharePoint detected ({sharePointUrls.Count} URL(s)): {string.Join(", ", sharePointUrls)}",
                Metadata = new Dictionary<string, object>
                {
                    ["source"] = "summary",
                    ["urls"] = sharePointUrls
                }
            });
        }
    }

    private void ScanDirectory(string baseDir, string subDir, string pattern, string type, string displayType, ParsedSolution solution)
    {
        var targetDir = Path.Combine(baseDir, subDir);
        if (Directory.Exists(targetDir))
        {
            var files = Directory.GetFiles(targetDir, pattern, SearchOption.AllDirectories);
            if (files.Length > 0)
            {
                _logger.LogInformation("[PAC] Found {Count} {Type} in {Dir}", files.Length, displayType, subDir);
            }
            foreach (var file in files)
            {
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileNameWithoutExtension(file),
                    Type = type,
                    Description = $"{displayType}: {Path.GetFileName(file)}"
                });
            }
        }
        else
        {
            _logger.LogDebug("[PAC] Directory not found: {Dir}", subDir);
        }
    }

    private void ScanBots(string baseDir, ParsedSolution solution)
    {
        var targetDir = Path.Combine(baseDir, "bots");
        if (!Directory.Exists(targetDir))
        {
            _logger.LogDebug("[PAC] Directory not found: bots");
            return;
        }

        var botFiles = Directory.GetFiles(targetDir, "*.*", SearchOption.AllDirectories)
            .Where(f =>
            {
                var ext = Path.GetExtension(f);
                return ext.Equals(".xml", StringComparison.OrdinalIgnoreCase)
                    || ext.Equals(".json", StringComparison.OrdinalIgnoreCase);
            })
            .GroupBy(Path.GetFileNameWithoutExtension, StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        _logger.LogInformation("[PAC] Found {Count} Copilot Bot in bots", botFiles.Count);

        foreach (var file in botFiles)
        {
            solution.Components.Add(new SolutionComponent
            {
                Name = Path.GetFileNameWithoutExtension(file),
                Type = "bot",
                Description = $"Copilot Bot: {Path.GetFileName(file)}"
            });
        }
    }

    private void ScanWorkflowsDetailed(string baseDir, ParsedSolution solution)
    {
        var workflowsDir = Path.Combine(baseDir, "Workflows");
        if (!Directory.Exists(workflowsDir))
        {
            _logger.LogDebug("[PAC] Directory not found: Workflows");
            return;
        }

        var flowFiles = Directory.GetFiles(workflowsDir, "*.json", SearchOption.AllDirectories)
            .Where(f => !f.EndsWith(".data.xml", StringComparison.OrdinalIgnoreCase))
            .ToList();

        if (flowFiles.Count > 0)
            _logger.LogInformation("[PAC] Found {Count} Cloud Flow in Workflows", flowFiles.Count);

        foreach (var flowFile in flowFiles)
        {
            var flowName = Path.GetFileNameWithoutExtension(flowFile);
            var description = $"Cloud Flow: {Path.GetFileName(flowFile)}";
            var metadata = new Dictionary<string, object>();

            try
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(flowFile));
                var root = doc.RootElement;
                var props = TryGetProperty(root, "properties");
                var def = TryGetProperty(props, "definition");
                if (def.ValueKind == JsonValueKind.Undefined || def.ValueKind == JsonValueKind.Null)
                    def = root;

                var displayName = GetJsonString(props, "displayName");
                if (!string.IsNullOrWhiteSpace(displayName))
                    flowName = displayName;

                var analysis = AnalyzeFlowDefinition(def, props);
                if (analysis.DataverseTables.Count > 0)
                    description += $" | Uses Dataverse: {string.Join(", ", analysis.DataverseTables)}";
                if (analysis.SharePointUrls.Count > 0)
                    description += $" | SharePoint: {string.Join(", ", analysis.SharePointUrls)}";

                metadata["source_file"] = Path.GetRelativePath(baseDir, flowFile);
                metadata["action_count"] = analysis.ActionCount;
                
                // Only add trigger metadata if we have meaningful values
                if (!string.IsNullOrWhiteSpace(analysis.TriggerType) && analysis.TriggerType != "Unknown")
                {
                    metadata["trigger"] = analysis.TriggerType;
                    if (!string.IsNullOrWhiteSpace(analysis.TriggerDescription))
                        metadata["trigger_description"] = analysis.TriggerDescription;
                }
                else
                {
                    _logger.LogDebug("[PAC] Flow {Name} - trigger not detected", flowName);
                }
                
                metadata["dataverse_tables"] = analysis.DataverseTables;
                metadata["sharepoint_urls"] = analysis.SharePointUrls;
                
                // Only add connectors if we found any
                if (analysis.Connectors.Count > 0)
                {
                    metadata["connectors"] = analysis.Connectors;
                    _logger.LogDebug("[PAC] Flow {Name} - found {Count} connectors: {List}", 
                        flowName, analysis.Connectors.Count, string.Join(", ", analysis.Connectors));
                }
                else
                {
                    _logger.LogDebug("[PAC] Flow {Name} - no connectors detected", flowName);
                }
                
                // Generate summary from analysis
                var summaryParts = new List<string>();
                if (analysis.ActionCount > 0)
                    summaryParts.Add($"{analysis.ActionCount} actions");
                if (analysis.DataverseTables.Count > 0)
                    summaryParts.Add($"interacts with Dataverse tables: {string.Join(", ", analysis.DataverseTables)}");
                if (analysis.SharePointUrls.Count > 0)
                    summaryParts.Add($"accesses SharePoint sites");
                if (analysis.Connectors.Count > 0)
                    summaryParts.Add($"uses {analysis.Connectors.Count} connector(s)");
                    
                var summary = summaryParts.Count > 0 
                    ? $"Flow with {string.Join(", ", summaryParts)}"
                    : "Flow automation";
                metadata["summary"] = summary;

                foreach (var table in analysis.DataverseTables)
                {
                    solution.Components.Add(new SolutionComponent
                    {
                        Name = $"{flowName}:{table}",
                        Type = "flow_dataverse_table",
                        Description = $"Flow '{flowName}' uses Dataverse table '{table}'",
                        Metadata = new Dictionary<string, object>
                        {
                            ["flow"] = flowName,
                            ["table"] = table
                        }
                    });
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning("[PAC] Failed to parse flow JSON {File}: {Msg}", flowFile, ex.Message);
            }

            solution.Components.Add(new SolutionComponent
            {
                Name = flowName,
                Type = "cloud_flow",
                Description = description,
                Metadata = metadata
            });
        }
    }

    private void ScanConnectionReferences(string baseDir, ParsedSolution solution)
    {
        var connRefDir = Path.Combine(baseDir, "ConnectionReferences");
        if (!Directory.Exists(connRefDir))
        {
            _logger.LogDebug("[PAC] Directory not found: ConnectionReferences");
            return;
        }

        var connDirs = Directory.GetDirectories(connRefDir);
        if (connDirs.Length > 0)
            _logger.LogInformation("[PAC] Found {Count} connection references in ConnectionReferences", connDirs.Length);

        foreach (var connDir in connDirs)
        {
            var name = Path.GetFileName(connDir);
            var displayName = name;
            var connectorId = string.Empty;

            foreach (var file in Directory.GetFiles(connDir, "*.*", SearchOption.AllDirectories))
            {
                if (file.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(File.ReadAllText(file));
                        var root = doc.RootElement;
                        displayName = GetJsonString(root, "connectionreferencedisplayname")
                                      ?? GetJsonString(root, "displayName")
                                      ?? displayName;
                        connectorId = GetJsonString(root, "connectorid")
                                      ?? GetJsonString(root, "connectorId")
                                      ?? connectorId;
                    }
                    catch { }
                }
                else if (file.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        var doc = XDocument.Load(file);
                        displayName = FindElementIgnoreCase(doc.Root, "connectionreferencedisplayname") ?? displayName;
                        connectorId = FindElementIgnoreCase(doc.Root, "connectorid") ?? connectorId;
                    }
                    catch { }
                }
            }

            solution.Components.Add(new SolutionComponent
            {
                Name = name,
                Type = "connection_reference",
                Description = string.IsNullOrWhiteSpace(connectorId)
                    ? $"Connection Reference: {displayName}"
                    : $"Connection Reference: {displayName} ({connectorId})",
                Metadata = new Dictionary<string, object>
                {
                    ["display_name"] = displayName,
                    ["connector_id"] = connectorId
                }
            });
        }
    }

    private void ScanEnvironmentVariables(string baseDir, ParsedSolution solution)
    {
        var envVarDirCandidates = new[]
        {
            Path.Combine(baseDir, "environmentvariabledefinitions"),
            Path.Combine(baseDir, "EnvironmentVariableDefinitions"),
            Path.Combine(baseDir, "EnvironmentVariables")
        };

        var envVarDir = envVarDirCandidates.FirstOrDefault(Directory.Exists);
        if (envVarDir == null)
        {
            _logger.LogDebug("[PAC] Environment variable directory not found");
            return;
        }

        var envDirs = Directory.GetDirectories(envVarDir);
        _logger.LogInformation("[PAC] Found {Count} environment variables in {Dir}", envDirs.Length, Path.GetFileName(envVarDir));

        foreach (var envDir in envDirs)
        {
            var name = Path.GetFileName(envDir);
            var displayName = "";
            var type = "";
            var defaultValue = "";

            foreach (var file in Directory.GetFiles(envDir, "*.*", SearchOption.AllDirectories))
            {
                if (file.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(File.ReadAllText(file));
                        var root = doc.RootElement;
                        name = GetJsonString(root, "schemaname") ?? GetJsonString(root, "schemaName") ?? name;
                        displayName = GetJsonString(root, "displayname") ?? GetJsonString(root, "displayName") ?? displayName;
                        type = GetJsonString(root, "type") ?? type;
                        defaultValue = GetJsonString(root, "defaultvalue") ?? GetJsonString(root, "defaultValue") ?? defaultValue;
                    }
                    catch { }
                }
                else if (file.EndsWith(".xml", StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        var doc = XDocument.Load(file);
                        name = FindElementIgnoreCase(doc.Root, "schemaname") ?? name;
                        displayName = FindElementIgnoreCase(doc.Root, "displayname") ?? displayName;
                        type = FindElementIgnoreCase(doc.Root, "type") ?? type;
                        defaultValue = FindElementIgnoreCase(doc.Root, "defaultvalue") ?? defaultValue;
                    }
                    catch { }
                }
            }

            solution.Components.Add(new SolutionComponent
            {
                Name = name,
                Type = "environment_variable",
                Description = $"Env Variable: {(string.IsNullOrWhiteSpace(displayName) ? name : displayName)}",
                Metadata = new Dictionary<string, object>
                {
                    ["schema_name"] = name,
                    ["display_name"] = displayName,
                    ["type"] = type,
                    ["default_value"] = defaultValue
                }
            });
        }
    }

    private void ScanKnowledgeSources(string baseDir, string subDir, ParsedSolution solution)
    {
        var targetDir = Path.Combine(baseDir, subDir);
        if (Directory.Exists(targetDir))
        {
            var searchDirs = Directory.GetDirectories(targetDir);
            _logger.LogInformation("[PAC] Scanning {Count} knowledge source directories in {Dir}", searchDirs.Length, subDir);
            
            foreach (var searchDir in searchDirs)
            {
                var xmlFile = Path.Combine(searchDir, "dvtablesearch.xml");
                if (File.Exists(xmlFile))
                {
                    try
                    {
                        var doc = XDocument.Load(xmlFile);
                        var root = doc.Root;
                        var name = FindElementIgnoreCase(root, "name") ?? Path.GetFileName(searchDir);
                        var searchType = FindElementIgnoreCase(root, "searchtype");
                        var connectionReference = FindElementIgnoreCase(root, "connectionreferencelogicalname");
                        var knowledgeConfig = FindElementIgnoreCase(root, "knowledgeconfig");
                        var knowledgeSources = ParseKnowledgeSourcesFromConfig(knowledgeConfig);
                        var sharePointUrls = knowledgeSources
                            .Select(k =>
                            {
                                var webUrl = k.TryGetValue("web_url", out var wu) ? wu?.ToString() : null;
                                if (!string.IsNullOrWhiteSpace(webUrl)) return webUrl;
                                var siteUrl = k.TryGetValue("site_url", out var su) ? su?.ToString() : null;
                                return siteUrl;
                            })
                            .Where(url => !string.IsNullOrWhiteSpace(url))
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToList();

                        var description = sharePointUrls.Count > 0
                            ? $"Knowledge Source: {name} ({sharePointUrls.Count} URL(s): {string.Join(", ", sharePointUrls)})"
                            : $"Knowledge Source: {name} (Dataverse Search)";
                        
                        solution.Components.Add(new SolutionComponent
                        {
                            Name = name,
                            Type = "knowledge_source",
                            Description = description,
                            Metadata = new Dictionary<string, object>
                            {
                                ["search_type"] = searchType ?? "",
                                ["connection_reference"] = connectionReference ?? "",
                                ["knowledge_source_count"] = knowledgeSources.Count,
                                ["sharepoint_urls"] = sharePointUrls,
                                ["knowledge_sources"] = knowledgeSources
                            }
                        });

                        foreach (var source in knowledgeSources)
                        {
                            var sourceName = source.TryGetValue("display_name", out var dn) && !string.IsNullOrWhiteSpace(dn?.ToString())
                                ? dn!.ToString()!
                                : name;
                            var webUrl = source.TryGetValue("web_url", out var wu) ? wu?.ToString() ?? "" : "";
                            var siteUrl = source.TryGetValue("site_url", out var su) ? su?.ToString() ?? "" : "";
                            var resolvedUrl = !string.IsNullOrWhiteSpace(webUrl) ? webUrl : siteUrl;
                            var kind = source.TryGetValue("type", out var t) ? t?.ToString() ?? "" : "";

                            solution.Components.Add(new SolutionComponent
                            {
                                Name = sourceName,
                                Type = "knowledge_source_item",
                                Description = string.IsNullOrWhiteSpace(resolvedUrl)
                                    ? $"Knowledge Source Item: {sourceName}"
                                    : $"Knowledge Source Item: {sourceName} ({resolvedUrl})",
                                Metadata = new Dictionary<string, object>
                                {
                                    ["knowledge_source"] = name,
                                    ["type"] = kind,
                                    ["web_url"] = webUrl,
                                    ["site_url"] = siteUrl,
                                    ["site_id"] = source.TryGetValue("site_id", out var sid) ? sid?.ToString() ?? "" : "",
                                    ["web_id"] = source.TryGetValue("web_id", out var wid) ? wid?.ToString() ?? "" : "",
                                    ["list_id"] = source.TryGetValue("list_id", out var lid) ? lid?.ToString() ?? "" : ""
                                }
                            });
                        }
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning("[PAC] Failed to parse knowledge source {File}: {Msg}", xmlFile, ex.Message);
                        solution.Components.Add(new SolutionComponent
                        {
                            Name = Path.GetFileName(searchDir),
                            Type = "knowledge_source",
                            Description = "Knowledge Source (Dataverse Search)"
                        });
                    }
                }
                else
                {
                    // No dvtablesearch.xml, but still add the directory as a component
                    solution.Components.Add(new SolutionComponent
                    {
                        Name = Path.GetFileName(searchDir),
                        Type = "knowledge_source",
                        Description = $"Knowledge Source: {Path.GetFileName(searchDir)}"
                    });
                }
            }
        }
        else
        {
            _logger.LogDebug("[PAC] Knowledge source directory not found: {Dir}", subDir);
        }
    }

    private void ScanDataverseSearchEntities(string baseDir, ParsedSolution solution)
    {
        var searchEntitiesDir = Path.Combine(baseDir, "dvtablesearchentities");
        if (!Directory.Exists(searchEntitiesDir))
        {
            _logger.LogDebug("[PAC] Dataverse search entities directory not found: dvtablesearchentities");
            return;
        }

        var entityDirs = Directory.GetDirectories(searchEntitiesDir);
        _logger.LogInformation("[PAC] Found {Count} entities in dvtablesearchentities", entityDirs.Length);

        foreach (var entityDir in entityDirs)
        {
            var xmlFile = Path.Combine(entityDir, "dvtablesearchentity.xml");
            if (!File.Exists(xmlFile))
            {
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileName(entityDir),
                    Type = "search_entity",
                    Description = $"Dataverse Search Entity: {Path.GetFileName(entityDir)}"
                });
                continue;
            }

            try
            {
                var doc = XDocument.Load(xmlFile);
                var root = doc.Root;
                var logicalName = FindElementIgnoreCase(root, "entitylogicalname") ?? Path.GetFileName(entityDir);
                var name = FindElementIgnoreCase(root, "name") ?? logicalName;
                var searchId = FindElementIgnoreCase(root, "dvtablesearchid");

                solution.Components.Add(new SolutionComponent
                {
                    Name = logicalName,
                    Type = "search_entity",
                    Description = $"Dataverse Search Entity: {name} ({logicalName})",
                    Metadata = new Dictionary<string, object>
                    {
                        ["name"] = name,
                        ["entity_logical_name"] = logicalName,
                        ["dvtablesearch_id"] = searchId ?? ""
                    }
                });
            }
            catch (Exception ex)
            {
                _logger.LogWarning("[PAC] Failed to parse Dataverse search entity {File}: {Msg}", xmlFile, ex.Message);
                solution.Components.Add(new SolutionComponent
                {
                    Name = Path.GetFileName(entityDir),
                    Type = "search_entity",
                    Description = $"Dataverse Search Entity: {Path.GetFileName(entityDir)}"
                });
            }
        }
    }

    private static List<Dictionary<string, object>> ParseKnowledgeSourcesFromConfig(string? knowledgeConfig)
    {
        var sources = new List<Dictionary<string, object>>();
        if (string.IsNullOrWhiteSpace(knowledgeConfig))
            return sources;

        try
        {
            using var doc = JsonDocument.Parse(knowledgeConfig);
            if (!doc.RootElement.TryGetProperty("driveItems", out var driveItems) ||
                driveItems.ValueKind != JsonValueKind.Array)
            {
                return sources;
            }

            foreach (var item in driveItems.EnumerateArray())
            {
                var source = new Dictionary<string, object>
                {
                    ["type"] = GetJsonProperty(item, "$kind"),
                    ["display_name"] = GetJsonProperty(item, "displayName"),
                    ["web_url"] = GetJsonProperty(item, "webUrl"),
                    ["drive_id"] = GetJsonProperty(item, "driveId"),
                    ["item_id"] = GetJsonProperty(item, "itemId")
                };
                if (item.TryGetProperty("sharepointIds", out var sharepointIds))
                {
                    source["site_url"] = GetJsonProperty(sharepointIds, "siteUrl");
                    source["site_id"] = GetJsonProperty(sharepointIds, "siteId");
                    source["web_id"] = GetJsonProperty(sharepointIds, "webId");
                    source["list_id"] = GetJsonProperty(sharepointIds, "listId");
                }
                sources.Add(source);
            }
        }
        catch
        {
            // Best effort: keep parsing resilient.
        }

        return sources;
    }

    private static string GetJsonProperty(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(propertyName, out var property))
            return property.GetString() ?? string.Empty;
        return string.Empty;
    }

    private static string? GetJsonString(JsonElement element, string propertyName)
    {
        if (element.ValueKind != JsonValueKind.Object)
            return null;
        if (!element.TryGetProperty(propertyName, out var value))
            return null;
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            _ => value.GetRawText()
        };
    }

    private static JsonElement TryGetProperty(JsonElement element, string propertyName)
    {
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(propertyName, out var value))
            return value;
        return default;
    }

    private static FlowScanResult AnalyzeFlowDefinition(JsonElement definition, JsonElement properties)
    {
        var result = new FlowScanResult();

        if (properties.ValueKind == JsonValueKind.Object && properties.TryGetProperty("connectionReferences", out var refs)
            && refs.ValueKind == JsonValueKind.Object)
        {
            foreach (var conn in refs.EnumerateObject())
            {
                var displayName = GetJsonString(conn.Value, "displayName");
                var id = GetJsonString(conn.Value, "id");
                if (!string.IsNullOrWhiteSpace(displayName))
                    result.Connectors.Add(displayName!);
                else if (!string.IsNullOrWhiteSpace(id))
                    result.Connectors.Add(id!);
            }
        }

        if (definition.ValueKind != JsonValueKind.Object)
            return result;

        if (definition.TryGetProperty("triggers", out var triggers) && triggers.ValueKind == JsonValueKind.Object)
        {
            foreach (var trigger in triggers.EnumerateObject())
            {
                var triggerName = trigger.Name;
                var inputs = TryGetProperty(trigger.Value, "inputs");
                var host = TryGetProperty(inputs, "host");
                var parameters = TryGetProperty(inputs, "parameters");
                var type = GetJsonString(trigger.Value, "type") ?? "unknown";

                // Extract trigger type description
                var apiId = GetJsonString(host, "apiId") ?? "";
                if (apiId.Contains("manual", StringComparison.OrdinalIgnoreCase))
                    result.TriggerType = "Manual";
                else if (apiId.Contains("powerapps", StringComparison.OrdinalIgnoreCase))
                    result.TriggerType = "PowerApps";
                else if (apiId.Contains("recurrence", StringComparison.OrdinalIgnoreCase) || type.Contains("recurrence", StringComparison.OrdinalIgnoreCase))
                    result.TriggerType = "Schedule/Recurrence";
                else if (apiId.Contains("shared_commondataserviceforapps", StringComparison.OrdinalIgnoreCase))
                    result.TriggerType = "Dataverse (When a row is added/modified/deleted)";
                else if (apiId.Contains("shared_sharepointonline", StringComparison.OrdinalIgnoreCase))
                    result.TriggerType = "SharePoint (When an item is created/modified)";
                else if (apiId.Contains("http", StringComparison.OrdinalIgnoreCase))
                    result.TriggerType = "HTTP Request";
                else if (!string.IsNullOrWhiteSpace(apiId))
                    result.TriggerType = $"Connector: {apiId.Split('/').Last()}";
                else
                    result.TriggerType = $"Type: {type}";

                result.TriggerDescription = triggerName;

                if (apiId.Contains("shared_commondataserviceforapps", StringComparison.OrdinalIgnoreCase))
                {
                    var table = GetJsonString(parameters, "subscriptionRequest/entityname")
                        ?? GetJsonString(parameters, "entityName");
                    if (!string.IsNullOrWhiteSpace(table))
                    {
                        result.DataverseTables.Add(table!);
                        if (string.IsNullOrWhiteSpace(result.TriggerDescription))
                            result.TriggerDescription = $"When {table} is modified";
                    }
                }
            }
        }

        if (definition.TryGetProperty("actions", out var actions) && actions.ValueKind == JsonValueKind.Object)
            WalkFlowActions(actions, result);

        result.DataverseTables = result.DataverseTables
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        result.SharePointUrls = result.SharePointUrls
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
        result.Connectors = result.Connectors
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        return result;
    }

    private static void WalkFlowActions(JsonElement actions, FlowScanResult result)
    {
        if (actions.ValueKind != JsonValueKind.Object)
            return;

        foreach (var action in actions.EnumerateObject())
        {
            result.ActionCount++;
            var actionValue = action.Value;
            if (actionValue.ValueKind != JsonValueKind.Object)
                continue;

            var inputs = TryGetProperty(actionValue, "inputs");
            var host = TryGetProperty(inputs, "host");
            var parameters = TryGetProperty(inputs, "parameters");
            var apiId = GetJsonString(host, "apiId") ?? "";
            var operationId = GetJsonString(host, "operationId") ?? "";

            if (apiId.Contains("shared_commondataserviceforapps", StringComparison.OrdinalIgnoreCase))
            {
                var table = GetJsonString(parameters, "entityName")
                    ?? GetJsonString(parameters, "table")
                    ?? GetJsonString(parameters, "subscriptionRequest/entityname");
                if (!string.IsNullOrWhiteSpace(table))
                    result.DataverseTables.Add(table!);
            }

            if (apiId.Contains("shared_sharepointonline", StringComparison.OrdinalIgnoreCase))
            {
                var siteUrl = GetJsonString(parameters, "dataset")
                    ?? GetJsonString(parameters, "siteAddress")
                    ?? GetJsonString(parameters, "webUrl");
                if (!string.IsNullOrWhiteSpace(siteUrl))
                    result.SharePointUrls.Add(siteUrl!);
            }

            if (!string.IsNullOrWhiteSpace(operationId))
                result.Connectors.Add(operationId);

            var nestedActions = TryGetProperty(actionValue, "actions");
            WalkFlowActions(nestedActions, result);

            var cases = TryGetProperty(actionValue, "cases");
            if (cases.ValueKind == JsonValueKind.Object)
            {
                foreach (var c in cases.EnumerateObject())
                {
                    var caseActions = TryGetProperty(c.Value, "actions");
                    WalkFlowActions(caseActions, result);
                }
            }

            var elseObj = TryGetProperty(actionValue, "else");
            var elseActions = TryGetProperty(elseObj, "actions");
            WalkFlowActions(elseActions, result);
        }
    }

    private sealed class FlowScanResult
    {
        public List<string> DataverseTables { get; set; } = new();
        public List<string> SharePointUrls { get; set; } = new();
        public List<string> Connectors { get; set; } = new();
        public int ActionCount { get; set; }
        public string TriggerType { get; set; } = "Unknown";
        public string TriggerDescription { get; set; } = "";
    }

    private void EnrichFromZipEntries(ZipArchive zip, ParsedSolution solution)
    {
        // Extract Workflows
        foreach (var entry in zip.Entries.Where(e => e.FullName.Contains("Workflows/") && e.Name.EndsWith(".json")))
        {
            solution.Components.Add(new SolutionComponent
            {
                Name = Path.GetFileNameWithoutExtension(entry.Name),
                Type = "cloud_flow",
                Description = "Cloud Flow from Workflows folder"
            });
        }

        // Extract bot definitions
        foreach (var entry in zip.Entries.Where(e => e.FullName.Contains("bots/") && e.Name.EndsWith(".xml")))
        {
            solution.Components.Add(new SolutionComponent
            {
                Name = Path.GetFileNameWithoutExtension(entry.Name),
                Type = "bot",
                Description = "Copilot Studio Bot"
            });
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────
    private static string MapComponentType(string typeCode) => typeCode switch
    {
        "1"   => "Entity",
        "2"   => "Attribute",
        "29"  => "Workflow",
        "300" => "Canvas App",
        "301" => "Connector",
        "380" => "Bot",
        _     => $"Component_{typeCode}"
    };

    private static void PopulateSharepointRefs(ParsedSolution solution)
    {
        if (solution == null)
            return;

        var refs = new List<SharePointRef>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var component in solution.Components)
        {
            if (component.Metadata == null || component.Metadata.Count == 0)
                continue;
            if (component.Type.Equals("data_source", StringComparison.OrdinalIgnoreCase))
                continue; // Summary component; skip to avoid duplicate references.

            var source = $"{component.Type}:{component.Name}";
            var metadataKind = NormalizeSharePointKind(GetMetadataString(component.Metadata, "type"));

            foreach (var url in ExtractSharePointUrls(component.Metadata))
            {
                var normalizedUrl = url.Trim();
                if (normalizedUrl.Length == 0)
                    continue;

                var kind = metadataKind != "unknown"
                    ? metadataKind
                    : InferSharePointKindFromUrl(normalizedUrl);

                var key = $"{normalizedUrl}|{kind}|{source}";
                if (!seen.Add(key))
                    continue;

                refs.Add(new SharePointRef
                {
                    Url = normalizedUrl,
                    Kind = kind,
                    Source = source
                });
            }
        }

        solution.SharepointRefs = refs;
    }

    private static IEnumerable<string> ExtractSharePointUrls(Dictionary<string, object> metadata)
    {
        var singleKeys = new[] { "web_url", "site_url" };
        foreach (var key in singleKeys)
        {
            var candidate = GetMetadataString(metadata, key);
            if (IsSharePointUrl(candidate))
                yield return candidate!;
        }

        if (metadata.TryGetValue("sharepoint_urls", out var sharePointUrls))
        {
            foreach (var value in ExtractStringValues(sharePointUrls))
            {
                if (IsSharePointUrl(value))
                    yield return value;
            }
        }
    }

    private static string? GetMetadataString(Dictionary<string, object> metadata, string key)
    {
        if (!metadata.TryGetValue(key, out var value) || value == null)
            return null;

        return value switch
        {
            string s => s,
            JsonElement je when je.ValueKind == JsonValueKind.String => je.GetString(),
            JsonElement je when je.ValueKind == JsonValueKind.Number => je.GetRawText(),
            JsonElement je when je.ValueKind == JsonValueKind.True => "true",
            JsonElement je when je.ValueKind == JsonValueKind.False => "false",
            _ => value.ToString()
        };
    }

    private static IEnumerable<string> ExtractStringValues(object value)
    {
        switch (value)
        {
            case string s when !string.IsNullOrWhiteSpace(s):
                var trimmed = s.Trim();
                if (trimmed.StartsWith("[", StringComparison.Ordinal))
                {
                    foreach (var parsed in TryExtractJsonArrayStrings(trimmed))
                        yield return parsed;
                    yield break;
                }
                yield return trimmed;
                yield break;
            case IEnumerable<string> strings:
                foreach (var s in strings.Where(s => !string.IsNullOrWhiteSpace(s)))
                    yield return s;
                yield break;
            case JsonElement je when je.ValueKind == JsonValueKind.Array:
                foreach (var item in je.EnumerateArray())
                {
                    if (item.ValueKind == JsonValueKind.String)
                    {
                        var valueText = item.GetString();
                        if (!string.IsNullOrWhiteSpace(valueText))
                            yield return valueText;
                    }
                }
                yield break;
        }
    }

    private static IReadOnlyList<string> TryExtractJsonArrayStrings(string jsonArrayText)
    {
        var values = new List<string>();
        try
        {
            using var doc = JsonDocument.Parse(jsonArrayText);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
                return values;

            foreach (var item in doc.RootElement.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.String)
                    continue;
                var value = item.GetString();
                if (!string.IsNullOrWhiteSpace(value))
                    values.Add(value);
            }
        }
        catch
        {
            // Keep parser resilient; ignore malformed metadata payloads.
        }

        return values;
    }

    private static bool IsSharePointUrl(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && value.Contains("sharepoint.com", StringComparison.OrdinalIgnoreCase);

    private static string NormalizeSharePointKind(string? rawKind)
    {
        if (string.IsNullOrWhiteSpace(rawKind))
            return "unknown";

        var normalized = rawKind.Trim().ToLowerInvariant();
        if (normalized.Contains("list"))
            return "list";
        if (normalized.Contains("library") || normalized.Contains("drive"))
            return "library";
        if (normalized.Contains("site") || normalized.Contains("web"))
            return "site";
        return "unknown";
    }

    private static string InferSharePointKindFromUrl(string url)
    {
        var lower = url.ToLowerInvariant();
        if (lower.Contains("/lists/"))
            return "list";
        if (lower.Contains("/shared%20documents")
            || lower.Contains("/shared documents")
            || lower.Contains("/forms/"))
            return "library";
        if (lower.Contains("/sites/") || lower.Contains("/teams/"))
            return "site";
        return "unknown";
    }

    private void ParseCustomizationsXml(string dir, ParsedSolution solution)
    {
        // Look for customizations.xml in various possible locations (Python parser checks multiple paths)
        var possiblePaths = new[]
        {
            Path.Combine(dir, "Other", "customizations.xml"),
            Path.Combine(dir, "Other", "Customizations.xml"),
            Path.Combine(dir, "customizations.xml"),
            Path.Combine(dir, "Customizations.xml")
        };

        string? customizationsPath = possiblePaths.FirstOrDefault(File.Exists);
        
        if (customizationsPath == null)
        {
            _logger.LogInformation("[PAC] No customizations.xml found, skipping detailed entity parsing");
            return;
        }

        try
        {
            _logger.LogInformation("[PAC] Parsing customizations.xml from: {Path}", customizationsPath);
            var doc = XDocument.Load(customizationsPath);
            var root = doc.Root;

            if (root == null)
            {
                _logger.LogWarning("[PAC] customizations.xml has no root element");
                return;
            }

            // Find all <Entity> elements (they may be nested at different levels)
            var entities = root.Descendants().Where(e => e.Name.LocalName == "Entity").ToList();
            _logger.LogInformation("[PAC] Found {Count} entities in customizations.xml", entities.Count);

            foreach (var entityElement in entities)
            {
                // Get entity logical name
                var entityName = entityElement.Element("Name")?.Value 
                    ?? entityElement.Descendants("Name").FirstOrDefault()?.Value
                    ?? "UnknownEntity";

                // Count and create components for attributes
                var attributes = entityElement.Descendants()
                    .Where(e => e.Name.LocalName == "attribute")
                    .ToList();
                
                if (attributes.Any())
                {
                    _logger.LogInformation("[PAC]   Entity '{Entity}' has {Count} attributes in customizations.xml", entityName, attributes.Count);
                    
                    foreach (var attr in attributes)
                    {
                        var attrName = attr.Element("LogicalName")?.Value 
                            ?? attr.Element("logicalname")?.Value
                            ?? attr.Descendants("LogicalName").FirstOrDefault()?.Value
                            ?? Guid.NewGuid().ToString("N").Substring(0, 8); // Fallback

                        solution.Components.Add(new SolutionComponent
                        {
                            Name = $"{entityName}.{attrName}",
                            Type = "attribute",
                            Description = $"Field: {attrName} (in {entityName})",
                            Metadata = new Dictionary<string, object> { ["entity"] = entityName, ["source"] = "customizations.xml" }
                        });
                    }
                }

                // Count and create components for forms
                var forms = entityElement.Descendants()
                    .Where(e => e.Name.LocalName == "systemform")
                    .ToList();
                
                if (forms.Any())
                {
                    _logger.LogInformation("[PAC]   Entity '{Entity}' has {Count} forms in customizations.xml", entityName, forms.Count);
                    
                    foreach (var form in forms)
                    {
                        var formName = form.Element("Name")?.Value
                            ?? form.Descendants("Name").FirstOrDefault()?.Value
                            ?? Guid.NewGuid().ToString("N").Substring(0, 8);

                        solution.Components.Add(new SolutionComponent
                        {
                            Name = $"{entityName}_Form_{formName}",
                            Type = "form",
                            Description = $"Form: {formName} ({entityName})",
                            Metadata = new Dictionary<string, object> { ["entity"] = entityName, ["source"] = "customizations.xml" }
                        });
                    }
                }

                // Count and create components for views
                var views = entityElement.Descendants()
                    .Where(e => e.Name.LocalName == "savedquery")
                    .ToList();
                
                if (views.Any())
                {
                    _logger.LogInformation("[PAC]   Entity '{Entity}' has {Count} views in customizations.xml", entityName, views.Count);
                    
                    foreach (var view in views)
                    {
                        var viewName = view.Element("name")?.Value
                            ?? view.Element("Name")?.Value
                            ?? view.Descendants("name").FirstOrDefault()?.Value
                            ?? Guid.NewGuid().ToString("N").Substring(0, 8);

                        solution.Components.Add(new SolutionComponent
                        {
                            Name = $"{entityName}_View_{viewName}",
                            Type = "view",
                            Description = $"View: {viewName} ({entityName})",
                            Metadata = new Dictionary<string, object> { ["entity"] = entityName, ["source"] = "customizations.xml" }
                        });
                    }
                }
            }

            _logger.LogInformation("[PAC] Completed parsing customizations.xml");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[PAC] Error parsing customizations.xml");
        }
    }

    private static string? FindElementIgnoreCase(XElement? root, string elementName)
    {
        if (root == null) return null;
        
        // Try direct descendants first
        var directMatch = root.Elements()
            .FirstOrDefault(e => e.Name.LocalName.Equals(elementName, StringComparison.OrdinalIgnoreCase));
        if (directMatch != null)
            return directMatch.Value;
        
        // Try descendants (recursive)
        var recursiveMatch = root.Descendants()
            .FirstOrDefault(e => e.Name.LocalName.Equals(elementName, StringComparison.OrdinalIgnoreCase));
        return recursiveMatch?.Value;
    }

    private static (int ExitCode, string Output) RunProcess(string exe, string[] args, int timeoutSeconds = 30)
    {
        using var p = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName               = exe,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
                UseShellExecute        = false,
                CreateNoWindow         = true,
            }
        };
        foreach (var arg in args)
            p.StartInfo.ArgumentList.Add(arg);

        p.Start();
        var output = p.StandardOutput.ReadToEnd();
        var error  = p.StandardError.ReadToEnd();
        p.WaitForExit(TimeSpan.FromSeconds(timeoutSeconds));
        // Return combined output so callers can inspect it
        return (p.ExitCode, string.IsNullOrWhiteSpace(output) ? error : output);
    }

    private static void RunProcessChecked(string exe, string[] args, int timeoutSeconds = 30)
    {
        var result = RunProcess(exe, args, timeoutSeconds);
        if (result.ExitCode != 0)
        {
            var argString = string.Join(" ", args);
            throw new InvalidOperationException(
                $"Command failed: {exe} {argString} (exit {result.ExitCode})\n{result.Output}");
        }
    }
}
