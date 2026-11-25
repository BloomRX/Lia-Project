// Historical inventory for injected test runners using temporary repositories.
import nodePath from 'node:path'
import { REPO_ROOT } from './qa-shared.mjs'

export function canonicalCommands(repoRoot = REPO_ROOT) {
  const workspace = nodePath.join(repoRoot, 'workspace')
  const base = [
    {
      id: 'core-agent',
      label: 'Core Agent',
      cwd: workspace,
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', '@fixture/core-agent'],
      mandatory: true,
    },
    {
      id: 'lia-core',
      label: 'Lia Core',
      cwd: nodePath.join(workspace, '..', 'lia', 'runtime'),
      argv: ['pnpm', 'test'],
      mandatory: true,
    },
    {
      id: 'browser',
      label: 'Browser Stage',
      cwd: nodePath.join(workspace, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run', '--project', 'browser'],
      mandatory: true,
    },
    {
      id: 'lint',
      label: 'Lint',
      cwd: workspace,
      argv: ['pnpm', 'lint'],
      mandatory: true,
    },
    {
      id: 'typecheck',
      label: 'Typecheck',
      cwd: workspace,
      argv: ['pnpm', 'typecheck'],
      mandatory: true,
    },
    {
      id: 'build-packages',
      label: 'Build packages',
      cwd: workspace,
      argv: ['pnpm', 'run', 'build:packages'],
      mandatory: true,
    },
    {
      id: 'stage-vitest',
      label: 'Stage full',
      cwd: nodePath.join(workspace, 'apps', 'stage-tamagotchi'),
      argv: ['pnpm', 'exec', 'vitest', 'run'],
      mandatory: true,
    },
    {
      id: 'stage-ui',
      label: 'Stage UI',
      cwd: workspace,
      argv: ['pnpm', 'run', 'test-ui:run'],
      mandatory: true,
    },
  ]
  return base
}
