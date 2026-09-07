#!/usr/bin/env python3
"""Deprecated midnight prediction entry point.

Predictions are generated at 09:20, when the intended information set is
available.  Evaluation runs after the close. Midnight no longer creates a
second, ambiguously timestamped baseline.
"""

import json


def run_midnight_inspection_and_prediction() -> dict:
    result = {
        "status": "deprecated",
        "predictionGenerated": False,
        "openingJob": "09:20 generate_daily_predictions.py",
        "reviewJob": "18:10 nightly_review.py",
    }
    print(json.dumps(result, ensure_ascii=False))
    return result


if __name__ == "__main__":
    run_midnight_inspection_and_prediction()
