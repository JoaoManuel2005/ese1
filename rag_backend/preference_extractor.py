"""
Extract user preferences from chat conversations for document generation
"""

import re
from typing import List, Dict


def extract_preferences_from_chat(conversation_history: List[Dict[str, str]]) -> str:
    """
    Extract actionable preferences from chat history
    Focuses on what user wants included/excluded in documentation
    """

    preferences = []

    # Keywords for excluding content
    exclude_keywords = [
        r"don'?t\s+(?:want|need|include)",
        r"remove",
        r"skip",
        r"exclude",
        r"without",
        r"no\s+(?:need|thanks)",
        r"not\s+(?:interested|needed)",
        r"leave\s+out",
    ]

    # Keywords for including/emphasizing content
    include_keywords = [
        r"focus\s+on",
        r"emphasize",
        r"include\s+(?:more|details)",
        r"want\s+(?:to\s+see|more)",
        r"add",
        r"need\s+(?:more|details)",
        r"expand\s+(?:on\s+)?(?:the\s+)?",
        r"tell\s+me\s+(?:more|about)",
        r"give\s+more\s+(?:details|info)",
        r"more\s+(?:details|information)\s+(?:on|about)",
        r"elaborate\s+on",
        r"go\s+deeper\s+(?:on|into)",
        r"make\s+(.+?)\s+more\s+(?:detailed|comprehensive|thorough)",
        r"make\s+(.+?)\s+(?:longer|bigger)",
    ]

    # Keywords for adding new sections
    add_section_keywords = [
        r"add\s+(?:a\s+)?(.+?)\s+section",
        r"include\s+(?:a\s+)?(.+?)\s+section",
        r"create\s+(?:a\s+)?(.+?)\s+section",
        r"need\s+(?:a\s+)?(.+?)\s+section",
        r"want\s+(?:a\s+)?(.+?)\s+section",
    ]

    # Keywords for formatting preferences
    format_keywords = [
        r"(?:make|keep)\s+it\s+(?:short|brief|concise)",
        r"(?:make|keep)\s+it\s+(?:detailed|comprehensive|thorough)",
        r"bullet\s+points?",
        r"numbered\s+list",
        r"table\s+format",
    ]

    for msg in conversation_history:
        role = msg.get("role", "")
        content = msg.get("content", "")

        # Only process user messages
        if role != "user":
            continue

        content_lower = content.lower()

        # Check for exclusions
        for pattern in exclude_keywords:
            if re.search(pattern, content_lower):
                # Extract what they want to exclude
                # Look for section names or topics after the keyword
                match = re.search(rf"{pattern}\s+(.{{5,50}}?)(?:\.|,|$)", content_lower)
                if match:
                    excluded_item = match.group(1).strip()
                    preferences.append(f"EXCLUDE: {excluded_item}")

        # Check for adding new sections
        for pattern in add_section_keywords:
            match = re.search(pattern, content_lower)
            if match and match.lastindex and match.lastindex >= 1:
                section_name = match.group(1).strip()
                # Clean up the section name
                section_name = re.sub(r'^(the|a|an)\s+', '', section_name)
                if section_name:
                    preferences.append(f"ADD_SECTION: {section_name}")

        # Check for inclusions/emphasis
        for pattern in include_keywords:
            match = re.search(pattern, content_lower)
            if match:
                # If pattern has a capture group, use it
                if match.lastindex and match.lastindex >= 1:
                    included_item = match.group(1).strip()
                else:
                    # Try to extract what comes after the pattern
                    full_match = match.group(0)
                    after_pattern = content_lower[match.end():match.end()+50]
                    extract_match = re.search(r'^(.{5,50}?)(?:\.|,|please|$)', after_pattern)
                    if extract_match:
                        included_item = extract_match.group(1).strip()
                    else:
                        included_item = full_match

                # Remove common filler words
                included_item = re.sub(r'^(the|a|an)\s+', '', included_item)
                included_item = re.sub(r'\s+more\s+(detailed|comprehensive|thorough).*$', '', included_item)
                if included_item:
                    preferences.append(f"EMPHASIZE: {included_item}")

        # Check for format preferences
        for pattern in format_keywords:
            if re.search(pattern, content_lower):
                preferences.append(f"FORMAT: {pattern}")

        # Check for specific section mentions
        common_sections = [
            "executive summary",
            "solution architecture",
            "architecture",
            "component catalog",
            "data flow",
            "dependencies",
            "deployment",
            "troubleshooting",
            "technical details",
            "overview",
        ]

        for section in common_sections:
            # Check if they mention not wanting this section
            if any(pattern in content_lower for pattern in [f"no {section}", f"skip {section}",
                                                             f"without {section}", f"remove {section}",
                                                             f"don't need {section}", f"don't want {section}"]):
                preferences.append(f"EXCLUDE_SECTION: {section}")
            # Check if they want more of this section (multiple patterns)
            elif any(pattern in content_lower for pattern in [
                f"more {section}",
                f"expand {section}",
                f"focus on {section}",
                f"emphasize {section}",
                f"make {section} more detailed",
                f"make {section} more comprehensive",
                f"make {section} more thorough",
                f"make the {section} more detailed",
                f"make the {section} more comprehensive",
                f"make the {section} more thorough",
                f"make {section} section more detailed",
                f"make {section} section more comprehensive",
                f"make the {section} section more detailed",
            ]):
                preferences.append(f"EMPHASIZE_SECTION: {section}")

    if not preferences:
        return ""

    # Format preferences clearly
    result = "User Documentation Preferences:\n"
    result += "\n".join(f"- {pref}" for pref in preferences)

    return result


def should_regenerate_from_message(message: str) -> bool:
    """Check if a message indicates user wants to regenerate documentation"""
    message_lower = message.lower()

    regenerate_patterns = [
        r"\b(?:re)?generat(?:e|ing)\b",
        r"\bupdate\s+(?:the\s+)?doc(?:umentation)?\b",
        r"\bcreate\s+(?:new\s+)?doc(?:umentation)?\b",
        r"\bmake\s+(?:a\s+)?(?:new\s+)?doc(?:ument)?\b",
        r"\bredo\s+(?:the\s+)?doc(?:umentation)?\b",
    ]

    return any(re.search(pattern, message_lower) for pattern in regenerate_patterns)
