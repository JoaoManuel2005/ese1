using System.Text.Json;
using System.Xml.Linq;

namespace RagBackend.Services;

/// <summary>
/// C# mirror of rag_backend/pac_parser.py::DataverseParser.
/// Focuses on parse_all sections used by documentation generation.
/// </summary>
public sealed class DataverseMirrorParser
{
    private readonly string _extractDir;

    public DataverseMirrorParser(string extractDir)
    {
        _extractDir = extractDir;
    }

    public MirrorParseResult ParseAll()
    {
        var customizations = ParseCustomizations();
        var artifacts = ParseArtifacts(customizations);
        var automation = ParseAutomation();
        var security = ParseSecurity();
        var dependencies = BuildDependencies(artifacts, automation);

        return new MirrorParseResult
        {
            Artifacts = artifacts,
            Automation = automation,
            Security = security,
            Dependencies = dependencies
        };
    }

    private static string Text(XElement? root, string name)
    {
        if (root == null) return "";
        var parts = name.Split('/', StringSplitOptions.RemoveEmptyEntries);
        XElement? node = root;
        foreach (var p in parts)
        {
            node = node?.Descendants().FirstOrDefault(e => e.Name.LocalName.Equals(p, StringComparison.OrdinalIgnoreCase));
            if (node == null) return "";
        }
        return node.Value?.Trim() ?? "";
    }

    private CustomizationsData ParseCustomizations()
    {
        var candidates = new[]
        {
            Path.Combine(_extractDir, "Other", "customizations.xml"),
            Path.Combine(_extractDir, "Other", "Customizations.xml"),
            Path.Combine(_extractDir, "customizations.xml"),
            Path.Combine(_extractDir, "Customizations.xml")
        };

        var path = candidates.FirstOrDefault(File.Exists)
                   ?? Directory.GetFiles(_extractDir, "customizations.xml", SearchOption.AllDirectories).FirstOrDefault();

        if (path == null) return new CustomizationsData();

        var doc = XDocument.Load(path);
        var root = doc.Root;
        if (root == null) return new CustomizationsData();

        var entities = root.Descendants().Where(e => e.Name.LocalName.Equals("Entity", StringComparison.OrdinalIgnoreCase)).ToList();

        var entityData = new List<CustomEntity>();
        foreach (var ent in entities)
        {
            var logicalName = ent.Descendants().FirstOrDefault(e => e.Name.LocalName.Equals("Name", StringComparison.OrdinalIgnoreCase))?.Value?.Trim() ?? "";
            if (string.IsNullOrWhiteSpace(logicalName)) continue;

            var forms = ent.Descendants().Where(e => e.Name.LocalName.Equals("systemform", StringComparison.OrdinalIgnoreCase)).ToList();
            var views = ent.Descendants().Where(e => e.Name.LocalName.Equals("savedquery", StringComparison.OrdinalIgnoreCase)).ToList();
            var rules = ent.Descendants().Where(e => e.Name.LocalName.Equals("BusinessRule", StringComparison.OrdinalIgnoreCase)).ToList();

            entityData.Add(new CustomEntity
            {
                LogicalName = logicalName,
                Forms = forms.Select(f => new Dictionary<string, object>
                {
                    ["name"] = Text(f, "name"),
                    ["form_id"] = f.Attribute("id")?.Value ?? "",
                    ["type_code"] = Text(f, "type")
                }).ToList(),
                Views = views.Select(v => new Dictionary<string, object>
                {
                    ["name"] = Text(v, "name"),
                    ["view_id"] = v.Attribute("id")?.Value ?? ""
                }).ToList(),
                BusinessRules = rules.Select(r => new Dictionary<string, object>
                {
                    ["name"] = Text(r, "name"),
                    ["id"] = r.Attribute("id")?.Value ?? ""
                }).ToList()
            });
        }

        var appModules = root.Descendants()
            .Where(e => e.Name.LocalName.Equals("AppModule", StringComparison.OrdinalIgnoreCase))
            .Select(a => new Dictionary<string, object>
            {
                ["unique_name"] = Text(a, "UniqueName"),
                ["display_name"] = Text(a, "Name")
            })
            .ToList();

        return new CustomizationsData
        {
            Entities = entityData,
            AppModules = appModules
        };
    }

    private MirrorArtifacts ParseArtifacts(CustomizationsData customizations)
    {
        var artifacts = new MirrorArtifacts();

        foreach (var ent in customizations.Entities)
        {
            foreach (var form in ent.Forms)
            {
                form["entity"] = ent.LogicalName;
                if ((form.TryGetValue("type_code", out var t) ? t?.ToString() : "") == "0")
                    artifacts.Dashboards.Add(form);
                else
                    artifacts.Forms.Add(form);
            }

            foreach (var view in ent.Views)
            {
                view["entity"] = ent.LogicalName;
                artifacts.Views.Add(view);
            }

            foreach (var br in ent.BusinessRules)
            {
                br["entity"] = ent.LogicalName;
                artifacts.BusinessRules.Add(br);
            }
        }

        artifacts.ModelDrivenApps.AddRange(customizations.AppModules);

        ParseCanvasApps(artifacts.CanvasApps);
        ParseBots(artifacts.Bots, artifacts.BotComponents);
        ParseDvSearches(artifacts.DvSearches, artifacts.DvSearchEntities);
        ParseAssets(artifacts.Assets);
        ParseWebResources(artifacts.WebResources);

        return artifacts;
    }

    private void ParseCanvasApps(List<Dictionary<string, object>> target)
    {
        var dir = Path.Combine(_extractDir, "CanvasApps");
        if (!Directory.Exists(dir)) dir = Path.Combine(_extractDir, "canvasapps");
        if (!Directory.Exists(dir)) return;

        foreach (var file in Directory.GetFiles(dir, "*.*", SearchOption.TopDirectoryOnly))
        {
            var ext = Path.GetExtension(file).ToLowerInvariant();
            if (ext == ".msapp" || ext == ".xml" || ext == ".json")
            {
                target.Add(new Dictionary<string, object>
                {
                    ["name"] = Path.GetFileName(file),
                    ["app_name"] = Path.GetFileNameWithoutExtension(file),
                    ["extension"] = ext
                });
            }
        }
    }

    private void ParseBots(List<Dictionary<string, object>> bots, List<Dictionary<string, object>> botComponents)
    {
        var botsDir = Path.Combine(_extractDir, "bots");
        if (Directory.Exists(botsDir))
        {
            foreach (var item in Directory.GetFileSystemEntries(botsDir))
            {
                var name = Path.GetFileName(item);
                var bot = new Dictionary<string, object> { ["name"] = name, ["display_name"] = Path.GetFileNameWithoutExtension(name) };
                bots.Add(bot);
            }
        }

        var compDir = Path.Combine(_extractDir, "botcomponents");
        if (!Directory.Exists(compDir)) return;

        foreach (var item in Directory.GetFileSystemEntries(compDir))
        {
            var n = Path.GetFileName(item);
            var t = n.Contains(".topic.") ? "topic" : n.Contains(".gpt.") ? "gpt" : "component";
            botComponents.Add(new Dictionary<string, object>
            {
                ["name"] = n,
                ["type"] = t,
                ["topic_name"] = n.Split('.').Last()
            });
        }
    }

    private void ParseDvSearches(List<Dictionary<string, object>> searches, List<Dictionary<string, object>> searchEntities)
    {
        foreach (var dn in new[] { "dvtablesearchs", "dvtablesearches" })
        {
            var dir = Path.Combine(_extractDir, dn);
            if (!Directory.Exists(dir)) continue;

            foreach (var sub in Directory.GetDirectories(dir))
            {
                var xml = Path.Combine(sub, "dvtablesearch.xml");
                if (!File.Exists(xml)) continue;

                var doc = XDocument.Load(xml);
                var root = doc.Root;
                if (root == null) continue;

                var item = new Dictionary<string, object>
                {
                    ["id"] = root.Attribute("dvtablesearchid")?.Value ?? "",
                    ["name"] = Text(root, "name"),
                    ["search_type"] = Text(root, "searchtype"),
                    ["connection_reference"] = Text(root, "connectionreference/connectionreferencelogicalname"),
                    ["knowledge_sources"] = new List<Dictionary<string, object>>()
                };

                var knowledgeConfig = Text(root, "knowledgeconfig");
                if (!string.IsNullOrWhiteSpace(knowledgeConfig))
                {
                    try
                    {
                        using var cfg = JsonDocument.Parse(knowledgeConfig);
                        if (cfg.RootElement.TryGetProperty("driveItems", out var driveItems) && driveItems.ValueKind == JsonValueKind.Array)
                        {
                            var ksList = (List<Dictionary<string, object>>)item["knowledge_sources"];
                            foreach (var d in driveItems.EnumerateArray())
                            {
                                var ks = new Dictionary<string, object>
                                {
                                    ["type"] = d.TryGetProperty("$kind", out var k) ? k.GetString() ?? "" : "",
                                    ["display_name"] = d.TryGetProperty("displayName", out var dn2) ? dn2.GetString() ?? "" : "",
                                    ["web_url"] = d.TryGetProperty("webUrl", out var wu) ? wu.GetString() ?? "" : "",
                                    ["drive_id"] = d.TryGetProperty("driveId", out var di) ? di.GetString() ?? "" : "",
                                    ["item_id"] = d.TryGetProperty("itemId", out var ii) ? ii.GetString() ?? "" : ""
                                };
                                if (d.TryGetProperty("sharepointIds", out var sp))
                                {
                                    ks["site_url"] = sp.TryGetProperty("siteUrl", out var su) ? su.GetString() ?? "" : "";
                                    ks["site_id"] = sp.TryGetProperty("siteId", out var sid) ? sid.GetString() ?? "" : "";
                                    ks["web_id"] = sp.TryGetProperty("webId", out var wid) ? wid.GetString() ?? "" : "";
                                    ks["list_id"] = sp.TryGetProperty("listId", out var lid) ? lid.GetString() ?? "" : "";
                                }
                                ksList.Add(ks);
                            }
                        }
                    }
                    catch
                    {
                        // ignore malformed knowledge config
                    }
                }

                searches.Add(item);
            }
            break;
        }

        var seDir = Path.Combine(_extractDir, "dvtablesearchentities");
        if (!Directory.Exists(seDir)) return;

        foreach (var sub in Directory.GetDirectories(seDir))
        {
            var xml = Path.Combine(sub, "dvtablesearchentity.xml");
            if (!File.Exists(xml)) continue;
            var doc = XDocument.Load(xml);
            var root = doc.Root;
            if (root == null) continue;

            searchEntities.Add(new Dictionary<string, object>
            {
                ["id"] = root.Attribute("dvtablesearchentityid")?.Value ?? "",
                ["dvtablesearch_id"] = Text(root, "dvtablesearch/dvtablesearchid"),
                ["entity_logical_name"] = Text(root, "entitylogicalname"),
                ["name"] = Text(root, "name")
            });
        }
    }

    private void ParseAssets(List<Dictionary<string, object>> assets)
    {
        var dir = Path.Combine(_extractDir, "Assets");
        if (!Directory.Exists(dir)) dir = Path.Combine(_extractDir, "assets");
        if (!Directory.Exists(dir)) return;

        foreach (var file in Directory.GetFiles(dir, "*.*", SearchOption.AllDirectories))
        {
            assets.Add(new Dictionary<string, object>
            {
                ["name"] = Path.GetFileName(file),
                ["extension"] = Path.GetExtension(file).ToLowerInvariant(),
                ["size"] = new FileInfo(file).Length
            });
        }
    }

    private void ParseWebResources(List<Dictionary<string, object>> webResources)
    {
        var dir = Path.Combine(_extractDir, "WebResources");
        if (!Directory.Exists(dir)) return;
        foreach (var file in Directory.GetFiles(dir, "*.*", SearchOption.AllDirectories))
        {
            webResources.Add(new Dictionary<string, object>
            {
                ["name"] = Path.GetFileName(file),
                ["path"] = Path.GetRelativePath(_extractDir, file),
                ["extension"] = Path.GetExtension(file).ToLowerInvariant(),
                ["size"] = new FileInfo(file).Length
            });
        }
    }

    private MirrorAutomation ParseAutomation()
    {
        var automation = new MirrorAutomation();

        var wfDir = Path.Combine(_extractDir, "Workflows");
        if (Directory.Exists(wfDir))
        {
            foreach (var file in Directory.GetFiles(wfDir, "*.*", SearchOption.AllDirectories))
            {
                var ext = Path.GetExtension(file).ToLowerInvariant();
                var lower = file.ToLowerInvariant();
                if (lower.EndsWith(".data.xml")) continue;
                if (ext == ".json")
                {
                    automation.CloudFlows.Add(new Dictionary<string, object>
                    {
                        ["flow_id"] = Path.GetFileNameWithoutExtension(file),
                        ["display_name"] = Path.GetFileNameWithoutExtension(file),
                        ["source_file"] = Path.GetRelativePath(_extractDir, file),
                        ["dataverse_tables"] = new List<Dictionary<string, object>>()
                    });
                }
                else if (ext is ".xml" or ".xaml")
                {
                    automation.ClassicWorkflows.Add(new Dictionary<string, object>
                    {
                        ["name"] = Path.GetFileNameWithoutExtension(file),
                        ["file"] = Path.GetFileName(file)
                    });
                }
            }
        }

        var sdkDir = Path.Combine(_extractDir, "SdkMessageProcessingSteps");
        if (Directory.Exists(sdkDir))
        {
            foreach (var file in Directory.GetFiles(sdkDir, "*.xml", SearchOption.AllDirectories))
            {
                automation.PluginSteps.Add(new Dictionary<string, object>
                {
                    ["name"] = Path.GetFileNameWithoutExtension(file)
                });
            }
        }

        var paDir = Path.Combine(_extractDir, "PluginAssemblies");
        if (Directory.Exists(paDir))
        {
            foreach (var file in Directory.GetFiles(paDir, "*.*", SearchOption.AllDirectories))
            {
                automation.PluginAssemblies.Add(new Dictionary<string, object>
                {
                    ["name"] = Path.GetFileName(file),
                    ["size"] = new FileInfo(file).Length
                });
            }
        }

        var crDir = Path.Combine(_extractDir, "ConnectionReferences");
        if (Directory.Exists(crDir))
        {
            foreach (var file in Directory.GetFiles(crDir, "*.*", SearchOption.AllDirectories))
            {
                automation.ConnectionReferences.Add(new Dictionary<string, object>
                {
                    ["name"] = Path.GetFileNameWithoutExtension(file),
                    ["display_name"] = Path.GetFileNameWithoutExtension(file)
                });
            }
        }

        var evDir = Path.Combine(_extractDir, "environmentvariabledefinitions");
        if (!Directory.Exists(evDir)) evDir = Path.Combine(_extractDir, "EnvironmentVariableDefinitions");
        if (Directory.Exists(evDir))
        {
            foreach (var sub in Directory.GetDirectories(evDir))
            {
                automation.EnvironmentVariables.Add(new Dictionary<string, object>
                {
                    ["name"] = Path.GetFileName(sub),
                    ["display_name"] = Path.GetFileName(sub)
                });
            }
        }

        return automation;
    }

    private MirrorSecurity ParseSecurity()
    {
        var security = new MirrorSecurity();
        var rolesDir = Path.Combine(_extractDir, "Roles");
        if (!Directory.Exists(rolesDir)) return security;

        foreach (var file in Directory.GetFiles(rolesDir, "*.xml", SearchOption.AllDirectories))
        {
            security.Roles.Add(new Dictionary<string, object>
            {
                ["name"] = Path.GetFileNameWithoutExtension(file),
                ["role_id"] = ""
            });
        }
        return security;
    }

    private MirrorDependencies BuildDependencies(MirrorArtifacts artifacts, MirrorAutomation automation)
    {
        var dep = new MirrorDependencies();
        foreach (var flow in automation.CloudFlows)
        {
            var flowName = flow.TryGetValue("display_name", out var n) ? n?.ToString() ?? "unknown" : "unknown";
            if (artifacts.DvSearchEntities.Count > 0)
            {
                foreach (var se in artifacts.DvSearchEntities)
                {
                    var entityLogicalName = se.TryGetValue("entity_logical_name", out var e)
                        ? e?.ToString() ?? ""
                        : "";
                    dep.Links.Add(new Dictionary<string, object>
                    {
                        ["source"] = $"flow:{flowName}",
                        ["source_type"] = "Cloud Flow",
                        ["target"] = $"table:{entityLogicalName}",
                        ["target_type"] = "Table",
                        ["relationship"] = "uses",
                        ["detail"] = ""
                    });
                }
            }
        }
        return dep;
    }

    private sealed class CustomizationsData
    {
        public List<CustomEntity> Entities { get; set; } = new();
        public List<Dictionary<string, object>> AppModules { get; set; } = new();
    }

    private sealed class CustomEntity
    {
        public string LogicalName { get; set; } = "";
        public List<Dictionary<string, object>> Forms { get; set; } = new();
        public List<Dictionary<string, object>> Views { get; set; } = new();
        public List<Dictionary<string, object>> BusinessRules { get; set; } = new();
    }
}

public sealed class MirrorParseResult
{
    public MirrorArtifacts Artifacts { get; set; } = new();
    public MirrorAutomation Automation { get; set; } = new();
    public MirrorSecurity Security { get; set; } = new();
    public MirrorDependencies Dependencies { get; set; } = new();
}

public sealed class MirrorArtifacts
{
    public List<Dictionary<string, object>> Forms { get; set; } = new();
    public List<Dictionary<string, object>> Views { get; set; } = new();
    public List<Dictionary<string, object>> Dashboards { get; set; } = new();
    public List<Dictionary<string, object>> ModelDrivenApps { get; set; } = new();
    public List<Dictionary<string, object>> CanvasApps { get; set; } = new();
    public List<Dictionary<string, object>> Bots { get; set; } = new();
    public List<Dictionary<string, object>> BotComponents { get; set; } = new();
    public List<Dictionary<string, object>> BusinessRules { get; set; } = new();
    public List<Dictionary<string, object>> WebResources { get; set; } = new();
    public List<Dictionary<string, object>> DvSearches { get; set; } = new();
    public List<Dictionary<string, object>> DvSearchEntities { get; set; } = new();
    public List<Dictionary<string, object>> Assets { get; set; } = new();
}

public sealed class MirrorAutomation
{
    public List<Dictionary<string, object>> CloudFlows { get; set; } = new();
    public List<Dictionary<string, object>> ClassicWorkflows { get; set; } = new();
    public List<Dictionary<string, object>> PluginSteps { get; set; } = new();
    public List<Dictionary<string, object>> PluginAssemblies { get; set; } = new();
    public List<Dictionary<string, object>> ConnectionReferences { get; set; } = new();
    public List<Dictionary<string, object>> EnvironmentVariables { get; set; } = new();
}

public sealed class MirrorSecurity
{
    public List<Dictionary<string, object>> Roles { get; set; } = new();
}

public sealed class MirrorDependencies
{
    public List<Dictionary<string, object>> Links { get; set; } = new();
}
