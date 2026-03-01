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
        api_key: Optional[str] = None,
        endpoint: Optional[str] = None,
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
            api_key_override=api_key,
            endpoint_override=endpoint,
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
        """Build context string from solution components with enhanced formatting"""
        components_by_type = {}
        
        for comp in solution.components:
            comp_type = comp.type
            if comp_type not in components_by_type:
                components_by_type[comp_type] = []
            components_by_type[comp_type].append(comp)
        
        context_parts = []
        
        # Define priority order for component types
        priority_types = [
            'knowledge_source', 'search_entity', 'cloud_flow_enhanced', 
            'bot', 'bot_topic', 'environment_variable', 'connection_reference'
        ]
        
        # Process priority types first (enhanced data)
        for comp_type in priority_types:
            if comp_type in components_by_type:
                components = components_by_type[comp_type]
                context_parts.append(f"\n## {comp_type.replace('_', ' ').upper()}S ({len(components)})")
                
                for comp in components:
                    if comp_type == 'knowledge_source':
                        # SharePoint knowledge sources
                        sharepoint = comp.metadata.get('sharepoint', {})
                        context_parts.append(f"- **{comp.name}**")
                        context_parts.append(f"  URL: {comp.metadata.get('web_url', 'N/A')}")
                        if sharepoint:
                            context_parts.append(f"  SharePoint Site: {sharepoint.get('site_id', 'N/A')}")
                            context_parts.append(f"  List ID: {sharepoint.get('list_id', 'N/A')}")
                        context_parts.append(f"  Linked Search: {comp.metadata.get('search_name', 'N/A')}")
                    
                    elif comp_type == 'search_entity':
                        # Dataverse search entities
                        context_parts.append(f"- **{comp.name}**")
                        context_parts.append(f"  Entity: {comp.metadata.get('entity_logical_name', 'N/A')}")
                        context_parts.append(f"  Search ID: {comp.metadata.get('dvtablesearch_id', 'N/A')}")
                    
                    elif comp_type == 'cloud_flow_enhanced':
                        # Flows with Dataverse operations
                        context_parts.append(f"- **{comp.name}**")
                        context_parts.append(f"  Actions: {comp.metadata.get('action_count', 0)}")
                        dv_tables = comp.metadata.get('dataverse_tables', [])
                        if dv_tables:
                            tables_summary = []
                            for table in dv_tables:
                                tables_summary.append(f"{table.get('table')} ({table.get('operation')})")
                            context_parts.append(f"  Dataverse Operations: {', '.join(tables_summary)}")
                        child_flows = comp.metadata.get('child_flows', [])
                        if child_flows:
                            context_parts.append(f"  Calls {len(child_flows)} child flow(s)")
                    
                    elif comp_type == 'bot':
                        # Copilot Studio bots
                        context_parts.append(f"- **{comp.name}**")
                        context_parts.append(f"  Schema: {comp.metadata.get('schema_name', 'N/A')}")
                        context_parts.append(f"  Files: {comp.metadata.get('file_count', 0)}")
                    
                    elif comp_type == 'bot_topic':
                        # Bot topics
                        context_parts.append(f"- **{comp.name}**")
                        context_parts.append(f"  Component: {comp.metadata.get('component_name', 'N/A')}")
                    
                    elif comp_type == 'environment_variable':
                        # Environment variables
                        context_parts.append(f"- **{comp.metadata.get('display_name', comp.name)}**")
                        context_parts.append(f"  Type: {comp.metadata.get('type', 'N/A')}")
                        default_val = comp.metadata.get('default_value')
                        if default_val:
                            context_parts.append(f"  Default: {default_val}")
                    
                    else:
                        # Generic enhanced component
                        context_parts.append(f"- **{comp.name}**: {comp.description or 'No description'}")
                        if comp.metadata:
                            context_parts.append(f"  Metadata: {comp.metadata}")
        
        # Process remaining component types (non-enhanced)
        for comp_type, components in components_by_type.items():
            if comp_type not in priority_types:
                context_parts.append(f"\n## {comp_type.upper()}S ({len(components)})")
                for comp in components:
                    desc = comp.description or 'No description'
                    context_parts.append(f"- **{comp.name}**: {desc}")
                    if comp.metadata and comp.metadata != {}:
                        # Only show metadata if it's meaningful
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

## Documentation Structure

Include these sections:

1. **Executive Summary**
   - Business context and purpose
   - Key capabilities and features

2. **Solution Architecture**
   - High-level architecture diagram
   - Integration points and data flow

3. **Enhanced Component Details** [NEW]
   - **SharePoint Knowledge Sources**: If knowledge_source components exist, list each with:
     * Display name and SharePoint URL
     * Site ID and List ID
     * Linked search configuration
   - **Dataverse Search Configuration**: If search_entity components exist, document:
     * Entity logical names enabled for search
     * Search integration details
   - **Cloud Flow Operations**: For cloud_flow_enhanced components, detail:
     * Dataverse table operations (table name + operation type)
     * Child flow relationships
     * Action counts
   - **Copilot Studio Bots**: If bot/bot_topic components exist, document:
     * Bot configurations and schema names
     * Topic structure and conversation flows
   - **Environment Variables**: If environment_variable components exist, list:
     * Variable names, types, and default values
     * Configuration purpose

4. **Component Catalog** (by type)
   - Organized listing of all remaining components
   - Include Canvas Apps, standard flows, connectors, etc.

5. **Data Flow**
   - User interaction patterns
   - Automated processes
   - External integrations (especially SharePoint if knowledge sources present)

6. **Dependencies**
   - Power Platform requirements
   - Required connectors and licenses
   - Data sources (Dataverse, SharePoint, external APIs)

7. **Deployment Guide**
   - Prerequisites
   - Step-by-step deployment
   - Configuration requirements (especially for knowledge sources and search entities)

8. **Troubleshooting**
   - Common issues and resolutions
   - Connector authentication
   - SharePoint access issues if applicable

Format as {doc_type} with clear headings and tables where appropriate."""

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
