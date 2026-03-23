import MermaidDiagram from "@/app/components/MermaidDiagram";
import MarkdownWithMermaid from "@/app/components/MarkdownWithMermaid";

const exampleMermaid = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Process 1]
    B -->|No| D[Process 2]
    C --> E[End]
    D --> E`;

const exampleMarkdown = `# Mermaid Diagram Examples

This page demonstrates automatic Mermaid diagram rendering in markdown.

## Flowchart Example

\`\`\`mermaid
graph LR
    A[Input] --> B[Processing]
    B --> C[Output]
    C --> D{Valid?}
    D -->|Yes| E[Save]
    D -->|No| A
\`\`\`

## Sequence Diagram

\`\`\`mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant Database
    
    User->>Frontend: Upload Document
    Frontend->>Backend: POST /api/upload
    Backend->>Database: Store Document
    Database-->>Backend: Confirmation
    Backend-->>Frontend: Success Response
    Frontend-->>User: Display Success
\`\`\`

## Class Diagram

\`\`\`mermaid
classDiagram
    class RagPipelineService {
        +ProcessDocumentAsync()
        +GenerateDocumentation()
        -EmbedChunks()
    }
    class LlmClientService {
        +SendPromptAsync()
        +StreamResponse()
    }
    class OnnxEmbeddingService {
        +GenerateEmbedding()
    }
    
    RagPipelineService --> LlmClientService
    RagPipelineService --> OnnxEmbeddingService
\`\`\`

## State Diagram

\`\`\`mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Upload File
    Processing --> Parsing: Parse Content
    Parsing --> Embedding: Generate Embeddings
    Embedding --> Complete: Success
    Processing --> Error: Validation Failed
    Parsing --> Error: Parse Error
    Error --> Idle: Retry
    Complete --> [*]
\`\`\`

## Simple Code Block (Non-Mermaid)

Regular code blocks still work:

\`\`\`typescript
const greeting = "Hello, World!";
console.log(greeting);
\`\`\`
`;

export default function MermaidTestPage() {
  return (
    <div className="container mx-auto p-8 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Mermaid Renderer Test Page</h1>
      
      <section className="mb-10">
        <h2 className="text-2xl font-semibold mb-4">Direct Component Usage</h2>
        <p className="mb-4 text-gray-600">
          Using the <code className="bg-gray-100 px-2 py-1 rounded">MermaidDiagram</code> component directly:
        </p>
        <MermaidDiagram source={exampleMermaid} className="border rounded p-4" />
      </section>

      <section>
        <h2 className="text-2xl font-semibold mb-4">Markdown with Auto-Rendering</h2>
        <p className="mb-4 text-gray-600">
          Using the <code className="bg-gray-100 px-2 py-1 rounded">MarkdownWithMermaid</code> component 
          to automatically render mermaid code blocks:
        </p>
        <div className="border rounded p-6 bg-white">
          <MarkdownWithMermaid content={exampleMarkdown} />
        </div>
      </section>

      <section className="mt-10 p-4 bg-blue-50 border border-blue-200 rounded">
        <h3 className="font-semibold text-blue-900 mb-2">🎉 Client-Side Rendering</h3>
        <p className="text-blue-800 text-sm">
          These diagrams are rendered entirely in the browser using <strong>mermaid.js</strong>.
          No server-side rendering or mmdc CLI required!
        </p>
      </section>
    </div>
  );
}
