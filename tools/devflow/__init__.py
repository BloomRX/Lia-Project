"""DevFlow: Lia-specific, round-aware development orchestration (Phase DEVFLOW-D1).

Deliberately separate from `tools/project_cli.py`, which holds the universal
Git safety primitives. DevFlow reads Git facts and never mutates them; Git
publish consolidation is a D2 concern.
"""
