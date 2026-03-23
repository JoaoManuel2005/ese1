"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import MermaidDiagram from "./MermaidDiagram";
import type { Components } from "react-markdown";

interface MarkdownWithMermaidProps {
  /**
   * Markdown content that may contain ```mermaid code blocks
   */
  content: string;
  /**
   * Optional className for the markdown container
   */
  containerClassName?: string;
}

/**
 * Markdown renderer that automatically converts ```mermaid code blocks
 * into interactive Mermaid diagrams.
 * 
 * @example
 * ```tsx
 * <MarkdownWithMermaid content={`
 *   # My Documentation
 *   
 *   Here's a diagram:
 *   
 *   \`\`\`mermaid
 *   graph TD
 *     A --> B
 *   \`\`\`
 * `} />
 * ```
 */
export default function MarkdownWithMermaid({
  content,
  containerClassName = "",
}: MarkdownWithMermaidProps) {
  const components: Components = {
    code(props) {
      const { children, className, node, ...rest } = props;
      const match = /language-(\w+)/.exec(className || "");
      const language = match ? match[1] : "";
      const codeString = String(children).replace(/\n$/, "");
      const isInline = !className;

      // Render mermaid diagrams
      if (!isInline && language === "mermaid") {
        return (
          <div className="my-4">
            <MermaidDiagram source={codeString} />
          </div>
        );
      }

      // Regular code blocks
      if (!isInline) {
        return (
          <pre className={className}>
            <code className={className} {...rest}>
              {children}
            </code>
          </pre>
        );
      }

      // Inline code
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className={`prose max-w-none ${containerClassName}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
