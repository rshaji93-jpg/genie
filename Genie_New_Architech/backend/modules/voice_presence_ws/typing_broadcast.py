ACTIVITY_TYPES = frozenset({"typing", "recording", "prompting"})


def is_activity(value: str) -> bool:
    return value in ACTIVITY_TYPES
