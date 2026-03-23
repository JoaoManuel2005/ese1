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
      er: {
        useMaxWidth: false,
        layoutDirection: "LR",
        minEntityWidth: 200,
        minEntityHeight: 100,
        entityPadding: 20,
        stroke: "#1976D2",
        fill: "#E3F2FD",
      },
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

    // Force full-width so diagrams fill their container instead of rendering tiny
    const fullWidthSvg = svg
      .replace(/<svg ([^>]*)width="[^"]*"/, '<svg $1width="100%"')
      .replace(/<svg ([^>]*)height="[^"]*"/, '<svg $1height="auto"');

    return {
      format: "svg",
      mimeType: "image/svg+xml",
      data: fullWidthSvg,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to render Mermaid diagram: ${message}`);
  }
};
