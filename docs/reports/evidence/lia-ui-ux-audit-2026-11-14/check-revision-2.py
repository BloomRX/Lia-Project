#!/usr/bin/env python3
"""Generate static evidence for revision 2 of the Lia UI/UX audit.

Documentary tooling only: reads Git/files, runs pure Node assertions, and writes
static-checks-revision-2.json. It does not install dependencies or start Lia.
"""
from __future__ import annotations

import hashlib
import json
import math
import platform
import re
import shutil
import subprocess
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[4]
EVIDENCE = Path(__file__).resolve().parent
REPORT = ROOT / "docs/reports/LIA-UI-UX-AUDIT-2026-11-14.md"
OUTPUT = EVIDENCE / "static-checks-revision-2.json"
BRANCH = "arena/250b337a-lia-project"
BASE = "7cb81720552a822a03f36ac6ce5f2e20b009f84c"
INITIAL_REF = "5ec464edf410008e390e2da4aff32d32537eb69d"
INITIAL_DELIVERY = "e183cba5c9882dbfc4e297c3550c6ebdc2f90b9a"
FIX = "f3facdf8f4ec8873221fe70b67e34934e2631496"
CURRENT_REF = "ae46c495d7da7cd33f4b4da8f4e8cc95b0a867b6"
MERGE = "1d802cc8229cb133710cb79601e8d58870b3fde8"
CHECKS: list[dict] = []


def run(args: list[str], *, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, cwd=ROOT, input=input_text, text=True, capture_output=True, check=False)


def git(*args: str) -> str:
    result = run(["git", *args])
    if result.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def add(name: str, ok: bool, detail: dict, command: str | None = None) -> None:
    item = {"name": name, "status": "PASS" if ok else "FAIL", "detail": detail}
    if command:
        item["command"] = command
    CHECKS.append(item)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def lines(revision: str, paths: list[str] | None = None) -> list[str]:
    args = ["diff", "--name-only", revision]
    if paths:
        args += ["--", *paths]
    result = git(*args)
    return result.splitlines() if result else []


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def source_check(path: str, snippets: dict[str, str]) -> dict:
    text = (ROOT / path).read_text(encoding="utf-8")
    found = {}
    missing = []
    for label, snippet in snippets.items():
        index = text.find(snippet)
        if index < 0:
            missing.append(label)
        else:
            found[label] = text.count("\n", 0, index) + 1
    return {"path": path, "sha256": sha256((ROOT / path).read_bytes()), "anchors": found, "missing": missing}


# Git synchronization and scope.
head = git("rev-parse", "HEAD")
branch = git("rev-parse", "--abbrev-ref", "HEAD")
merge_parents = git("show", "-s", "--format=%P", MERGE).split()
ancestor_results = {
    "initial_delivery": run(["git", "merge-base", "--is-ancestor", INITIAL_DELIVERY, "HEAD"]).returncode,
    "current_principal": run(["git", "merge-base", "--is-ancestor", CURRENT_REF, "HEAD"]).returncode,
    "merge": run(["git", "merge-base", "--is-ancestor", MERGE, "HEAD"]).returncode,
}
post_merge_delta = lines(f"{MERGE}..HEAD")
add("git-sync", branch == BRANCH and merge_parents == [INITIAL_DELIVERY, CURRENT_REF]
    and all(code == 0 for code in ancestor_results.values())
    and all(path.startswith("docs/reports/") for path in post_merge_delta),
    {"branch": branch, "head": head, "merge": MERGE, "merge_parents": merge_parents,
     "ancestor_exit_codes": ancestor_results, "post_merge_delta": post_merge_delta},
    "git rev-parse HEAD; git show -s --format=%P <merge>; git merge-base --is-ancestor <sha> HEAD")

initial_delta = lines(f"{BASE}..{INITIAL_REF}")
revision_delta = lines(f"{INITIAL_REF}..{CURRENT_REF}")
ui_paths = ["airi/apps/lia-app", "airi/apps/stage-tamagotchi", "airi/packages/ui",
            "airi/packages/i18n", "lia/core", "lia/assets", "docs/design",
            "docs/product/UX.md", "docs/BRAND-STANDARDS.md"]
ui_delta = lines(f"{INITIAL_REF}..{CURRENT_REF}", ui_paths)
stage_ui_delta = lines(f"{INITIAL_REF}..{CURRENT_REF}", ["airi/packages/stage-ui"])
expected_stage_ui = {
    "airi/packages/stage-ui/src/stores/ai/chat-llm/tool-name.ts",
    "airi/packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.test.ts",
    "airi/packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.ts",
    "airi/packages/stage-ui/src/stores/ai/chat-llm/tools.test.ts",
    "airi/packages/stage-ui/src/stores/ai/chat-llm/tools.ts",
    "airi/packages/stage-ui/src/stores/tool-call-rerun.ts",
}
add("principal-delta-scope", len(initial_delta) == 2 and len(revision_delta) == 9
    and not ui_delta and set(stage_ui_delta) == expected_stage_ui,
    {"initial_delta": initial_delta, "revision_delta": revision_delta,
     "ui_delta": ui_delta, "stage_ui_delta": stage_ui_delta},
    "git diff --name-only <base>..<reference> -- <paths>")

# Preserve the original visual deliverable and first-round evidence byte for byte.
preserved = {}
preservation_ok = True
for name in ["WIREFRAMES-LIA.html", "static-checks.json"]:
    path = EVIDENCE / name
    original = subprocess.check_output(["git", "show", f"{INITIAL_DELIVERY}:{relative(path)}"], cwd=ROOT)
    current = path.read_bytes()
    identical = original == current
    preservation_ok = preservation_ok and identical
    preserved[name] = {"identical_to_initial_delivery": identical, "sha256": sha256(current), "bytes": len(current)}
add("preserved-first-round-artifacts", preservation_ok, preserved,
    "git show e183cba:<artifact>; byte comparison")

# A-1 source anchors. This is code inspection, not a Vitest/runtime execution.
source_results = [
    source_check("airi/packages/stage-ui/src/stores/ai/chat-llm/tools.ts", {
        "enabled_map": "const enabledById = ref<Record<string, boolean>>({})",
        "default_enabled": "return enabledById.value[id] ?? true",
        "mutator": "function setToolEnabled(id: string, enabled: boolean): void",
        "execution_gate": "throw new ToolDisabledError(definition.id, definition.function.name)",
        "ambient_filter": ".filter(tool => tool.defaultActive !== false && isToolEnabled(tool.id))",
        "explicit_filter": "return definition && isToolEnabled(definition.id) ? [executableToolFrom(definition)] : []",
        "synced_state": "synced: {\n    state: true,",
    }),
    source_check("airi/packages/stage-ui/src/stores/chat.ts", {
        "send": "return llmToolsStore.getToolsByNames(...references.map(tool => tool.name))",
        "rerun": "customTools: llmToolsStore.getToolsByNames(payload.toolName),",
    }),
    source_check("airi/apps/stage-tamagotchi/src/renderer/stores/tools/built-in.ts", {
        "widget_refs": "export const widgetToolReferences = [",
        "artistry_refs": "export const artistryToolReferences = [",
        "ambient_off": "defaultActive: false,",
        "weather": "{ name: 'get_weather' },",
        "widgets": "{ name: 'stage_widgets' },",
        "journal": "{ name: 'image_journal' },",
    }),
    source_check("airi/packages/stage-ui/src/stores/ai/chat-llm/tool-resolver.ts", {
        "outside_store": "import { createSparkCommandTool, createWebSearchTools, debug, mcp } from '../../../tools'",
        "leaf_import": "import { toolNameFrom } from './tool-name'",
    }),
    source_check("airi/packages/stage-ui/src/stores/tool-call-rerun.ts", {
        "leaf_import": "import { toolNameFrom } from './ai/chat-llm/tool-name'",
        "injected_resolver": "const tools = await options.resolveTools()",
    }),
]
caller_result = run(["git", "grep", "-n", "setToolEnabled", "--", "airi", "lia",
                     ":!**/*.test.*", ":!**/*.spec.*"])
caller_lines = caller_result.stdout.splitlines()
only_store_definition = caller_result.returncode == 0 and all(
    line.startswith("airi/packages/stage-ui/src/stores/ai/chat-llm/tools.ts:") for line in caller_lines)
add("a1-gate-source", all(not item["missing"] for item in source_results) and only_store_definition,
    {"sources": source_results, "production_setToolEnabled_matches": caller_lines,
     "interpretation": "Gate present in source; no production caller outside store definition/export found. Persistence absence is also recorded by the Principal decision, not proven by grep alone.",
     "runtime_executed": False},
    "git grep -n setToolEnabled -- airi lia ':!**/*.test.*' ':!**/*.spec.*'")

decision = (ROOT / "docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md").read_text(encoding="utf-8")
decision_markers = ["opção (a)", "manter sob demanda", "UI de ativação", "persistência", "mcp()", "debug()"]
add("a1-decision-recorded", all(marker in decision for marker in decision_markers),
    {"path": "docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md", "markers": decision_markers,
     "missing": [marker for marker in decision_markers if marker not in decision]})

# Report structure, revision markers, language hygiene and local links.
report = REPORT.read_text(encoding="utf-8")
sections = re.findall(r"^## (\d+)\.", report, flags=re.MULTILINE)
deliverable_sections = [section for section in sections if section != "0"]
required_markers = [CURRENT_REF, INITIAL_REF, FIX, MERGE, "X-03", "X-04", "Corrigido", "HISTORICAL-PASS", "BLOCKED"]
cjk = re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", report)
trailing = [i for i, line in enumerate(report.splitlines(), 1) if line != line.rstrip()]
add("report-revision-structure", deliverable_sections == [str(i) for i in range(1, 12)]
    and all(marker in report for marker in required_markers) and not cjk and not trailing,
    {"sections": sections, "deliverable_sections": deliverable_sections, "required_markers": required_markers,
     "missing_markers": [marker for marker in required_markers if marker not in report],
     "cjk_count": len(cjk), "trailing_whitespace_lines": trailing, "lines": len(report.splitlines())})

broken_links = []
checked_links = []
for markdown in [REPORT, EVIDENCE / "README.md"]:
    text = markdown.read_text(encoding="utf-8")
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
        if target.startswith(("https://", "http://", "mailto:", "#")):
            continue
        path_part = unquote(target.split("#", 1)[0])
        resolved = (markdown.parent / path_part).resolve()
        checked_links.append({"from": relative(markdown), "target": target})
        if resolved == OUTPUT.resolve():
            continue  # This run generates the linked evidence file below.
        if not resolved.exists():
            broken_links.append({"from": relative(markdown), "target": target})
add("document-local-links", not broken_links, {"checked": len(checked_links), "broken": broken_links})

# Revalidate the preserved HTML without changing it.
class HtmlEvidence(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.hrefs: list[str] = []
        self.external: list[str] = []
        self.scripts = 0
        self.lang = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if values.get("id"):
            self.ids.add(values["id"])
        if tag == "a" and values.get("href"):
            self.hrefs.append(values["href"])
        if tag == "script":
            self.scripts += 1
        if tag == "html":
            self.lang = values.get("lang")
        for key in ("src", "href"):
            value = values.get(key) or ""
            if value.startswith(("http://", "https://", "//")):
                self.external.append(value)

html = (EVIDENCE / "WIREFRAMES-LIA.html").read_text(encoding="utf-8")
parser = HtmlEvidence()
parser.feed(html)
missing_anchors = [href for href in parser.hrefs if href.startswith("#") and href[1:] not in parser.ids]
missing_wires = [f"w{i}" for i in range(1, 9) if f"w{i}" not in parser.ids]
html_cjk = re.findall(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]", html)
add("preserved-html-structure", not missing_anchors and not missing_wires and not parser.external
    and parser.scripts == 0 and parser.lang == "pt-BR" and not html_cjk,
    {"wireframes": [f"W{i}" for i in range(1, 9)], "missing_wires": missing_wires,
     "missing_anchors": missing_anchors, "external_resources": parser.external,
     "scripts": parser.scripts, "lang": parser.lang, "cjk_count": len(html_cjk)})

# WCAG sRGB contrast calculations; truncate to four decimals, never round up.
def luminance(hex_color: str) -> float:
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return sum(weight * c for weight, c in zip((0.2126, 0.7152, 0.0722), linear))

pairs = [
    ("current_primary_light", "#ffffff", "#e545c8", 4.5, False),
    ("current_primary_darker", "#ffffff", "#b0359a", 4.5, True),
    ("proposed_action", "#ffffff", "#a62b90", 4.5, True),
    ("dark_text", "#f2ecf7", "#17111f", 4.5, True),
    ("dark_secondary_current", "#9b8db0", "#17111f", 4.5, True),
    ("dark_secondary_proposed", "#baadca", "#1f1629", 4.5, True),
    ("light_text", "#211726", "#ffffff", 4.5, True),
    ("light_secondary_proposed", "#5e526b", "#f2edf6", 4.5, True),
    ("decorative_border", "#32244a", "#17111f", 3.0, False),
]
contrast = []
for name, fg, bg, threshold, expected in pairs:
    lighter, darker = sorted((luminance(fg), luminance(bg)), reverse=True)
    ratio = (lighter + 0.05) / (darker + 0.05)
    truncated = math.floor(ratio * 10000) / 10000
    contrast.append({"name": name, "fg": fg, "bg": bg, "ratio": truncated,
                     "threshold": threshold, "expected_meets": expected, "meets": ratio >= threshold})
add("contrast-static-expectations", all(item["meets"] == item["expected_meets"] for item in contrast),
    {"pairs": contrast, "note": "sRGB hex; not rendered pixels; four-decimal truncation, no rounding up"})

# Pure view-model assertions against the unchanged Launcher source.
node_script = """
import assert from 'node:assert/strict'
import { firstRunChoicePayload, firstRunPanelVisible, homeAiChipVm, homeConversationLabelVm, homeBlockerHintVm } from './airi/apps/lia-app/src/renderer/src/views/home-vm.ts'
assert.deepEqual(firstRunChoicePayload('textOnly'), { update: { setup: { completed: true }, voice: { enabled: false } } })
assert.deepEqual(firstRunChoicePayload('complete'), { update: { setup: { completed: true }, voice: { enabled: true } } })
assert.deepEqual([undefined, {}, { completed: false }, { completed: true }].map(firstRunPanelVisible), [true, true, true, false])
assert.deepEqual(homeAiChipVm(undefined), { label: 'IA a configurar', variant: 'warning' })
assert.equal(homeConversationLabelVm(undefined), 'Conversar com Lia')
assert.match(homeBlockerHintVm({ ai: { ready: false } }), /aba Configuração/)
console.log('PASS 6')
"""
vm = run(["node", "--experimental-strip-types", "--input-type=module"], input_text=node_script)
add("home-vm-pure", vm.returncode == 0 and vm.stdout.strip() == "PASS 6",
    {"exit": vm.returncode, "stdout": vm.stdout.strip(), "stderr": vm.stderr.strip(), "assertions": 6},
    "node --experimental-strip-types --input-type=module <embedded pure assertions>")

# Historical evidence is explicitly separated from checks executed here.
historical_markers = ["13/13", "11/11", "7/7", "1/1", "f3facdf"]
CHECKS.append({"name": "principal-a1-tests", "status": "HISTORICAL-PASS" if all(m in decision for m in historical_markers) else "FAIL",
               "detail": {"source": "docs/reports/LIA-A1-TOOL-ENABLEMENT-2026-11-14.md", "reported_total": 31,
                          "reported_at": FIX, "executed_in_this_revision": False,
                          "llm_test": "NOT RUN/BLOCKED in the Principal report: stream-kit build missing"}})

missing_tools = {name: shutil.which(name) for name in ["pnpm", "chromium", "chromium-browser", "google-chrome", "xvfb-run", "agent-browser"]}
missing_modules = [path for path in ["node_modules", "airi/node_modules", "airi/packages/stage-ui/node_modules",
                                     "airi/apps/stage-tamagotchi/node_modules"] if not (ROOT / path).is_dir()]
CHECKS.append({"name": "runtime-browser-a11y-performance", "status": "BLOCKED",
               "detail": {"reason": "No Windows/display or authorized browser/runtime gate in this sandbox; no tools installed by this revision.",
                          "tool_paths": missing_tools, "absent_node_modules": missing_modules,
                          "not_tested": ["runtime", "screen-reader", "keyboard", "DPI", "multi-monitor", "C0-C4", "Vitest"]}})

working_changed = lines("HEAD")
untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
principal_to_head = lines(f"{CURRENT_REF}..HEAD")
add("document-only-authored-scope", all(path.startswith("docs/reports/") for path in working_changed + untracked + principal_to_head),
    {"working_changed": working_changed, "untracked": untracked, "principal_to_head": principal_to_head,
     "note": "The authorized merge imports Principal code; this revision authors only docs/reports changes."})

summary = {status: sum(item["status"] == status for item in CHECKS) for status in ["PASS", "FAIL", "HISTORICAL-PASS", "BLOCKED"]}
payload = {
    "schema": "lia-ui-ux-static-checks-revision/v1",
    "revision": 2,
    "date": "2026-11-14",
    "generated_at_utc": datetime.now(timezone.utc).isoformat(),
    "branch": BRANCH,
    "checkout_sha": head,
    "reference_sha": CURRENT_REF,
    "historical_reference_sha": INITIAL_REF,
    "initial_delivery_sha": INITIAL_DELIVERY,
    "merge_sha": MERGE,
    "environment": {"platform": platform.platform(), "python": platform.python_version(),
                    "node": run(["node", "--version"]).stdout.strip()},
    "summary": summary,
    "checks": CHECKS,
}
OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False))
print(relative(OUTPUT))
raise SystemExit(1 if summary["FAIL"] else 0)
