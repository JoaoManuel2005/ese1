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
        user_preferences: Optional[str] = None,
    ) -> str:
        """Generate documentation for a parsed solution using configured provider"""

        context = self._build_context(solution)
        prompt = self._build_prompt(solution, context, doc_type, user_preferences)
        provider = resolve_provider(provider_override or self.default_provider)
        model_to_use = model_override
        if not model_to_use:
            if provider != self.default_provider:
                model_to_use = resolve_model(provider)
            else:
                model_to_use = self.model

        return chat_complete(
            system=self._get_system_prompt(user_preferences),
            user=prompt,
            provider_override=provider,
            model_override=model_to_use,
        )


    def _get_system_prompt(self, user_preferences: Optional[str] = None) -> str:
        base_prompt = """You are an intelligent technical documentation assistant for Microsoft Power Platform solutions, similar to ChatGPT.
Generate clear, comprehensive, and well-structured documentation.
Follow user instructions naturally and precisely."""

        if user_preferences:
            base_prompt += f"""

USER INSTRUCTIONS (from natural conversation):
{user_preferences}

Follow the user's requests intelligently:
- EXCLUDE_SECTION: Completely omit that section
- EMPHASIZE_SECTION: Make ONLY that section significantly more detailed. Add technical diagrams, architecture patterns, step-by-step guides, examples. Keep other sections unchanged.
- ADD_SECTION: Create this new section with comprehensive, relevant content
- MODIFY: Apply the requested modification to the entire document or specified parts

CRITICAL RULE: Sections not mentioned in user instructions should remain at their normal detail level. Do NOT expand or modify them."""

        return base_prompt
    
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
    
    def _build_prompt(self, solution: Any, context: str, doc_type: str, user_preferences: Optional[str] = None) -> str:
        base_prompt = f"""Generate comprehensive {doc_type} documentation for this Power Platform solution:

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

        if user_preferences:
            base_prompt += f"""

USER'S REQUESTS (extracted from conversation):
{user_preferences}

Apply these instructions intelligently:
- EXCLUDE_SECTION: Remove it entirely
- EMPHASIZE_SECTION: Make ONLY that section much more detailed (add diagrams, examples, technical depth)
- ADD_SECTION: Create new section with comprehensive content
- MODIFY: Apply the modification as requested

Only change what the user explicitly requested. Other sections stay at normal detail."""

        return base_prompt
