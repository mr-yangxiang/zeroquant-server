#!/usr/bin/env python3
"""Deprecated compatibility entry point for the former fake history expander."""

import json


def check_and_expand() -> tuple[list[str], dict]:
    state = {
        "status": "deprecated",
        "reason": "history windows must be selected by a fixed research protocol, not timer counts",
        "modelMutation": False,
        "knowledgeBaseMutation": False,
    }
    print(json.dumps(state, ensure_ascii=False))
    return [], state


if __name__ == "__main__":
    check_and_expand()
