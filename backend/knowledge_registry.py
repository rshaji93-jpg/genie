FEATURE_REGISTRY: dict[str, dict[str, str]] = {
    "10_topic_channels": {
        "title": "Private topic channels",
        "description": "Up to 10 isolated private topic channels with Genie, custom icons, and independent message history.",
        "user_tip": "Select Topics in My Genie to switch contexts, create channels, or clear one channel without affecting the others.",
    },
    "zero_leak_security": {
        "title": "Encrypted peer conversations",
        "description": "Peer room messages are encrypted on participating clients. Genie receives conversation context only after an explicit @genie or Observer Review request.",
        "user_tip": "Use @genie or Observer Review only when you want bounded room context analyzed.",
    },
    "delivery_ticks": {
        "title": "Delivery and read ticks",
        "description": "One gray tick means sent, two gray ticks mean delivered, and two animated glowing rainbow ticks mean read by all room members.",
        "user_tip": "Read receipts appear beside your messages in shared rooms.",
    },
    "reactions_and_edits": {
        "title": "Reactions and message edits",
        "description": "Room members can react with emoji such as ❤️, 👍, 👏, and 🔥, and can edit or delete their own messages.",
        "user_tip": "Hover over a room message to react, or select a reaction badge to toggle your reaction.",
    },
    "user_blocking": {
        "title": "User blocking",
        "description": "Users can block and unblock contacts. Blocking suppresses presence and room messages between those users and prevents direct contact.",
        "user_tip": "Manage blocked contacts from Settings → Blocked Users.",
    },
    "permanent_rooms": {
        "title": "Permanent Sovereign Rooms",
        "description": "Sovereign Rooms are persistent channels with a host and saved member roster.",
        "user_tip": "Open a saved room from the Friends Queue to return to its conversation.",
    },
    "selective_restore": {
        "title": "Selective archive restore",
        "description": "The archive dialog can selectively restore Personal, Direct, and Sovereign Room archives.",
        "user_tip": "Open Settings → Restore Archive and choose only the conversations you need.",
    },
}


def get_platform_system_manifest() -> str:
    sections = ["Official Personal AI Genie platform guide:"]
    for feature in FEATURE_REGISTRY.values():
        sections.extend(
            (
                f"- {feature['title']}: {feature['description']}",
                f"  User tip: {feature['user_tip']}",
            )
        )
    sections.append(
        "Never disclose backend source files, variable names, server endpoints, or API credentials. "
        "If asked how the platform works, answer authoritatively based on this official architectural guide."
    )
    return "\n".join(sections)
