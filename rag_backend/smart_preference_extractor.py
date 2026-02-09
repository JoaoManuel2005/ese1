"""
Smart LLM-based preference extractor
Understands natural language without specific keywords
"""

from typing import List, Dict, Optional
from llm_client import chat_complete, resolve_provider, resolve_model
import os


def extract_preferences_with_llm(
    conversation_history: List[Dict[str, str]],
    *,
    api_key: Optional[str] = None,
    endpoint: Optional[str] = None,
    provider_override: Optional[str] = None,
    model_override: Optional[str] = None,
) -> str:
    """
    Use LLM to understand user preferences from natural conversation
    This works even without specific keywords
    """

    if not conversation_history:
        return ""

    # Get ALL user messages (up to last 50 for full context)
    user_messages = [msg for msg in conversation_history if msg.get("role") == "user"][-50:]

    if not user_messages:
        return ""

    # Build conversation context
    conversation_text = "\n".join([f"User: {msg.get('content', '')}" for msg in user_messages])

    system_prompt = """You are an intelligent documentation assistant like ChatGPT.
Your job is to understand what the user wants to do with their documentation based on natural conversation.

The user is chatting about a Power Platform solution documentation. Analyze their messages and extract their preferences.

Types of requests:
1. EXCLUDE/REMOVE sections: "I don't need X", "remove Y", "skip Z", "that's not important"
2. EMPHASIZE/EXPAND sections: "make X more detailed", "expand Y", "tell me more about Z", "I need more info on W"
3. ADD new sections: "add a conclusion", "include security section", "create FAQ"
4. MODIFY content: "make it technical", "simplify the language", "add diagrams"

Output format (ONE preference per line):
EXCLUDE_SECTION: [section name]
EMPHASIZE_SECTION: [section name]
ADD_SECTION: [section name]
MODIFY: [what to modify and how]

If there are NO documentation modification requests (just questions or general chat), output: "No preferences found"

Be intelligent and flexible:
- Understand natural language without needing specific keywords
- Infer section names from context (e.g., "make architecture better" → EMPHASIZE_SECTION: solution architecture)
- Distinguish between QUESTIONS about the doc vs REQUESTS to change it
- "tell me about X" = QUESTION (No preferences found)
- "make X more detailed" = REQUEST (EMPHASIZE_SECTION: X)

Examples:
User: "that's not important" → EXCLUDE_SECTION: [whatever they referenced]
User: "I need way more detail on deployment" → EMPHASIZE_SECTION: deployment
User: "add a conclusion" → ADD_SECTION: conclusion
User: "make the architecture section better" → EMPHASIZE_SECTION: solution architecture
User: "what is in the deployment section?" → No preferences found (this is a question)
User: "can you make it more technical?" → MODIFY: increase technical depth
"""

    user_prompt = f"""Analyze this conversation and extract documentation preferences:

{conversation_text}

What are the user's documentation preferences?"""

    try:
        # Try to use LLM to understand preferences
        provider = resolve_provider(provider_override)
        model = resolve_model(provider, model_override)

        # Only use LLM if OpenAI key is available, otherwise fall back to keyword-based
        effective_api_key = api_key or os.getenv("OPENAI_API_KEY")
        if provider == "cloud" and not effective_api_key:
            return ""

        result = chat_complete(
            system=system_prompt,
            user=user_prompt,
            provider_override=provider,
            model_override=model,
            api_key_override=effective_api_key,
            endpoint_override=endpoint,
        )

        if result and "No preferences found" not in result:
            return f"User Documentation Preferences:\n{result}"

        return ""

    except Exception as e:
        print(f"LLM preference extraction failed: {e}")
        return ""


def should_regenerate_from_message(message: str) -> bool:
    """Check if a message indicates user wants to regenerate documentation"""
    message_lower = message.lower()

    # Direct regeneration requests
    direct_patterns = [
        r"\b(?:re)?generat(?:e|ing)\b",
        r"\bupdate\s+(?:the\s+)?doc(?:umentation)?\b",
        r"\bcreate\s+(?:new\s+)?doc(?:umentation)?\b",
        r"\bmake\s+(?:a\s+)?(?:new\s+)?doc(?:ument)?\b",
        r"\bredo\s+(?:the\s+)?doc(?:umentation)?\b",
    ]

    # Document modification intent (more flexible)
    modification_patterns = [
        r"\b(?:want|need|like)\s+(?:to\s+)?(?:see|have|add|include)",
        r"\b(?:don'?t|do not)\s+(?:want|need|like)",
        r"\bmore\s+(?:on|about|details?|info)",
        r"\bless\s+(?:on|about|details?|info)",
        r"\bfocus\s+(?:more\s+)?(?:on|about)",
        r"\btell\s+me\s+(?:more\s+)?about",
        r"\bexpand",
        r"\bremove",
        r"\bskip",
        r"\b(?:make|keep)\s+it\s+(?:shorter|longer|brief|detailed)",
    ]

    import re
    for pattern in direct_patterns + modification_patterns:
        if re.search(pattern, message_lower):
            return True

    return False
