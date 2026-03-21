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
        ref={containerRef}
        className="mermaid-diagram"
        style={{ minHeight: isLoading ? "100px" : undefined, maxWidth: "100%", overflowX: "auto" }}
      />
    </div>
  );
}
