"""Contrato estrutural das skills do repositorio em .agents/skills/.

O Codex descobre skills em `.agents/skills/<nome>/SKILL.md`; a especificacao
exige frontmatter YAML com `name` e `description` e que o `name` case com o
nome do diretorio. O validador oficial (`npx skills-ref validate`) faz essa
checagem, mas exige rede. Este teste roda offline, na suite que ja existe, e
cobre o subconjunto de regras que o repositorio usa - sem dependencia nova e
sem YAML, porque o frontmatter aqui e simples de proposito.

Se uma skill passar a usar `metadata` ou `allowed-tools`, os valores precisam
continuar em uma linha; o parser ignora linhas indentadas como continuacao.

O objetivo nao e substituir o validador oficial: e impedir que uma edicao
quebre a descoberta sem ninguem perceber.
"""

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / '.agents' / 'skills'

#: Skills que precisam existir. Uma skill nova nao e obrigada a entrar aqui,
#: mas a remocao de uma destas quebra o contrato documentado em
#: docs/project/AGENT-SKILLS.md.
REQUIRED = {
    'airi-upstream-integration',
    'lia-agent-evaluation',
    'lia-regression-investigation',
    'lia-release-gate',
    'lia-test-discipline',
    'stage-runtime-debugging',
}

#: Campos do frontmatter aceitos pela especificacao do Agent Skills.
ALLOWED_KEYS = {
    'allowed-tools',
    'compatibility',
    'description',
    'license',
    'metadata',
    'name',
}

#: `name`: 1-64 caracteres, minusculas, digitos e hifen simples.
NAME_PATTERN = re.compile(r'^[a-z0-9]+(-[a-z0-9]+)*$')

PLACEHOLDERS = re.compile(r'\b(TODO|TBD|CHANGEME|FIXME|lorem ipsum|YOUR_[A-Z]+)\b',
                          re.IGNORECASE)

#: Caminho relativo do repositorio citado entre crases no corpo da skill.
DOC_REFERENCE = re.compile(r'`(docs/[^`\s]+\.md)`')


def parse_skill(path):
    """Devolve (frontmatter, corpo, numero de linhas do frontmatter)."""
    text = path.read_text(encoding='utf-8')
    lines = text.splitlines()
    if not lines or lines[0].strip() != '---':
        raise AssertionError(f'{path}: nao comeca com --- delimitando frontmatter')
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == '---')
    except StopIteration:
        raise AssertionError(f'{path}: frontmatter sem --- de fechamento')

    front = {}
    for raw in lines[1:end]:
        if not raw.strip() or raw[:1].isspace():
            # linha vazia ou continuacao de um bloco (ex.: metadata)
            continue
        key, sep, value = raw.partition(':')
        if not sep:
            raise AssertionError(f'{path}: linha de frontmatter sem dois-pontos: {raw!r}')
        front[key.strip()] = value.strip().strip('"').strip("'")
    return front, lines[end + 1:], end - 1


class AgentSkillsTests(unittest.TestCase):
    """Toda skill versionada tem que ser descobrivel e nao ter placeholder."""

    def skills(self):
        self.assertTrue(SKILLS.is_dir(), f'{SKILLS} nao existe')
        found = sorted(p for p in SKILLS.iterdir() if p.is_dir())
        self.assertTrue(found, 'nenhuma skill em .agents/skills')
        return found

    def test_required_skills_exist(self):
        present = {p.name for p in self.skills()}
        self.assertEqual(sorted(REQUIRED - present), [], 'skills obrigatorias ausentes')

    def test_every_skill_directory_has_skill_md(self):
        for directory in self.skills():
            self.assertTrue((directory / 'SKILL.md').is_file(),
                            f'{directory.name} nao tem SKILL.md')

    def test_frontmatter_is_valid(self):
        for directory in self.skills():
            with self.subTest(skill=directory.name):
                front, _body, _ = parse_skill(directory / 'SKILL.md')

                unknown = set(front) - ALLOWED_KEYS
                self.assertEqual(sorted(unknown), [],
                                 f'{directory.name}: campos fora da especificacao')

                name = front.get('name', '')
                self.assertTrue(name, f'{directory.name}: name ausente')
                self.assertLessEqual(len(name), 64, f'{directory.name}: name longo demais')
                self.assertRegex(name, NAME_PATTERN, f'{directory.name}: name invalido')
                self.assertEqual(name, directory.name,
                                 'name precisa ser igual ao nome do diretorio')

                description = front.get('description', '')
                self.assertTrue(description, f'{directory.name}: description ausente')
                self.assertLessEqual(len(description), 1024,
                                     f'{directory.name}: description acima de 1024')
                # A especificacao pede o que a skill faz E quando usar; e o
                # gatilho que faz o agente ativa-la sozinho.
                self.assertIn(' Use ', f' {description} ',
                              f'{directory.name}: description sem gatilho de uso')

                if 'compatibility' in front:
                    self.assertLessEqual(len(front['compatibility']), 500,
                                         f'{directory.name}: compatibility acima de 500')

    def test_body_is_usable_and_has_no_placeholder(self):
        for directory in self.skills():
            with self.subTest(skill=directory.name):
                _front, body, _ = parse_skill(directory / 'SKILL.md')
                text = '\n'.join(body).strip()
                self.assertTrue(text, f'{directory.name}: corpo vazio')
                self.assertLessEqual(len(body), 500,
                                     f'{directory.name}: SKILL.md acima de 500 linhas')
                leftover = PLACEHOLDERS.search(text)
                self.assertIsNone(leftover,
                                  f'{directory.name}: placeholder esquecido {leftover!r}')

    def test_referenced_docs_exist(self):
        """Uma skill que aponta para um documento inexistente manda o agente
        para o vazio. Referencias com `<` sao padroes de nome e ficam de fora."""
        for directory in self.skills():
            with self.subTest(skill=directory.name):
                text = (directory / 'SKILL.md').read_text(encoding='utf-8')
                for relative in sorted(set(DOC_REFERENCE.findall(text))):
                    if '<' in relative:
                        continue
                    self.assertTrue((ROOT / relative).is_file(),
                                    f'{directory.name}: referencia {relative} nao existe')


if __name__ == '__main__':
    unittest.main()
