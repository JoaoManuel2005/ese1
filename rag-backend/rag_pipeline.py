import os
from openai import OpenAI
from typing import Any
from dotenv import load_dotenv

load_dotenv()

class RAGPipeline:
    """RAG Pipeline for generating Power Platform documentation"""
    
    def __init__(self):
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        self.model = os.getenv("OPENAI_MODEL", "gpt-4")
    
    async def generate(self, solution: Any, doc_type: str = "markdown") -> str:
        """Generate documentation for a parsed solution (uses API key from .env)"""
        
        context = self._build_context(solution)
        prompt = self._build_prompt(solution, context, doc_type)
        
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": self._get_system_prompt()},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=4000
        )
        
        return response.choices[0].message.content
    
    def _get_system_prompt(self) -> str:
        return """You are a technical documentation expert for Microsoft Power Platform solutions.
Generate clear, comprehensive, and well-structured documentation.
Include executive summaries, technical details, and deployment instructions.
Format documentation professionally with proper headings and sections."""
    
    def _build_context(self, solution: Any) -> str:
        """Build context string from solution components"""
        components_by_type = {}
        
        for comp in solution.components:
            comp_type = comp.type
            if comp_type not in components_by_type:
                components_by_type[comp_type] = []
            components_by_type[comp_type].append(comp)
        
        context_parts = []
        for comp_type, components in components_by_type.items():
            context_parts.append(f"\n## {comp_type.upper()}S ({len(components)})")
            for comp in components:
                context_parts.append(f"- **{comp.name}**: {comp.description or 'No description'}")
                if comp.metadata:
                    context_parts.append(f"  Metadata: {comp.metadata}")
        
        return "\n".join(context_parts)
    
    def _build_prompt(self, solution: Any, context: str, doc_type: str) -> str:
        return f"""Generate comprehensive {doc_type} documentation for this Power Platform solution:

# Solution: {solution.solution_name}
- **Version**: {solution.version}
- **Publisher**: {solution.publisher}
- **Total Components**: {len(solution.components)}

# Components:
{context}

Include:
1. **Executive Summary**
2. **Solution Architecture**
3. **Component Catalog** (by type)
4. **Data Flow**
5. **Dependencies**
6. **Deployment Guide**
7. **Troubleshooting**

Format as {doc_type}."""
