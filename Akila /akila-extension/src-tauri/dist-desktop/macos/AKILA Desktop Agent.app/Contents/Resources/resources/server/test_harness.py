#!/usr/bin/env python3
"""
AKILA Test Harness — measures precision, recall, and F1
=======================================================
Runs the test corpus against the /analyze endpoint and reports
per-entity and overall metrics.

Usage:
    python test_harness.py [--host HOST] [--port PORT]
    python test_harness.py --verbose   # print per-case details
"""

import argparse
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5001

TOKEN_PATTERN = re.compile(r"^<AKILA_([A-Z_]+)_[0-9a-f]{8}>$")


def call_analyze(text, host, port):
    """Send text to the server's /analyze endpoint and return raw response."""
    url = f"http://{host}:{port}/analyze"
    payload = json.dumps({"text": text}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode())


def parse_detections(resp):
    """
    Convert the /analyze response into a set of (value, entity_type) detections.
    The token key format is <AKILA_ENTITY_TYPE_hash>.
    """
    detections = set()
    for token, original in resp.get("tokenMap", {}).items():
        m = TOKEN_PATTERN.match(token)
        if m:
            detections.add((original, m.group(1)))
        else:
            # Fallback: try to infer entity type from token name
            parts = token.lstrip("<").rstrip(">").split("_")
            if len(parts) >= 3:
                entity_type = "_".join(parts[1:-1])
                detections.add((original, entity_type))
    return detections


def compute_metrics(cases, host, port, verbose=False):
    """Run cases and compute per-entity precision/recall/F1."""
    per_entity = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    total_failures = []

    for case in cases:
        text = case["text"]
        expected = set((e["value"], e["type"]) for e in case["expected"])

        resp = call_analyze(text, host, port)
        detected = parse_detections(resp)

        # Positive or negative case
        expected_by_type = defaultdict(set)
        for value, etype in expected:
            expected_by_type[etype].add(value)

        detected_by_type = defaultdict(set)
        for value, etype in detected:
            detected_by_type[etype].add(value)

        all_types = set(expected_by_type) | set(detected_by_type)
        for etype in all_types:
            exp_vals = expected_by_type.get(etype, set())
            det_vals = detected_by_type.get(etype, set())
            tp = len(exp_vals & det_vals)
            fp = len(det_vals - exp_vals)
            fn = len(exp_vals - det_vals)
            per_entity[etype]["tp"] += tp
            per_entity[etype]["fp"] += fp
            per_entity[etype]["fn"] += fn

        if expected != detected:
            total_failures.append(case)
            if verbose:
                missing = expected - detected
                extra = detected - expected
                if missing:
                    print(f"         MISSING: {sorted(missing)}")
                if extra:
                    print(f"         EXTRA:   {sorted(extra)}")
        elif verbose:
            print(f"  [PASS] {text[:60]}")

    return per_entity, total_failures


def report_metrics(per_entity, total_failures):
    """Print the metrics report."""
    print("\n" + "=" * 70)
    print("AKILA PII DETECTION TEST RESULTS")
    print("=" * 70)
    print(f"{'Entity':<28} {'Precision':>10} {'Recall':>10} {'F1':>10} {'N':>6}")
    print("-" * 70)

    total_tp = sum(e["tp"] for e in per_entity.values())
    total_fp = sum(e["fp"] for e in per_entity.values())
    total_fn = sum(e["fn"] for e in per_entity.values())

    for etype in sorted(per_entity.keys()):
        e = per_entity[etype]
        n = e["tp"] + e["fp"]
        if n == 0:
            precision = 1.0
        else:
            precision = e["tp"] / n
        if e["tp"] + e["fn"] == 0:
            recall = 1.0
        else:
            recall = e["tp"] / (e["tp"] + e["fn"])
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        print(f"{etype:<28} {precision:>10.3f} {recall:>10.3f} {f1:>10.3f} {e['tp'] + e['fp']:>6}")

    print("-" * 70)
    overall_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0
    overall_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0
    overall_f1 = (2 * overall_precision * overall_recall
                  / (overall_precision + overall_recall)
                  if (overall_precision + overall_recall) > 0 else 0)
    print(f"{'OVERALL':<28} {overall_precision:>10.3f} {overall_recall:>10.3f} {overall_f1:>10.3f} {total_tp + total_fp:>6}")
    print(f"\nFalse positive rate: {(total_fp / (total_tp + total_fp)) * 100:.2f}%")
    print(f"Cases with mismatches: {len(total_failures)}")
    print("=" * 70)

    return overall_precision, overall_recall, overall_f1


def main():
    parser = argparse.ArgumentParser(description="AKILA PII detection test harness")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Server host")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Server port")
    parser.add_argument("--verbose", action="store_true", help="Print per-case details")
    parser.add_argument("--corpus", default="test_corpus.json", help="Path to corpus JSON")
    args = parser.parse_args()

    with open(args.corpus) as f:
        corpus = json.load(f)

    print(f"Loading corpus: {len(corpus['positive_cases'])} positive, "
          f"{len(corpus['negative_cases'])} negative cases")

    # Verify server is reachable
    try:
        call_analyze("test connectivity", args.host, args.port)
    except Exception as e:
        print(f"ERROR: Cannot reach server at {args.host}:{args.port} — {e}")
        print("Start the server first: python presidio_server.py")
        sys.exit(1)

    print("\n--- Running positive cases ---")
    pos_metrics, pos_fails = compute_metrics(corpus["positive_cases"], args.host, args.port, args.verbose)

    print("\n--- Running negative cases ---")
    neg_metrics, neg_fails = compute_metrics(corpus["negative_cases"], args.host, args.port, args.verbose)

    # Combine, but weight negatives separately for FP rate
    all_metrics = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0})
    for etype, vals in pos_metrics.items():
        all_metrics[etype]["tp"] += vals["tp"]
        all_metrics[etype]["fp"] += vals["fp"]
        all_metrics[etype]["fn"] += vals["fn"]
    for etype, vals in neg_metrics.items():
        all_metrics[etype]["fp"] += vals["fp"]
        all_metrics[etype]["fn"] += vals["fn"]

    all_fails = pos_fails + neg_fails
    precision, recall, f1 = report_metrics(all_metrics, all_fails)

    print(f"\nPrecision: {precision:.3f}")
    print(f"Recall:    {recall:.3f}")
    print(f"F1:        {f1:.3f}")

    # Check targets
    targets_met = True
    if recall < 0.98:
        print("  ! TARGET NOT MET: recall < 0.98")
        targets_met = False
    if (1 - precision) > 0.04:
        print("  ! TARGET NOT MET: false positive rate > 4%")
        targets_met = False

    if targets_met:
        print("\nALL TARGETS MET ✓")


if __name__ == "__main__":
    main()