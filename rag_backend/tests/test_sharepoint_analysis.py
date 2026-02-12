import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sharepoint_analyzer import analyze_sharepoint


def _write_env_var_xml(path: Path) -> None:
    xml = """<environmentvariabledefinition>
  <schemaname>spSite</schemaname>
  <displayname>
    <label>SharePoint Site</label>
  </displayname>
  <apipid>shared_sharepointonline</apipid>
  <parameterkey>/dataset</parameterkey>
  <isrequired>1</isrequired>
  <issecret>0</issecret>
  <type>text</type>
  <introducedversion>1.0.0.0</introducedversion>
</environmentvariabledefinition>
"""
    path.write_text(xml, encoding="utf-8")


def _write_flow_json(path: Path) -> None:
    payload = {
        "name": "flow-123",
        "properties": {
            "displayName": "SharePoint Flow",
            "connectionReferences": {
                "shared_sharepointonline": {
                    "id": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline",
                    "displayName": "SharePoint",
                }
            },
            "definition": {
                "triggers": {},
                "actions": {
                    "Get_items": {
                        "type": "OpenApiConnection",
                        "inputs": {
                            "host": {
                                "apiId": "/providers/Microsoft.PowerApps/apis/shared_sharepointonline"
                            }
                        },
                    }
                },
            },
        },
    }
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_envvar_sharepoint_detection(tmp_path: Path):
    env_dir = tmp_path / "environmentvariabledefinitions" / "sp_env"
    env_dir.mkdir(parents=True)
    _write_env_var_xml(env_dir / "environmentvariabledefinition.xml")

    result = {"name": "Test", "version": "1.0.0", "publisher": "pub", "components": []}
    analyze_sharepoint(tmp_path, result)

    sp = result["analysis"]["sharepoint"]
    assert sp["used"] is True
    assert sp["environment_variables"]
    env = next(ev for ev in sp["environment_variables"] if ev.get("apipid") == "shared_sharepointonline")
    assert env.get("schemaname") == "spSite"
    assert env.get("displayname") == "SharePoint Site"


def test_flow_sharepoint_detection(tmp_path: Path):
    wf_dir = tmp_path / "Workflows"
    wf_dir.mkdir(parents=True)
    _write_flow_json(wf_dir / "Flow1.json")

    result = {"name": "Test", "version": "1.0.0", "publisher": "pub", "components": []}
    analyze_sharepoint(tmp_path, result)

    sp = result["analysis"]["sharepoint"]
    assert sp["used"] is True
    assert len(sp["flows"]) == 1
    flow = sp["flows"][0]
    assert flow["uses_sharepoint"] is True
    assert "shared_sharepointonline" in flow["connectors_used"]
    assert "Get_items" in flow["sharepoint_actions_used"]


def test_canvasapp_sharepoint_detection(tmp_path: Path):
    ca_dir = tmp_path / "CanvasApps" / "app1"
    ca_dir.mkdir(parents=True)
    meta = ca_dir / "app1.meta.xml"
    meta.write_text(
        """<CanvasApp>
  <AppSettings>{"dataSources":[{"name":"ReplyList"}]}</AppSettings>
  <ConnectionReferences>{"2e839f98-f3ab-4b67-b7e3-094498abe5d3":{"id":"/providers/microsoft.powerapps/apis/shared_sharepointonline","displayName":"SharePoint","dataSources":[{"name":"ReplyList"}],"dataSets":{"https://example.sharepoint.com/sites/Reply":{"datasetOverride":{"environmentVariableName":"SP_SITE"},"dataSources":{"ReplyList":{"tableName":"deadbeef-dead-beef-dead-beefdeadbeef","tableNameOverride":{"environmentVariableName":"SP_LIST"}}}}}}}</ConnectionReferences>
</CanvasApp>
""",
        encoding="utf-8",
    )

    result = {"name": "Test", "version": "1.0.0", "publisher": "pub", "components": []}
    analyze_sharepoint(tmp_path, result)

    sp = result["analysis"]["sharepoint"]
    assert sp["canvas_apps"]
    app = sp["canvas_apps"][0]
    assert "https://example.sharepoint.com/sites/Reply" in app.get("site_urls", [])
    assert "ReplyList" in app.get("data_sources", [])
    assert "SP_SITE" in app.get("env_var_names", [])
    assert any(t.get("source") == "canvasapp" for t in sp.get("targets", []))


def test_no_sharepoint_returns_used_false(tmp_path: Path):
    result = {"name": "Test", "version": "1.0.0", "publisher": "pub", "components": []}
    analyze_sharepoint(tmp_path, result)

    sp = result["analysis"]["sharepoint"]
    assert sp["used"] is False
    assert sp["environment_variables"] == []
    assert sp["flows"] == []
    assert sp["canvas_apps"] == []
    assert sp["knowledge_sources"] == []
    assert sp["targets"] == []


def test_backward_compatibility_shape(tmp_path: Path):
    result = {
        "name": "Solution",
        "version": "2.0.0",
        "publisher": "Publisher",
        "components": [{"name": "FlowA", "type": "flow"}],
    }

    analyze_sharepoint(tmp_path, result)

    assert result["name"] == "Solution"
    assert result["version"] == "2.0.0"
    assert result["publisher"] == "Publisher"
    assert result["components"] == [{"name": "FlowA", "type": "flow"}]
    sp = result["analysis"]["sharepoint"]
    assert "used" in sp
    assert "environment_variables" in sp
    assert "flows" in sp
    assert "canvas_apps" in sp
    assert "knowledge_sources" in sp
    assert "targets" in sp
    assert "errors" in sp
