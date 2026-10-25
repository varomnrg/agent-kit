---
name: diagnosing-bugs
description: Diagnose a defect, failure, regression, or measured slowness through a red-capable witness, falsifiable hypotheses, root-cause isolation, and real-surface proof.
metadata:
  agent-kit:
    kind: primary
    requires: []
    optional: [codebase-design]
---

# Diagnosing bugs

Build evidence before a theory. Redact secrets and sensitive payloads from every
command, artifact, and report.

## 1. Build the witness

Create one agent-runnable command that reaches the reported behavior and can
discriminate this failure from success. Prefer, in order: focused test, HTTP or
CLI fixture, browser flow, captured replay, throwaway harness, property loop,
bisection, or differential run. Use `scripts/hitl-loop.template.sh` only when a
human action is irreducible.

Tighten it until it is as fast, deterministic, and symptom-specific as the
system permits. For a flaky failure, raise and pin the reproduction rate. If no
red-capable witness is possible, stop after listing attempted surfaces and the
specific evidence or access still needed.

**Completion:** name and show one command already run whose verdict represents
the user's exact symptom.

## 2. Reproduce and minimize

Run the witness red. Remove inputs, callers, configuration, and steps one at a
time, rerunning after each removal. Stop when every remaining element is
load-bearing.

## 3. Rank falsifiable hypotheses

Write three to five hypotheses as predictions: if a cause is true, one named
probe changes one expected observation. Rank them by existing evidence. Share
the list, but continue unless owner knowledge or authority is required.

## 4. Probe one variable at a time

Prefer debugger or REPL inspection, then narrow tagged instrumentation. For
performance, establish and vet a comparable baseline before optimizing. Never
replace a prediction with bulk logging.

## 5. Fix the earliest incorrect state

Turn the minimized witness into a regression test at a seam that represents the
real failure pattern. Run it red, apply the smallest root-cause fix, run it
green, then rerun the original witness. If no correct test seam exists, report
that architectural limitation rather than adding a proxy test.

## 6. Clean and prove

Remove tagged instrumentation and throwaway artifacts. Run the focused witness,
regression test, and relevant surrounding checks fresh. Report exact evidence,
residual uncertainty, and any untested surface. Never claim a fix from an agent
report, compilation alone, or a test that never demonstrated red capability.
