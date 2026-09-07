#!/usr/bin/env python3
"""Compatibility wrapper for the 09:20 scheduler entry point."""

import sys

from generate_daily_predictions import run_generator


def generate_and_lock_0920_baseline(target_date: str | None = None):
    return run_generator(target_date)


if __name__ == "__main__":
    generate_and_lock_0920_baseline(sys.argv[1] if len(sys.argv) > 1 else None)
