import { NextResponse } from "next/server";

const RAG_BACKEND_URL = process.env.RAG_BACKEND_URL || "http://localhost:8000";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { solution, dataset_id: datasetId } = body;
    if (!datasetId) {
      return NextResponse.json({ error: "dataset_id is required" }, { status: 400 });
    }

    // Create chunks from the PARSED SOLUTION data (PAC CLI output)
    const chunks: { content: string; metadata: Record<string, string> }[] = [];
    
    // Add solution overview chunk
    if (solution) {
      chunks.push({
        content: `Solution Name: ${solution.solution_name || 'Unknown'}
Version: ${solution.version || 'N/A'}
Publisher: ${solution.publisher || 'N/A'}
Total Components: ${solution.components?.length || 0}
Managed: ${solution.managed || false}`,
        metadata: {
          source: "solution_overview",
          file_name: "solution_overview",
          kind: "solution",
          type: "overview",
          solution_name: solution?.solution_name || "Unknown"
        }
      });
    }
    
    // Add each component as a separate chunk (the actual parsed PAC CLI content)
    if (solution?.components && Array.isArray(solution.components)) {
      for (const component of solution.components) {
        const componentContent = `Component: ${component.name || 'Unknown'}
Type: ${component.type || 'Unknown'}
${component.description ? `Description: ${component.description}` : ''}
${component.path ? `Path: ${component.path}` : ''}
${component.content ? `Content:\n${typeof component.content === 'string' ? component.content : JSON.stringify(component.content, null, 2)}` : ''}`;
        
        chunks.push({
          content: componentContent,
          metadata: {
            source: component.name || "component",
            file_name: component.name || "component",
            kind: "solution",
            type: component.type || "component",
            path: component.path || "",
            solution_name: solution?.solution_name || "Unknown"
          }
        });
      }
    }
    
    // Add workflows/flows as chunks
    if (solution?.workflows && Array.isArray(solution.workflows)) {
      for (const workflow of solution.workflows) {
        chunks.push({
          content: `Workflow: ${workflow.name || 'Unknown'}
Type: ${workflow.type || 'Flow'}
${workflow.trigger ? `Trigger: ${workflow.trigger}` : ''}
${workflow.actions ? `Actions: ${JSON.stringify(workflow.actions, null, 2)}` : ''}
${workflow.definition ? `Definition:\n${JSON.stringify(workflow.definition, null, 2)}` : ''}`,
          metadata: {
            source: workflow.name || "workflow",
            file_name: workflow.name || "workflow",
            kind: "solution",
            type: "workflow",
            solution_name: solution?.solution_name || "Unknown"
          }
        });
      }
    }
    
    // Add canvas apps as chunks
    if (solution?.canvas_apps && Array.isArray(solution.canvas_apps)) {
      for (const app of solution.canvas_apps) {
        chunks.push({
          content: `Canvas App: ${app.name || 'Unknown'}
${app.screens ? `Screens: ${JSON.stringify(app.screens, null, 2)}` : ''}
${app.controls ? `Controls: ${JSON.stringify(app.controls, null, 2)}` : ''}
${app.data_sources ? `Data Sources: ${JSON.stringify(app.data_sources, null, 2)}` : ''}`,
          metadata: {
            source: app.name || "canvas_app",
            file_name: app.name || "canvas_app",
            kind: "solution",
            type: "canvas_app",
            solution_name: solution?.solution_name || "Unknown"
          }
        });
      }
    }
    
    // Add raw files content if available
    if (solution?.files && Array.isArray(solution.files)) {
      for (const file of solution.files) {
        if (file.content && typeof file.content === 'string' && file.content.length > 0) {
          chunks.push({
            content: `File: ${file.name || file.path || 'Unknown'}
Path: ${file.path || 'N/A'}
Content:
${file.content.substring(0, 3000)}${file.content.length > 3000 ? '...(truncated)' : ''}`,
            metadata: {
              source: file.name || file.path || "file",
              file_name: file.name || file.path || "file",
              kind: "solution",
              type: "file",
              path: file.path || "",
              solution_name: solution?.solution_name || "Unknown"
            }
          });
        }
      }
    }

    if (chunks.length === 0) {
      return NextResponse.json({ message: "No content to ingest from parsed solution" });
    }

    // Send chunks to backend for embedding and storage (FREE with Sentence-BERT)
    const res = await fetch(`${RAG_BACKEND_URL}/rag/ingest-chunks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunks, dataset_id: datasetId, dataset_mode: "solution" }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: errorData.detail || "Failed to ingest chunks" },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({ 
      success: true, 
      chunks_ingested: chunks.length,
      ...data 
    });

  } catch (error: any) {
    console.error("Ingest error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
