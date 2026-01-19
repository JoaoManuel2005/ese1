import os
from typing import Any, Optional

from dotenv import load_dotenv

from llm_client import chat_complete, resolve_model, resolve_provider

load_dotenv()


class RAGPipeline:
    """RAG Pipeline for generating Power Platform documentation"""

    def __init__(self):
        self.default_provider = resolve_provider()
        self.model = resolve_model(self.default_provider)

    async def generate(
        self,
        solution: Any,
        doc_type: str = "markdown",
        provider_override: Optional[str] = None,
        model_override: Optional[str] = None,
    ) -> str:
        """Generate documentation for a parsed solution using configured provider"""

        context = self._build_context(solution)
        prompt = self._build_prompt(solution, context, doc_type)
        provider = resolve_provider(provider_override or self.default_provider)
        model_to_use = model_override
        if not model_to_use:
            if provider != self.default_provider:
                model_to_use = resolve_model(provider)
            else:
                model_to_use = self.model

        return chat_complete(
            system=self._get_system_prompt(),
            user=prompt,
            provider_override=provider,
            model_override=model_to_use,
        )

    
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
