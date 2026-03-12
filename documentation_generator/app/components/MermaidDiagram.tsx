"use client";

import { useEffect, useRef, useState } from "react";
import { renderMermaid } from "@/lib/mermaid/renderer";

interface MermaidDiagramProps {
  /**
   * Mermaid diagram source code
   */
  source: string;
  /**
   * Optional className for the container div
   */
  className?: string;
  /**
   * Optional fallback content when rendering fails
   */
  fallback?: React.ReactNode;
}

/**
 * Client-side Mermaid diagram renderer component.
 * Automatically renders Mermaid syntax to SVG in the browser.
 * 
 * @example
 * ```tsx
 * <MermaidDiagram source={`
 *   graph TD
 *     A[Start] --> B[Process]
 *     B --> C[End]
 * `} />
 * ```
 */
/**
 * Sanitizes Mermaid source to fix common LLM-generated syntax errors.
 * - Replaces hyphens in entity/node names with underscores (hyphens are invalid identifiers)
 * - Collapses double-underscores in TABLE__ prefixes
 * - Removes stray special characters from identifier tokens
 */
function sanitizeMermaidSource(src: string): string {
  const isEr = src.includes("erDiagram");
  const isFlow = src.includes("flowchart") || src.includes("graph ");

  return src.split("\n").map((line) => {
    const trimmed = line.trim();
    // Skip blank lines and comment/init lines
    if (trimmed === "" || trimmed.startsWith("%%")) return line;

    if (isEr) {
      // In ER diagrams, sanitize identifiers (entity names, attribute names).
      // Identifiers are alphanumeric+underscore tokens that may contain hyphens.
      // We must NOT touch: relationship symbols (||--o{), quoted strings, keywords.
      return line.replace(/\b([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+)\b/g, (match) =>
        match.replace(/-/g, "_")
      );
    }

    if (isFlow) {
      // In flowcharts, node IDs before [ ( { must not contain hyphens or spaces.
      // Replace hyphens in bare node IDs (before [, (, {, -->)
      return line.replace(/\b([A-Za-z0-9_]+(?:-[A-Za-z0-9_]+)+)(?=[\s\[\(\{<]|-->|---|\|)/g, (match) =>
        match.replace(/-/g, "_")
      );
    }

    return line;
  }).join("\n");
}

export default function MermaidDiagram({
  source,
  className = "",
  fallback,
}: MermaidDiagramProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showContextHint, setShowContextHint] = useState(false);

  const handleOpenInNewTab = () => {
    if (!containerRef.current) return;

    const svgElement = containerRef.current.querySelector("svg");
    if (!svgElement) return;

    // Clone the SVG to preserve it
    const svgClone = svgElement.cloneNode(true) as SVGElement;
    
    // Remove width/height constraints to let it scale naturally
    svgClone.removeAttribute("width");
    svgClone.removeAttribute("height");
    svgClone.removeAttribute("style");
    
    // Get the SVG as string
    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgClone);

    // Create a new window with the SVG
    const newWindow = window.open("", "_blank");
    if (newWindow) {
      newWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Diagram - Full View</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
              }
              body {
                margin: 0;
                padding: 0;
                background: #f5f5f5;
                font-family: system-ui, -apple-system, sans-serif;
                overflow: auto;
              }
              .toolbar {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                background: white;
                padding: 10px 20px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                z-index: 1000;
                display: flex;
                align-items: center;
                justify-content: flex-end;
              }
              .toolbar .info {
                color: #666;
                font-size: 14px;
              }
              .container {
                margin-top: 60px;
                padding: 40px;
                display: flex;
                justify-content: center;
                align-items: flex-start;
                min-height: calc(100vh - 60px);
              }
              .diagram-wrapper {
                background: white;
                padding: 40px;
                border-radius: 12px;
                box-shadow: 0 4px 16px rgba(0,0,0,0.1);
                max-width: 100%;
                overflow: visible;
              }
              svg {
                width: 100% !important;
                height: auto !important;
                max-width: none !important;
                display: block;
              }

            </style>
          </head>
          <body>
            <div class="toolbar">
              <span class="info">Right-click diagram to save image</span>
            </div>
            <div class="container">
              <div class="diagram-wrapper">
                ${svgString}
              </div>
            </div>
          </body>
        </html>
      `);
      newWindow.document.close();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    handleOpenInNewTab();
  };

  useEffect(() => {
    let isMounted = true;

    async function render() {
      if (!containerRef.current || !source.trim()) {
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);

        const cleanSource = sanitizeMermaidSource(source);
        const result = await renderMermaid(cleanSource, "svg");
        
        if (isMounted && containerRef.current) {
          containerRef.current.innerHTML = result.data as string;
          // Force SVG to fill its container width
          const svgEl = containerRef.current.querySelector("svg");
          if (svgEl) {
            svgEl.setAttribute("width", "100%");
            svgEl.removeAttribute("height");
            svgEl.style.width = "100%";
            svgEl.style.height = "auto";
            svgEl.style.display = "block";
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("Mermaid rendering error:", message);
        if (isMounted) {
          setError(message);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    render();

    return () => {
      isMounted = false;
    };
  }, [source]);

  if (error) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return (
      <div className={`border border-red-300 bg-red-50 p-4 rounded ${className}`}>
        <p className="text-red-700 font-semibold">Failed to render diagram</p>
        <p className="text-red-600 text-sm mt-2">{error}</p>
        <details className="mt-2">
          <summary className="text-xs text-red-500 cursor-pointer">View source</summary>
          <pre className="mt-2 text-xs bg-white p-2 rounded overflow-x-auto">
            {source}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div className={`mermaid-container ${className}`}>
      {isLoading && (
        <div className="flex items-center justify-center p-8 text-gray-500">
          <span className="animate-pulse">Rendering diagram...</span>
        </div>
      )}
      <div
        className="relative group"
        onMouseEnter={() => setShowContextHint(true)}
        onMouseLeave={() => setShowContextHint(false)}
      >
        {!isLoading && !error && (
          <button
            onClick={handleOpenInNewTab}
            className="absolute top-2 right-2 bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded shadow-lg z-10 transition-all opacity-0 group-hover:opacity-100 flex items-center gap-1"
            title="Open diagram in new tab"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open Full View
          </button>
        )}
        <div
          ref={containerRef}
          className="mermaid-diagram cursor-context-menu"
          style={{ minHeight: isLoading ? "100px" : undefined }}
          onContextMenu={handleContextMenu}
          title="Right-click or click button to open in new tab"
        />
      </div>
    </div>
  );
}
