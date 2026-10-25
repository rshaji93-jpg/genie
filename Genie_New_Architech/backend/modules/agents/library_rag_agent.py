"""Read-only relevance and ownership gate for Library context retrieval."""

from __future__ import annotations

from typing import Any, Iterable

try:
    from ..library_guard import rank_and_filter_library_context
except ImportError:
    from modules.library_guard import rank_and_filter_library_context


class LibraryRAGAgent:
    """Retrieve relevant Library entries while preserving owner and room scopes."""

    read_only = True
    relevance_threshold = 0.82

    def retrieve(
        self,
        query: str,
        user_id: str,
        conversation_id: str,
        items: Iterable[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        return rank_and_filter_library_context(
            query,
            user_id,
            conversation_id,
            items,
            min_score=self.relevance_threshold,
        )


library_rag_agent = LibraryRAGAgent()
