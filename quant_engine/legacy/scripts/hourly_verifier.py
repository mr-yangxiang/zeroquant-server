#!/usr/bin/env python3
"""Deprecated compatibility entry point.

The former job increased the claimed history window after three timer ticks even
though it never compared predictions with outcomes.  That behavior is unsafe
and intentionally disabled.  Use ``nightly_review.py`` for evidence-based
evaluation.
"""

import json


def fetch_realtime_and_verify() -> dict:
    result = {
        "status": "deprecated",
        "replacement": "nightly_review.py",
        "modelMutation": False,
        "knowledgeBaseMutation": False,
    }
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == "__main__":
    fetch_realtime_and_verify()
