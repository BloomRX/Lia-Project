#!/usr/bin/env python3
"""DevKit do Sprite Livre: Git seguro, sem template Godot ou credenciais embutidas.

A validação normal só verifica sintaxe/estrutura; não executa notebooks, instala
pacotes, inicia servidores nem baixa modelos. GitHub CLI é necessário somente
para criar o repositório privado ou abrir PR pelo menu.
"""
from __future__ import annotations

import argparse
import ast
from contextlib import contextmanager
import datetime as dt
import json
from html.parser import HTMLParser
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

KIT = Path(__file__).resolve().parent.parent
REMOTE = "origin"
BASE = "main"
PROTECTED = {"main", "master"}
MAX_FILE = 95 * 1024 * 1024  # abaixo do limite de arquivo do GitHub
MAX_TEXT_SCAN = 8 * 1024 * 1024
SKIP_DIRS = {
    ".git", "node_modules", ".venv", "venv", "__pycache__", ".cache", ".npm",
    ".next", ".nuxt", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".godot", ".ipynb_checkpoints",
    "dist", "build", "coverage", ".tox", ".turbo", "comfyui", "models", "checkpoints", "outputs", "resultados",
}
WEIGHT_EXTS = {".gguf", ".safetensors", ".ckpt", ".pt", ".pth", ".onnx"}
TEXT_EXTS = {".py", ".js", ".mjs", ".cjs", ".json", ".ipynb", ".html", ".md", ".txt", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".bat", ".gd", ".godot", ".css"}
KEY_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}"
    r"|hf_[A-Za-z0-9]{20,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}"
    r"|AKIA[0-9A-Z]{16})(?![A-Za-z0-9])"
)
PRIVATE_KEY_RE = re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----")
# Limites de palavra e valor literal: rebuildToken = 0 / token = os.getenv(...)
# NÃO são confundidos com segredos. Uma credencial literal ainda é sinalizada.
ASSIGN_RE = re.compile(
    r'''(?ix)(?<![\w]) ["']?
    (?:(?:github|gitlab|openai|godmode|fal|hf|access|auth|secret)[_-])?
    (?:api[_-]?key|api[_-]?token|access[_-]?token|auth[_-]?token|secret[_-]?key|token|password|passwd|client[_-]?secret)
    ["']? \s* [=:] \s* (["']) ([^\r\n"']{6,}) \1'''
)
PLACEHOLDER_RE = re.compile(r"(?i)(your[_ -]|seu[_ -]|sua[_ -]|example|exemplo|placeholder|changeme|change_me|replace[_ -]?me|not[_ -]?a[_ -]?real|dummy|token_aqui|chave_aqui)")


def redact(text: str) -> str:
    text = re.sub(r"(https?://)[^/\s@]+@", r"\1[CREDENCIAL-OCULTA]@", text)
    text = KEY_RE.sub("[CREDENCIAL-OCULTA]", text)
    return ASSIGN_RE.sub(lambda m: m.group(0)[:m.start(2)-m.start()] + "[CREDENCIAL-OCULTA]" + m.group(0)[m.end(2)-m.start():], text)


def run(args, cwd=None, check=True, capture=False, input_text=None, env_overrides=None):
    args = [str(x) for x in args]
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    if env_overrides: env.update(env_overrides)
    p = subprocess.run(args, cwd=cwd or KIT, text=True, encoding="utf-8",
                       errors="replace", capture_output=True, input=input_text, env=env)
    if not capture:
        if p.stdout.strip(): print(redact(p.stdout.rstrip()))
        if p.stderr.strip(): print(redact(p.stderr.rstrip()))
    if check and p.returncode:
        if capture and p.stderr.strip(): print(redact(p.stderr.rstrip()))
        raise RuntimeError("Falhou: " + redact(" ".join(args)) + "\nNenhum reset, clean ou force-push foi executado.")
    return p


def require(name):
    path = shutil.which(name)
    if not path: raise RuntimeError(f"Dependência ausente: {name}")
    return path


def root():
    require("git")
    p = run(["git", "rev-parse", "--show-toplevel"], capture=True, check=False)
    if p.returncode:
        raise RuntimeError("Esta pasta não está em um repositório Git. Para o primeiro cadastro, use a opção Criar repositório do menu; se ele já existe, abra a pasta clonada correta.")
    return Path(p.stdout.strip()).resolve()


def local_project_root():
    if shutil.which("git"):
        result = run(["git", "rev-parse", "--show-toplevel"], capture=True, check=False)
        if result.returncode == 0: return Path(result.stdout.strip()).resolve()
    return KIT


def branch(p):
    b = run(["git", "branch", "--show-current"], cwd=p, capture=True).stdout.strip()
    if not b: raise RuntimeError("HEAD destacado. Abra uma branch antes de continuar.")
    return b


def ensure_project(p):
    # Funciona com os fontes ou apenas com os entregáveis do kit, inclusive
    # quando o diretório sprite-livre foi mantido dentro do repositório.
    candidates = [KIT, p, p / "sprite-livre", p / "Sprite Livre"]
    for candidate in dict.fromkeys(candidates):
        if not candidate.is_dir(): continue
        if any((candidate / x).is_file() for x in ("package.json", "Sprite Livre.html", "Sprite_Livre_Colab.ipynb", "project.godot")):
            return candidate
        if (candidate / "src" / "app.mjs").is_file(): return candidate
    raise RuntimeError("Projeto não reconhecido. Esperado package.json, Sprite Livre.html ou notebook do Sprite Livre. project.godot NÃO é obrigatório.")


def git_busy(p):
    path = Path(run(["git", "rev-parse", "--git-dir"], cwd=p, capture=True).stdout.strip())
    if not path.is_absolute(): path = p / path
    markers = ("MERGE_HEAD", "REVERT_HEAD", "CHERRY_PICK_HEAD", "rebase-merge", "rebase-apply", "sequencer", "BISECT_LOG")
    return any((path / x).exists() for x in markers) or bool(git_names(p, ["diff", "--name-only", "--diff-filter=U"]))


def ensure_idle(p):
    if git_busy(p):
        raise RuntimeError("Há conflito, merge, rebase ou outra operação Git pendente. Use git status e resolva antes. Não fiz alterações.")


def git_names(p, args):
    out = run(["git", *args, "-z"], cwd=p, capture=True).stdout
    return [name for name in out.split("\0") if name]


def ignored_path(name):
    parts = Path(name).parts
    lower = tuple(part.lower() for part in parts)
    if any(part in SKIP_DIRS for part in lower): return True
    if any(lower[i:i+2] in (("tests", "artifacts"), ("colab", "comfyui"), ("colab", "resultados")) for i in range(max(0, len(lower)-1))): return True
    return Path(name).suffix.lower() in WEIGHT_EXTS


def sensitive_path(name):
    base = Path(name).name.lower()
    if base in {".env.example", ".env.sample", ".env.template", ".env.dist"}: return False
    return (base == ".env" or base.startswith(".env.")
            or base in {".netrc", "_netrc", ".git-credentials", "credentials.json", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa"}
            or base.startswith("client_secret") or base.startswith("service_account")
            or Path(base).suffix in {".p12", ".pfx", ".key"})


def project_files(p):
    for directory, dirs, files in os.walk(p, followlinks=False):
        dirs[:] = [d for d in dirs if not ignored_path(str((Path(directory) / d).relative_to(p))) and not (Path(directory) / d).is_symlink()]
        for name in files:
            path = Path(directory) / name
            rel = str(path.relative_to(p))
            if not ignored_path(rel) and not sensitive_path(rel) and not path.is_symlink(): yield path


def notebook_check(path):
    document = json.loads(path.read_text(encoding="utf-8-sig"))
    if document.get("nbformat") != 4 or not isinstance(document.get("cells"), list):
        raise ValueError("Notebook inválido: esperado nbformat 4 e lista de células.")
    skipped = 0
    for number, cell in enumerate(document["cells"], 1):
        if not isinstance(cell, dict) or cell.get("cell_type") not in {"code", "markdown", "raw"}:
            raise ValueError(f"Célula {number} inválida.")
        source = cell.get("source", "")
        if isinstance(source, list) and all(isinstance(x, str) for x in source): source = "".join(source)
        if not isinstance(source, str): raise ValueError(f"Fonte inválida na célula {number}.")
        if cell["cell_type"] != "code": continue
        try: ast.parse(source, filename=f"{path.name}:célula {number}")
        except SyntaxError:
            if any(line.lstrip().startswith(("%", "!", "?")) for line in source.splitlines()):
                skipped += 1  # comandos especiais IPython, nunca executados
            else: raise
    return skipped


class ScriptParser(HTMLParser):
    """Extrai scripts inline sem abrir o HTML ou executar JavaScript."""
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.scripts = []
        self.active = False
        self.module = False
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag != "script": return
        attrs = dict(attrs)
        kind = (attrs.get("type") or "").lower()
        self.active = not attrs.get("src") and kind in {"", "module", "text/javascript", "application/javascript"}
        self.module = kind == "module"
        self.parts = []

    def handle_data(self, data):
        if self.active: self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.active:
            self.scripts.append((self.module, "".join(self.parts)))
            self.active = False


def validate(p=None, full=False):
    p = p or local_project_root()
    project = ensure_project(p)
    python_count = js_count = html_count = notebooks = json_count = magic_count = 0
    node = shutil.which("node")
    js_missing = False
    for path in project_files(project):
        ext = path.suffix.lower()
        try:
            if ext == ".py":
                # ast.parse não escreve __pycache__ e não importa o código.
                ast.parse(path.read_text(encoding="utf-8-sig"), filename=str(path)); python_count += 1
            elif ext in {".js", ".mjs", ".cjs"}:
                if node:
                    run([node, "--check", str(path)], cwd=project, capture=True); js_count += 1
                else: js_missing = True
            elif ext == ".html":
                parser = ScriptParser()
                parser.feed(path.read_text(encoding="utf-8-sig")); parser.close()
                if parser.active: raise ValueError("Script HTML sem fechamento.")
                for module, source in parser.scripts:
                    if node:
                        command = [node, "--check"]
                        if module: command.append("--input-type=module")
                        run(command, cwd=project, capture=True, input_text=source); js_count += 1
                    else: js_missing = True
                html_count += 1
            elif ext == ".ipynb":
                magic_count += notebook_check(path); notebooks += 1
            elif ext == ".json":
                json.loads(path.read_text(encoding="utf-8-sig")); json_count += 1
        except (SyntaxError, ValueError, UnicodeError, OSError) as exc:
            # Não imprimir a linha de código: ela pode conter uma credencial.
            line = getattr(exc, "lineno", None)
            detail = f" na linha {line}" if line else ""
            raise RuntimeError(f"Arquivo inválido: {path.relative_to(project)}{detail} ({type(exc).__name__}).") from None
    print(f"Validação leve OK: {python_count} Python, {js_count} JS (incluindo inline), {html_count} HTML, {json_count} JSON, {notebooks} notebooks.")
    if js_missing: print("AVISO: Node.js não encontrado; a sintaxe JavaScript NÃO foi verificada. Isso não impede o Git.")
    if magic_count: print(f"AVISO: {magic_count} célula(s) IPython com comandos especiais tiveram apenas estrutura JSON verificada.")
    print("Não executei a IA, os notebooks, o build, o Godot nem instalações.")
    if not full: return
    count = 0
    test = project / "tests" / "core.test.mjs"
    if test.exists():
        node = require("node")
        if not (project / "node_modules" / "fflate").exists():
            raise RuntimeError("Para os testes completos, rode npm ci na pasta do package.json. Não instalo dependências automaticamente.")
        run([node, "--test", str(test)], cwd=project); count += 1
    test = project / "tests" / "configuration_test.py"
    if test.exists(): run([sys.executable, str(test)], cwd=project); count += 1
    checker = project / "tools" / "checkgd.py"
    if (project / "project.godot").exists() and checker.exists():
        run([sys.executable, str(checker)], cwd=project); count += 1
    if not count: print("Aviso: nenhuma suíte local reconhecida para --full.")
    print("Testes locais finalizados. Inferência em GPU e teste dentro do motor NÃO estão incluídos.")


def placeholder(value):
    return bool(PLACEHOLDER_RE.search(value) or value.startswith(("<", "${", "{{"))
                or set(value) <= set("*._-xX "))


def secret_in_text(text):
    if KEY_RE.search(text) or PRIVATE_KEY_RE.search(text): return True
    return any(not placeholder(match.group(2)) for match in ASSIGN_RE.finditer(text))


def json_strings(value):
    if isinstance(value, str): yield value
    elif isinstance(value, list):
        for item in value: yield from json_strings(item)
    elif isinstance(value, dict):
        for item in value.values(): yield from json_strings(item)


def check_blob(p, object_ref, rel, seen):
    if sensitive_path(rel): raise RuntimeError(f"Arquivo de credencial bloqueado: {rel}")
    if ignored_path(rel): raise RuntimeError(f"Arquivo gerado/peso de IA já no stage ou em commit a enviar: {rel}. Revise-o manualmente; não removi nada do Git.")
    obj = run(["git", "rev-parse", "--verify", object_ref], cwd=p, capture=True).stdout.strip()
    if obj in seen: return
    kind = run(["git", "cat-file", "-t", obj], cwd=p, capture=True).stdout.strip()
    if kind != "blob": return  # referência de submódulo, não seu conteúdo
    size = int(run(["git", "cat-file", "-s", obj], cwd=p, capture=True).stdout.strip())
    if size > MAX_FILE: raise RuntimeError(f"Arquivo acima de 95 MiB bloqueado: {rel}. Pesos e arquivos grandes não devem entrar neste repositório.")
    if size > MAX_TEXT_SCAN:
        if Path(rel).suffix.lower() in TEXT_EXTS:
            raise RuntimeError(f"Texto/notebook acima de 8 MiB: {rel}. Revise saídas embutidas antes de enviar; não pulei a varredura silenciosamente.")
        seen.add(obj); return
    text = run(["git", "cat-file", "blob", obj], cwd=p, capture=True).stdout
    found = secret_in_text(text)
    if not found and Path(rel).suffix.lower() in {".json", ".ipynb"}:
        try: found = any(secret_in_text(part) for part in json_strings(json.loads(text)))
        except (ValueError, RecursionError): pass
    if found: raise RuntimeError(f"Possível credencial em {rel}. Valor ocultado. Corrija e revise o stage/histórico local antes de enviar.")
    seen.add(obj)


def secrets(p):
    # Lê o índice do Git, não a cópia que pode ter sido alterada no disco.
    seen = set()
    for rel in git_names(p, ["diff", "--cached", "--name-only", "--diff-filter=ACMRT"]):
        check_blob(p, ":" + rel, rel, seen)


def outgoing_secrets(p):
    commits = run(["git", "rev-list", "--reverse", "HEAD", "--not", f"--remotes={REMOTE}"], cwd=p, capture=True).stdout.splitlines()
    seen = set()
    for commit in commits:
        names = git_names(p, ["diff-tree", "--root", "--no-commit-id", "--name-only", "--diff-filter=ACMRT", "-r", "-m", commit])
        for rel in dict.fromkeys(names): check_blob(p, commit + ":" + rel, rel, seen)
    print(f"Varredura: stage e {len(commits)} commit(s) ainda não publicados em {REMOTE}. Não substitui uma auditoria de segurança.")


def changes(p):
    unstaged = set(git_names(p, ["diff", "--name-only"]))
    staged = set(git_names(p, ["diff", "--cached", "--name-only"]))
    untracked = set(git_names(p, ["ls-files", "--others", "--exclude-standard"]))
    return unstaged | staged | untracked, unstaged | staged


def stage_project(p):
    secrets(p)
    names, tracked_changes = changes(p)
    selected, skipped = [], []
    for rel in sorted(names):
        path = p / rel
        if ignored_path(rel) or sensitive_path(rel):
            if rel in tracked_changes and (path.exists() or path.is_symlink()):
                raise RuntimeError(f"Alteração em arquivo gerado/sensível já controlado pelo Git: {rel}. Revise manualmente antes de sincronizar.")
            if rel not in tracked_changes:
                skipped.append(rel); continue
            # Remover um arquivo antes rastreado continua sendo permitido.
        if path.is_dir() and not path.is_symlink():
            raise RuntimeError(f"Submódulo/repositório aninhado com alteração: {rel}. Gerencie-o manualmente; não vou adicioná-lo como se fosse um arquivo do Sprite Livre.")
        if path.is_file() and not path.is_symlink() and path.stat().st_size > MAX_FILE:
            raise RuntimeError(f"Arquivo acima de 95 MiB: {rel}. Nenhum arquivo foi apagado.")
        selected.append(rel)
    if skipped:
        print("Fora do envio (permanecem no PC): " + ", ".join(skipped[:8]) + (" …" if len(skipped) > 8 else ""))
    if selected:
        run(["git", "--literal-pathspecs", "add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"],
            cwd=p, input_text="\0".join(selected) + "\0")
    secrets(p)


def config(p, key):
    result = run(["git", "config", "--get", key], cwd=p, capture=True, check=False)
    return result.stdout.strip() if result.returncode == 0 else ""


def target_branch(p, b):
    remote = config(p, f"branch.{b}.remote")
    merge = config(p, f"branch.{b}.merge")
    if remote and remote != REMOTE:
        raise RuntimeError(f"A branch rastreia {remote}, não {REMOTE}. Revise o upstream; não vou trocar de destino silenciosamente.")
    if merge:
        if not merge.startswith("refs/heads/"): raise RuntimeError("Upstream não é uma branch normal.")
        return merge[len("refs/heads/"):]
    return b


def has_ref(p, ref):
    return run(["git", "show-ref", "--verify", "--quiet", ref], cwd=p, capture=True, check=False).returncode == 0


def ensure_remote(p):
    result = run(["git", "remote", "get-url", REMOTE], cwd=p, capture=True, check=False)
    if result.returncode: raise RuntimeError("Remote origin não configurado. Clone/conecte o repositório antes de sincronizar. Não criei nenhum remote.")


def normalize_branch(name):
    name = name.strip().lstrip("* ").strip()
    for prefix in ("remotes/origin/", "origin/"):
        if name.startswith(prefix): name = name[len(prefix):]
    if not name or name == "HEAD" or name.startswith("-") or "->" in name or "@{" in name:
        raise RuntimeError("Nome de branch inválido. Use o nome, não a linha origin/HEAD -> origin/main.")
    if run(["git", "check-ref-format", "refs/heads/" + name], check=False, capture=True).returncode:
        raise RuntimeError("Nome de branch inválido.")
    return name


def sync(message=None, push=True):
    p = root(); ensure_project(p); ensure_idle(p)
    b = branch(p)
    destination = target_branch(p, b) if push else b
    if push and (b in PROTECTED or destination in PROTECTED):
        raise RuntimeError("Push direto para main/master bloqueado ANTES de alterar o projeto. Crie uma branch: DevKit.bat new-branch ajustes/sprite-livre. Depois use sync e pr.")
    if push: ensure_remote(p)
    print(f"Branch: {b}" + (f" → {REMOTE}/{destination}" if push else " (somente commit local)"))
    validate(p)
    stage_project(p)
    status = run(["git", "diff", "--cached", "--quiet"], cwd=p, check=False, capture=True).returncode
    if status not in (0, 1): raise RuntimeError("Não foi possível verificar o stage.")
    if status == 1:
        msg = message or "chore: sincroniza Sprite Livre " + dt.datetime.now().strftime("%Y-%m-%d %H:%M")
        run(["git", "diff", "--cached", "--stat"], cwd=p)
        run(["git", "commit", "-m", msg], cwd=p)
        print("Alterações salvas em commit LOCAL. Ainda não confirmei o envio.")
    else: print("Sem alterações novas para commit.")
    if not push:
        print("Commit local concluído; não fiz fetch, pull nem push."); return
    if run(["git", "rev-parse", "--verify", "HEAD"], cwd=p, capture=True, check=False).returncode:
        raise RuntimeError("Ainda não há nenhum commit para enviar.")
    print(f"Consultando {REMOTE}…")
    run(["git", "fetch", "--prune", REMOTE], cwd=p)
    remote_ref = f"refs/remotes/{REMOTE}/{destination}"
    if has_ref(p, remote_ref):
        print("Integrando atualizações remotas por rebase dos commits locais…")
        try: run(["git", "rebase", remote_ref], cwd=p)
        except RuntimeError:
            print("O commit local foi preservado. Use git status. Resolva o rebase ou use git rebase --abort; depois rode sync novamente. Nenhum push foi feito.")
            raise
        ensure_idle(p)
        validate(p)
    outgoing_secrets(p)
    print(f"Enviando somente HEAD para {REMOTE}/{destination}…")
    run(["git", "push", "--set-upstream", REMOTE, f"HEAD:refs/heads/{destination}"], cwd=p)
    print("Sincronização concluída: push confirmado pelo Git. A main não foi atualizada; use Pull Request.")


def pull():
    p = root(); ensure_project(p); ensure_idle(p)
    b = branch(p); destination = target_branch(p, b); ensure_remote(p)
    print(f"Baixando {REMOTE}/{destination} para {b} (sem commit das edições nem push)…")
    run(["git", "fetch", "--prune", REMOTE], cwd=p)
    ref = f"refs/remotes/{REMOTE}/{destination}"
    if not has_ref(p, ref):
        raise RuntimeError(f"A branch {REMOTE}/{destination} ainda não existe. Faça o primeiro sync em uma branch de trabalho, ou abra uma branch remota existente.")
    # Mantém o comportamento do utilitário original. Só integra a branch
    # explicitamente resolvida acima; não usa um pull.rebase remoto ambíguo.
    try:
        run(["git", "-c", "rebase.autoStash=true", "rebase", ref], cwd=p)
        ensure_idle(p)  # autostash pode deixar conflitos mesmo com exit code 0
    except RuntimeError:
        print("Pull não concluído. Consulte git status e git stash list. Não descartei alterações nem apliquei reset.")
        raise
    print("Atualização local concluída. Alterações locais, se havia, foram reaplicadas pelo Git. Nada foi enviado.")


def branches():
    p = root(); ensure_remote(p)
    run(["git", "fetch", "--prune", REMOTE], cwd=p)
    run(["git", "branch", "-a"], cwd=p)


def checkout(name):
    p = root(); ensure_project(p); ensure_idle(p); ensure_remote(p)
    name = normalize_branch(name)
    run(["git", "fetch", "--prune", REMOTE], cwd=p)
    local = has_ref(p, f"refs/heads/{name}")
    remote = has_ref(p, f"refs/remotes/{REMOTE}/{name}")
    if not local and not remote: raise RuntimeError(f"Branch não encontrada: {name}")
    names, tracked = changes(p)
    stash_oid = None
    if names:
        # Não colocar pesos de vários GB ou .env não rastreado num stash.
        eligible = sorted(n for n in names if not ignored_path(n) and not sensitive_path(n))
        blocked_tracked = [n for n in tracked if n not in eligible]
        if blocked_tracked:
            raise RuntimeError("Há arquivos gerados/sensíveis rastreados com alterações. Revise-os manualmente antes de trocar de branch: " + ", ".join(blocked_tracked[:8]))
        if any((p / n).is_dir() and not (p / n).is_symlink() for n in eligible):
            raise RuntimeError("Há submódulo/repositório aninhado com alterações. Um stash comum não garante guardar seu conteúdo; trate-o manualmente antes de trocar de branch.")
        if eligible:
            print("\nHá alterações locais. [1] Guardar em stash e trocar  [2] Mostrar status  [3] Cancelar")
            while True:
                choice = input("> ").strip()
                if choice == "2": run(["git", "status", "--short"], cwd=p); continue
                if choice == "3": print("Cancelado; nenhum arquivo alterado."); return
                if choice == "1":
                    old = branch(p)
                    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    run(["git", "--literal-pathspecs", "stash", "push", "--include-untracked", "-m", f"DevKit: {old} antes de abrir {name} ({stamp})", "--pathspec-from-file=-", "--pathspec-file-nul"],
                        cwd=p, input_text="\0".join(eligible) + "\0")
                    stash_oid = run(["git", "rev-parse", "refs/stash"], cwd=p, capture=True).stdout.strip()
                    break
                print("Escolha 1, 2 ou 3.")
        if len(eligible) != len(names): print("Modelos, caches e credenciais não rastreados ficaram no PC, fora do stash.")
    try:
        if local:
            run(["git", "switch", name], cwd=p)
            destination = target_branch(p, name)
            ref = f"refs/remotes/{REMOTE}/{destination}"
            if has_ref(p, ref): run(["git", "merge", "--ff-only", ref], cwd=p)
        else: run(["git", "switch", "--track", "-c", name, f"{REMOTE}/{name}"], cwd=p)
        print(f"Branch aberta: {name}")
    finally:
        if stash_oid:
            print(f"\nSeu stash foi preservado: {stash_oid}")
            print("Ele NÃO foi aplicado na nova branch. Volte à branch de origem e use:")
            print(f"  git stash apply --index {stash_oid}")
            print("apply mantém a cópia no stash. Remova-a manualmente só após conferir os arquivos.")


def new_branch(name):
    p = root(); ensure_project(p); ensure_idle(p)
    name = normalize_branch(name)
    if name in PROTECTED: raise RuntimeError("Escolha um nome de trabalho, por exemplo ajustes/sprite-livre.")
    if has_ref(p, f"refs/heads/{name}"): raise RuntimeError("A branch local já existe. Use checkout.")
    # --no-track evita herdar upstream=origin/main da branch de origem.
    run(["git", "switch", "--no-track", "-c", name], cwd=p)
    print(f"Branch criada: {name}. Alterações locais foram mantidas. Nenhum commit ou push foi feito.")


def pr():
    require("gh"); p = root(); ensure_idle(p)
    b = branch(p); destination = target_branch(p, b)
    if b in PROTECTED or destination in PROTECTED: raise RuntimeError("Abra uma branch de trabalho para criar o PR.")
    if b != destination: raise RuntimeError("O upstream tem outro nome. Crie esse PR manualmente no GitHub para não selecionar a branch errada.")
    if not has_ref(p, f"refs/remotes/{REMOTE}/{b}"): raise RuntimeError("Faça sync primeiro para publicar esta branch.")
    run(["gh", "pr", "create", "--base", BASE, "--head", b, "--fill"], cwd=p)
    print("PR solicitado. Esse comando não faz merge nem atualiza a main automaticamente.")


# O registro fica no diretório comum do Git, fora dos arquivos versionados.
# Ele sobrevive à troca de branch e à remoção acidental do remote origin.
CREATION_FILE = "devkit-repository.json"
CREATION_LOCK = "devkit-create.lock"
CREATION_PHASES = {"attempted", "created", "pushed", "complete"}


def repository_name(value):
    value = value.strip()
    if KEY_RE.search(value): raise RuntimeError("Esse valor parece uma credencial, não um nome de repositório. Não use token ou senha neste campo.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", value) or value.lower().endswith(".git"):
        raise RuntimeError("Nome inválido. Comece com letra/número e use até 100 letras, números, pontos, _ ou -. Não inclua URL, dono/nome ou o sufixo .git.")
    return value


def creation_paths(p):
    common = Path(run(["git", "rev-parse", "--git-common-dir"], cwd=p, capture=True).stdout.strip())
    if not common.is_absolute(): common = p / common
    return common / CREATION_FILE, common / CREATION_LOCK


def read_creation(p):
    path, _ = creation_paths(p)
    if not path.exists(): return None
    try:
        if path.is_symlink() or path.stat().st_size > 65536: raise ValueError()
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or data.get("version") != 1: raise ValueError()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", data["owner"]): raise ValueError()
        repository_name(data["name"])
        if type(data["owner_id"]) is not int or data["owner_id"] < 1: raise ValueError()
        if data["phase"] not in CREATION_PHASES: raise ValueError()
        if not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", data["head"]): raise ValueError()
        rid = data.get("repo_id")
        if rid is not None and (type(rid) is not int or rid < 1): raise ValueError()
        if data["phase"] != "attempted" and rid is None: raise ValueError()
        return data
    except (ValueError, TypeError, KeyError, OSError, RuntimeError):
        raise RuntimeError("Registro de criação inválido. A criação foi bloqueada por segurança; não apague o registro para tentar outro nome. Consulte o diagnóstico.") from None


def save_creation(p, data):
    path, _ = creation_paths(p)
    data["updated_at"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    # Gravação atômica e sincronizada ANTES de qualquer pedido de criação.
    fd, temporary = tempfile.mkstemp(prefix="devkit-state-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n"); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def creation_status(ignore_lock=False):
    """Somente inspeção local. Não chama GitHub nem inicializa o Git."""
    result = {"can_create": False, "can_resume": False, "root": None, "record": None, "reason": ""}
    try:
        if not shutil.which("git"):
            result["reason"] = "Instale o Git para verificar o vínculo do projeto."; return result
        probe = run(["git", "rev-parse", "--show-toplevel"], cwd=KIT, capture=True, check=False)
        if probe.returncode:
            markers = [d / ".git" for d in (KIT, *KIT.parents)]
            bare = run(["git", "rev-parse", "--git-dir"], cwd=KIT, capture=True, check=False)
            if any(x.exists() or x.is_symlink() for x in markers) or bare.returncode == 0:
                result["reason"] = "Há estrutura Git existente, mas não consegui confirmar uma pasta de trabalho válida. Criação bloqueada."; return result
            result.update(can_create=True, reason="Pasta ainda sem repositório Git."); return result
        p = Path(probe.stdout.strip()).resolve()
        result["root"] = p
        if p != KIT.resolve():
            result["reason"] = "Esta pasta está dentro de outro repositório. Coloque o DevKit na raiz correta; não criarei um repositório aninhado."; return result
        data = read_creation(p)
        result["record"] = data
        _, lock = creation_paths(p)
        if not ignore_lock and (lock.exists() or lock.is_symlink()):
            result["reason"] = "Há uma criação/retomada em andamento ou um bloqueio de execução anterior. Use o diagnóstico."; return result
        if data:
            target = f"{data['owner']}/{data['name']}"
            if data["phase"] == "complete":
                result["reason"] = f"Repositório já cadastrado: {target}. Nova criação desativada, mesmo sem origin."
            else:
                result.update(can_resume=True, reason=f"Configuração pendente de {target}. Só é permitido retomar o MESMO repositório.")
            return result
        remotes = run(["git", "remote"], cwd=p, capture=True).stdout.splitlines()
        if remotes:
            result["reason"] = "Já existe remote configurado (" + ", ".join(remotes) + "). Nova criação desativada."; return result
        refs = run(["git", "for-each-ref", "--format=%(refname)", "refs/remotes"], cwd=p, capture=True).stdout.strip()
        upstreams = run(["git", "config", "--get-regexp", r"^branch\..*\.remote$"], cwd=p, capture=True, check=False)
        if upstreams.returncode not in (0, 1): raise RuntimeError("Não consegui verificar os upstreams existentes.")
        if refs or any(line.rsplit(" ", 1)[-1] != "." for line in upstreams.stdout.splitlines()):
            result["reason"] = "Há referências/upstreams de um remote anterior. Revise o vínculo existente; não criarei outro repositório."; return result
        ensure_idle(p)
        result.update(can_create=True, reason="Git local sem remote e sem registro de publicação anterior.")
    except (RuntimeError, OSError) as exc:
        result["reason"] = str(exc)
    return result


def require_creation_allowed(ignore_lock=False):
    status = creation_status(ignore_lock)
    if not status["can_create"]: raise RuntimeError("Criar repositório indisponível: " + status["reason"])
    return status


@contextmanager
def creation_lock(p):
    _, path = creation_paths(p)
    try: fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise RuntimeError("Outra execução de criação/retomada está ativa, ou deixou um bloqueio. Não farei outro pedido ao GitHub.") from None
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(f"pid={os.getpid()}\n"); stream.flush(); os.fsync(stream.fileno())
        yield
    finally:
        path.unlink(missing_ok=True)


def gh_run(args, **kwargs):
    # Host fixo + OWNER/NAME explícito evitam herdar GH_HOST/GH_REPO de outra sessão.
    return run(["gh", *args], env_overrides={"GH_HOST": "github.com", "GH_PROMPT_DISABLED": "1"}, **kwargs)


def github_lookup(endpoint):
    """Só retorna ausência quando o servidor de fato respondeu HTTP 404.

    Falha de rede, autenticação ou rate limit NÃO significa 'repo não existe'.
    """
    response = gh_run(["api", "--hostname", "github.com", "--method", "GET", "--include", endpoint], capture=True, check=False)
    headers = list(re.finditer(r"(?m)^HTTP/\S+\s+(\d{3})[^\r\n]*\r?\n", response.stdout))
    if not headers:
        raise RuntimeError("Não consegui confirmar a resposta do GitHub. Confira rede e autenticação com gh auth status. Nenhuma ausência de repositório foi presumida.")
    status = int(headers[-1].group(1))
    if status == 404: return 404, None
    if status != 200 or response.returncode:
        raise RuntimeError(f"GitHub respondeu HTTP {status}. Verifique autenticação/permissões/rede; não vou criar nada com estado desconhecido.")
    body = response.stdout[headers[-1].end():].replace("\r\n", "\n").split("\n\n", 1)
    try:
        data = json.loads(body[1])
        if not isinstance(data, dict): raise ValueError()
    except (ValueError, IndexError):
        raise RuntimeError("Resposta inesperada do GitHub. Operação interrompida sem presumir que o repositório não existe.") from None
    return status, data


def github_identity():
    require("gh")
    status, account = github_lookup("user")
    if status != 200 or not account:
        raise RuntimeError("Autentique sua conta primeiro: gh auth login --hostname github.com")
    login = account.get("login", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}", login) or type(account.get("id")) is not int or account["id"] < 1:
        raise RuntimeError("Não consegui identificar com segurança a conta ativa do GitHub.")
    return account


def check_creation_account(data):
    account = github_identity()
    if account["login"].casefold() != data["owner"].casefold() or account["id"] != data["owner_id"]:
        raise RuntimeError("A conta ativa não é a usada no início da criação. Volte à conta correta; não criarei outro repositório em outra conta.")


def github_repo_info(data):
    target = f"{data['owner']}/{data['name']}"
    status, info = github_lookup("repos/" + target)
    if status != 200: raise RuntimeError(f"Não consegui localizar {target}. Não vou vincular outro repositório.")
    owner = info.get("owner") or {}
    if (info.get("full_name", "").casefold() != target.casefold() or info.get("private") is not True
            or owner.get("id") != data["owner_id"] or type(info.get("id")) is not int or info["id"] < 1):
        raise RuntimeError("Nome, conta ou privacidade do repositório não correspondem ao pedido. Envio bloqueado.")
    if info.get("archived") or info.get("disabled"): raise RuntimeError("Repositório arquivado/desativado. Não alterei suas configurações.")
    if data.get("repo_id") is not None and data["repo_id"] != info["id"]:
        raise RuntimeError("O ID do repositório mudou. Pode ter sido excluído e recriado. Não vou vincular/enviar automaticamente para outro repositório com o mesmo nome.")
    return info


def same_github_target(url, data):
    url = url.strip()
    match = re.fullmatch(r"https://github\.com/([^/\s]+)/([^/\s]+?)(?:\.git)?/?", url, re.I)
    if not match: match = re.fullmatch(r"git@github\.com:([^/\s]+)/([^/\s]+?)(?:\.git)?", url, re.I)
    if not match: match = re.fullmatch(r"ssh://git@github\.com(?::22)?/([^/\s]+)/([^/\s]+?)(?:\.git)?/?", url, re.I)
    return bool(match and match[1].casefold() == data["owner"].casefold() and match[2].casefold() == data["name"].casefold())


def expected_origin(p, data, add=False):
    names = run(["git", "remote"], cwd=p, capture=True).stdout.splitlines()
    if not names and add:
        url = f"https://github.com/{data['owner']}/{data['name']}.git"
        run(["git", "remote", "add", REMOTE, url], cwd=p)
        names = [REMOTE]
    if names != [REMOTE]:
        raise RuntimeError("Esperado somente origin para concluir o primeiro envio. Não vou adicionar/substituir outro remote.")
    fetch = run(["git", "remote", "get-url", "--all", REMOTE], cwd=p, capture=True).stdout.splitlines()
    push = run(["git", "remote", "get-url", "--push", "--all", REMOTE], cwd=p, capture=True).stdout.splitlines()
    if len(fetch) != 1 or len(push) != 1 or not all(same_github_target(url, data) for url in fetch + push):
        raise RuntimeError("origin/fetch/push não apontam exclusivamente para o repositório confirmado. Não vou substituir URLs nem enviar para outro destino.")
    return push[0]


def confirm_target(verb, data, extra):
    target = f"{data['owner']}/{data['name']}"
    print(f"\nConta: {data['owner']} | Repositório: {data['name']} | Visibilidade: PRIVADO")
    print(f"Pasta: {KIT}\nPrimeira branch remota: {BASE}")
    print(extra)
    expected = f"{verb} {target}"
    if input(f"Digite exatamente {expected} para confirmar (Enter cancela):\n> ").strip() != expected:
        print("Cancelado. Nenhuma criação, commit ou push foi iniciado por esta confirmação."); return False
    return True


def prepare_first_commit(p):
    ensure_idle(p)
    current = branch(p)
    if current != BASE:
        if has_ref(p, f"refs/heads/{BASE}"):
            raise RuntimeError("Já existe uma main local, mas outra branch está aberta. Selecione a main desejada antes da criação; não vou escolher/trocar seu histórico automaticamente.")
        # Parte do HEAD atual, mantendo a branch anterior e as edições no disco.
        run(["git", "switch", "--no-track", "-c", BASE], cwd=p)
    stage_project(p)
    changed = run(["git", "diff", "--cached", "--quiet"], cwd=p, capture=True, check=False).returncode
    if changed not in (0, 1): raise RuntimeError("Não consegui verificar o stage para o primeiro commit.")
    if changed:
        run(["git", "diff", "--cached", "--stat"], cwd=p)
        run(["git", "commit", "-m", "chore: inicia Sprite Livre"], cwd=p)
    head = run(["git", "rev-parse", "--verify", "HEAD"], cwd=p, capture=True, check=False)
    if head.returncode: raise RuntimeError("Não há arquivos/commit elegíveis para publicar. Nada foi criado no GitHub.")
    outgoing_secrets(p)  # examina também o histórico local anterior ao wizard
    return head.stdout.strip()


def remote_heads(p, url):
    result = run(["git", "ls-remote", "--heads", "--tags", url], cwd=p, capture=True)
    refs = {}
    for line in result.stdout.splitlines():
        parts = line.split("\t", 1)
        if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{40}|[0-9a-f]{64}", parts[0]):
            raise RuntimeError("Resposta inesperada do Git ao consultar o destino. Não vou enviar com estado desconhecido.")
        refs[parts[1]] = parts[0]
    return refs


def finish_first_push(p, data):
    """Nunca cria outro repo; publica só o commit registrado e nunca força push."""
    info = github_repo_info(data)
    data["repo_id"] = info["id"]
    if data["phase"] == "attempted": data["phase"] = "created"
    save_creation(p, data)
    url = expected_origin(p, data, add=True)
    refs = remote_heads(p, url)
    main_ref = f"refs/heads/{BASE}"
    if refs:
        if main_ref not in refs:
            raise RuntimeError("O destino já tem conteúdo diferente, sem a main inicial esperada. Não fiz push nem sobrescrevi o repositório.")
        # Recupera o caso: o push funcionou, mas faltou gravar a confirmação
        # local. Commits remotos posteriores não são sobrescritos.
        run(["git", "fetch", "--no-tags", "--recurse-submodules=no", url, f"+refs/heads/{BASE}:refs/remotes/{REMOTE}/{BASE}"], cwd=p)
        done = False
        if main_ref in refs and has_ref(p, f"refs/remotes/{REMOTE}/{BASE}"):
            result = run(["git", "merge-base", "--is-ancestor", data["head"], f"refs/remotes/{REMOTE}/{BASE}"], cwd=p, capture=True, check=False)
            done = result.returncode == 0
        if not done:
            raise RuntimeError("O destino já tem conteúdo diferente do primeiro commit registrado. Não fiz push nem sobrescrevi o repositório. Revise-o manualmente.")
        print("O primeiro commit já está no GitHub; não vou enviá-lo de novo.")
    else:
        if data["phase"] == "pushed":
            raise RuntimeError("O registro diz que já houve envio, mas o destino agora está vazio. Não recriarei conteúdo automaticamente.")
        if branch(p) != BASE or run(["git", "rev-parse", "HEAD"], cwd=p, capture=True).stdout.strip() != data["head"]:
            raise RuntimeError("A branch/commit local mudou desde o início. O envio foi interrompido para não publicar outra versão sem confirmação. Preserve seu trabalho e revise o diagnóstico.")
        outgoing_secrets(p)
        github_repo_info(data)  # reconfirma ID, conta e privacidade antes do envio
        print("Enviando o primeiro commit registrado para main (exceção única de inicialização)…")
        # URL efetiva verificada + SHA fixo: não segue um pushurl inesperado e
        # não inclui edições/commits feitos depois do início da criação.
        run(["git", "push", "--no-follow-tags", url, f"{data['head']}:{main_ref}"], cwd=p)
        if remote_heads(p, url).get(main_ref) != data["head"]:
            raise RuntimeError("O Git terminou o envio, mas não consegui confirmar o commit remoto. Use Retomar; não crie outro repo.")
        data["phase"] = "pushed"; save_creation(p, data)
        if info.get("default_branch") != BASE:
            gh_run(["repo", "edit", f"{data['owner']}/{data['name']}", "--default-branch", BASE], cwd=p)
        run(["git", "fetch", "--no-tags", "--recurse-submodules=no", url, f"+refs/heads/{BASE}:refs/remotes/{REMOTE}/{BASE}"], cwd=p)
    # Só altera o vínculo local depois de conferir novamente o destino.
    expected_origin(p, data)
    run(["git", "branch", f"--set-upstream-to={REMOTE}/{BASE}", BASE], cwd=p)
    data["phase"] = "complete"; save_creation(p, data)
    print(f"\nRepositório privado pronto: https://github.com/{data['owner']}/{data['name']}")
    print("Primeiro envio confirmado. A opção Criar repositório não aparecerá mais para este projeto.")
    print("Próximas alterações: new-branch, sync e pr. Push normal para main/master continua bloqueado.")


def request_repository(p, data):
    # OWNER/NAME fixo, sem --source, --clone ou --push: só a criação remota.
    # O registro 'attempted' JÁ deve estar no disco antes de entrar aqui.
    check_creation_account(data)
    gh_run(["repo", "create", f"{data['owner']}/{data['name']}", "--private", "--description", "Sprite Livre — ferramenta pessoal de animações 2D"], cwd=p)
    finish_first_push(p, data)


def create_repo(name=None):
    require_creation_allowed()
    ensure_project(KIT)
    account = github_identity()
    if name is None: name = input("Nome do repositório [sprite-livre]: ").strip() or "sprite-livre"
    name = repository_name(name)
    target = f"{account['login']}/{name}"
    code, _ = github_lookup("repos/" + target)
    if code != 404:
        raise RuntimeError(f"{target} já existe. Não criei outro nome, não vinculei nem sobrescrevi esse repositório. Abra/clone o repo existente ou revise a escolha conscientemente.")
    data = {"version": 1, "owner": account["login"], "owner_id": account["id"], "name": name, "phase": "attempted", "repo_id": None}
    if not confirm_target("CRIAR", data, "Vou usar os arquivos atuais, criar/usar uma main local, salvar o commit e fazer SOMENTE o primeiro envio. Não apago o projeto nem crio um template Godot."): return
    require_creation_allowed()  # a configuração pode ter mudado durante o prompt
    validate(KIT)
    status = require_creation_allowed()
    p = KIT.resolve()
    if status["root"] is None: run(["git", "init", "-b", BASE], cwd=p)
    with creation_lock(p):
        require_creation_allowed(ignore_lock=True)
        data["head"] = prepare_first_commit(p)
        # Reconfirma ausência depois da preparação local. Não interpreta
        # HTTP 401/403/429 ou falha de rede como 'nome disponível'.
        check_creation_account(data)
        code, _ = github_lookup("repos/" + target)
        if code != 404: raise RuntimeError(f"{target} passou a existir. Nenhum pedido de criação/envio foi feito; não tentei outro nome.")
        require_creation_allowed(ignore_lock=True)
        save_creation(p, data)
        try: request_repository(p, data)
        except (RuntimeError, OSError, KeyboardInterrupt):
            print("\nA configuração não foi concluída. O pedido pode ter chegado ao GitHub.")
            print("Seu commit e o nome escolhido ficaram registrados. Criar outro repo está bloqueado; use a opção Retomar o MESMO repositório.")
            raise


def resume_repo():
    status = creation_status()
    if not status["can_resume"]: raise RuntimeError("Retomada indisponível: " + status["reason"])
    p, data = status["root"], status["record"]
    ensure_idle(p); check_creation_account(data)
    target = f"{data['owner']}/{data['name']}"
    code, _ = github_lookup("repos/" + target)
    if code == 404:
        if data.get("repo_id") is not None or data["phase"] != "attempted":
            raise RuntimeError("Este repositório já tinha sido confirmado e agora não está acessível. Não vou recriá-lo. Verifique a conta, permissões ou exclusão no GitHub.")
        verb = "TENTAR"
        text = "O GitHub respondeu 404. Se confirmar, repetirei o pedido APENAS para o MESMO dono/nome registrado; nunca criarei outro nome automaticamente. Confira sua conta antes."
    else:
        verb = "RETOMAR"
        text = f"Vou conferir/vincular o mesmo repositório e concluir o envio do commit {data['head'][:12]}. Não criarei outro repositório."
    if not confirm_target(verb, data, text): return
    with creation_lock(p):
        current = read_creation(p)
        if current != data or current["phase"] == "complete": raise RuntimeError("O registro mudou durante a confirmação. Reabra o menu; não repeti a operação.")
        ensure_idle(p); check_creation_account(data)
        # Um remote diferente bloqueia inclusive as tentativas por comando.
        names = run(["git", "remote"], cwd=p, capture=True).stdout.splitlines()
        if names: expected_origin(p, data)
        code, _ = github_lookup("repos/" + target)
        try:
            if code == 404:
                if verb != "TENTAR" or data.get("repo_id") is not None: raise RuntimeError("Estado remoto mudou. Não vou criar nada sem uma confirmação específica.")
                if branch(p) != BASE or run(["git", "rev-parse", "HEAD"], cwd=p, capture=True).stdout.strip() != data["head"]:
                    raise RuntimeError("O commit inicial mudou. Retomada interrompida antes de criar/enviar qualquer coisa.")
                outgoing_secrets(p)
                request_repository(p, data)
            else:
                finish_first_push(p, data)
        except (RuntimeError, OSError, KeyboardInterrupt):
            print("Retomada interrompida. O destino continua fixo no registro; nenhum nome alternativo foi criado.")
            raise


def diagnose():
    print(f"Python: {sys.version.split()[0]} ({sys.executable})")
    for name in ("git", "node", "gh"): print(f"{name}: {shutil.which(name) or 'NÃO ENCONTRADO'}")
    try:
        p = root(); print(f"Repositório: {p}"); print(f"Branch: {branch(p)}")
        r = run(["git", "remote", "get-url", REMOTE], cwd=p, capture=True, check=False)
        print("origin: " + (redact(r.stdout.strip()) if r.returncode == 0 else "NÃO CONFIGURADO"))
        print("Operação Git pendente:", "sim" if git_busy(p) else "não")
    except RuntimeError as exc: print(str(exc))
    if shutil.which("gh"): run(["gh", "auth", "status"], check=False)
    status = creation_status()
    print("Cadastro GitHub:", redact(status["reason"]))
    if status["root"]:
        state_file, lock_file = creation_paths(status["root"])
        print(f"Registro local: {state_file}\nBloqueio de execução: {lock_file}")
    print("Node.js é opcional para Git; GitHub CLI é necessário para criar repo/PR pelo menu.")


def menu():
    while True:
        status = creation_status()
        print("\n=== SPRITE LIVRE · DEVKIT ===\n1 Sincronizar: validar, commit, rebase e push\n2 Somente baixar (pull)\n3 Validar sintaxe/estrutura (sem executar IA)\n4 Listar branches\n5 Abrir branch existente\n6 Criar Pull Request para main\n7 Diagnóstico\n8 Criar nova branch de trabalho")
        if status["can_create"]: print("9 Criar repositório PRIVADO no GitHub e fazer o primeiro envio")
        elif status["can_resume"]: print("10 Retomar configuração do MESMO repositório (sem escolher outro nome)")
        print("0 Sair")
        print("Cadastro:", redact(status["reason"]))
        try:
            op = input("> ").strip()
            if op == "1": sync(input("Mensagem (Enter = automática): ").strip() or None)
            elif op == "2": pull()
            elif op == "3": validate()
            elif op == "4": branches()
            elif op == "5": checkout(input("Nome da branch: ").strip())
            elif op == "6": pr()
            elif op == "7": diagnose()
            elif op == "8": new_branch(input("Nova branch (ex.: ajustes/sprite-livre): ").strip())
            elif op == "9": create_repo()
            elif op == "10": resume_repo()
            elif op == "0": return
            else: print("Opção inválida.")
        except RuntimeError as exc: print("ERRO:", redact(str(exc)))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd")
    for name in ("sync", "push"):
        item = sub.add_parser(name, help="valida, cria commit local, integra atualizações e envia")
        item.add_argument("--message", "-m")
        item.add_argument("--no-push", action="store_true", help="somente commit local; sem acesso ao remote")
    sub.add_parser("pull", help="integra a branch atual; não faz commit das edições nem push")
    item = sub.add_parser("validate"); item.add_argument("--full", action="store_true", help="executa as suítes locais reconhecidas, nunca a IA")
    sub.add_parser("branches")
    item = sub.add_parser("checkout"); item.add_argument("name")
    item = sub.add_parser("new-branch"); item.add_argument("name")
    item = sub.add_parser("create-repo", help="primeiro cadastro privado; exige ausência de remote/registro e confirmação digitada")
    item.add_argument("name", nargs="?")
    sub.add_parser("resume-repo", help="retoma somente o dono/nome registrados; nunca escolhe outro repo")
    sub.add_parser("pr"); sub.add_parser("diagnose")
    args = parser.parse_args()
    try:
        if args.cmd in ("sync", "push"): sync(args.message, not args.no_push)
        elif args.cmd == "pull": pull()
        elif args.cmd == "validate": validate(full=args.full)
        elif args.cmd == "branches": branches()
        elif args.cmd == "checkout": checkout(args.name)
        elif args.cmd == "new-branch": new_branch(args.name)
        elif args.cmd == "create-repo": create_repo(args.name)
        elif args.cmd == "resume-repo": resume_repo()
        elif args.cmd == "pr": pr()
        elif args.cmd == "diagnose": diagnose()
        else: menu()
    except (RuntimeError, OSError, EOFError) as exc:
        print("ERRO:", redact(str(exc))); return 1
    except KeyboardInterrupt:
        print("\nInterrompido. Confira git status antes de retomar; não fiz limpeza automática."); return 130
    return 0


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(errors="replace")
    raise SystemExit(main())
