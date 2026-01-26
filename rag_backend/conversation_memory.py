"""
Conversation Memory Module
Stores and retrieves conversation history for context-aware responses
"""

from typing import Dict, List, Optional
from datetime import datetime
import json


class Message:
    """Represents a single message in the conversation"""
    def __init__(self, role: str, content: str, timestamp: Optional[float] = None):
        self.role = role  # "user" or "assistant"
        self.content = content
        self.timestamp = timestamp or datetime.now().timestamp()

    def to_dict(self):
        return {
            "role": self.role,
            "content": self.content,
            "timestamp": self.timestamp
        }

    @classmethod
    def from_dict(cls, data: dict):
        return cls(
            role=data.get("role", "user"),
            content=data.get("content", ""),
            timestamp=data.get("timestamp")
        )


class ConversationMemory:
    """In-memory conversation storage per dataset"""

    def __init__(self, max_messages_per_session: int = 50):
        self.conversations: Dict[str, List[Message]] = {}
        self.max_messages = max_messages_per_session

    def add_message(self, dataset_id: str, role: str, content: str):
        """Add a message to the conversation history"""
        if dataset_id not in self.conversations:
            self.conversations[dataset_id] = []

        message = Message(role, content)
        self.conversations[dataset_id].append(message)

        # Trim to max messages (keep most recent)
        if len(self.conversations[dataset_id]) > self.max_messages:
            self.conversations[dataset_id] = self.conversations[dataset_id][-self.max_messages:]

    def get_history(self, dataset_id: str, max_messages: Optional[int] = None) -> List[Dict]:
        """Get conversation history for a dataset"""
        if dataset_id not in self.conversations:
            return []

        messages = self.conversations[dataset_id]
        if max_messages:
            messages = messages[-max_messages:]

        return [msg.to_dict() for msg in messages]

    def get_context_summary(self, dataset_id: str, max_chars: int = 2000) -> str:
        """Get a summary of recent conversation for context"""
        if dataset_id not in self.conversations:
            return ""

        messages = self.conversations[dataset_id][-10:]  # Last 10 messages

        context_parts = []
        total_chars = 0

        for msg in reversed(messages):
            msg_text = f"{msg.role}: {msg.content}"
            if total_chars + len(msg_text) > max_chars:
                break
            context_parts.insert(0, msg_text)
            total_chars += len(msg_text)

        return "\n".join(context_parts)

    def clear_history(self, dataset_id: str):
        """Clear conversation history for a dataset"""
        if dataset_id in self.conversations:
            del self.conversations[dataset_id]

    def get_all_datasets(self) -> List[str]:
        """Get all dataset IDs with conversations"""
        return list(self.conversations.keys())


# Global instance
conversation_memory = ConversationMemory()
