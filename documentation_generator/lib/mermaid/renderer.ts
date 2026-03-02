import mermaid from "mermaid";

export type MermaidOutputFormat = "svg" | "png";

export type MermaidRenderResult = {
  format: MermaidOutputFormat;
  mimeType: string;
  data: Uint8Array | string;
};

export type MermaidRenderer = (
  source: string,
  format: MermaidOutputFormat
) => Promise<MermaidRenderResult>;

// Initialize mermaid with default configuration
let isInitialized = false;

function initializeMermaid() {
  if (!isInitialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      fontFamily: "arial",
    });
    isInitialized = true;
  }
}

/**
 * Render Mermaid diagram source to SVG.
 * Note: PNG output is not supported in browser environments.
 * Use this for client-side rendering in React components.
 */
export const renderMermaid: MermaidRenderer = async (
  source: string,
  format: MermaidOutputFormat = "svg"
) => {
  initializeMermaid();

  if (format === "png") {
    throw new Error(
      "PNG format is not supported in browser environment. Use SVG instead."
    );
  }

  if (!source || !source.trim()) {
    throw new Error("Mermaid source must be non-empty");
  }

  try {
    // Generate a unique ID for this diagram
    const id = `mermaid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Render the diagram
    const { svg } = await mermaid.render(id, source);
    
    return {
      format: "svg",
      mimeType: "image/svg+xml",
      data: svg,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to render Mermaid diagram: ${message}`);
  }
};
