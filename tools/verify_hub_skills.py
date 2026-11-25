"""Verify materialized Agent Hub Skill trees against the committed pins."""

import hashlib
import json
import stat
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def checked_stat(path):
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
        raise ValueError(f"Link ou reparse point: {path}")
    return info


def file_hashes(directory):
    if not stat.S_ISDIR(checked_stat(directory).st_mode):
        raise ValueError(f"Diretório de Skill inválido: {directory}")
    for child in directory.iterdir():
        mode = checked_stat(child).st_mode
        if stat.S_ISDIR(mode):
            yield from file_hashes(child)
        elif stat.S_ISREG(mode):
            with child.open("rb") as stream:
                yield child, hashlib.file_digest(stream, "sha256").hexdigest()
        else:
            raise ValueError(f"Arquivo especial: {child}")


def verify(directory, lock):
    pin = json.loads(lock.read_text(encoding="utf-8"))
    if pin["lockVersion"] != 1 or pin["profile"] != "lia-project":
        raise ValueError(f"Manifesto incompatível: {lock}")
    for ancestor in reversed(directory.relative_to(ROOT).parents):
        checked_stat(ROOT / ancestor)
    entries = {path.relative_to(directory).as_posix(): digest
               for path, digest in file_hashes(directory)}
    if "SKILL.md" not in entries:
        raise ValueError(f"SKILL.md ausente: {directory}")
    tree = hashlib.sha256()
    for name, digest in sorted(entries.items()):
        tree.update(f"{name}\0{digest}\n".encode("utf-8"))
    if tree.hexdigest() != pin["treeSha256"]:
        raise ValueError(f"Árvore divergente do manifesto: {directory}")


def main():
    tools = ROOT / "tools"
    entries = [(ROOT / ".agents/skills/lia-eventa-ipc",
                tools / "hub-eventa-skill.lock.json")]
    airi_locks = sorted((tools / "hub-airi-skills").glob("*.json"))
    if not airi_locks:
        raise ValueError("Nenhum manifesto AIRI encontrado.")
    entries.extend((ROOT / ".agents/upstream-reference/skills" / lock.stem, lock) for lock in airi_locks)
    for directory, lock in entries:
        verify(directory, lock)
    print(f"{len(entries)} Skills conferidas contra os manifestos.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError) as exc:
        raise SystemExit(str(exc)) from exc
