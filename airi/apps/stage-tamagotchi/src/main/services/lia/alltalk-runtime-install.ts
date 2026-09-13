import type { LiaRuntimeInstallStep } from '../../../shared/eventa'

import { CUSTOM_VOICE_PROVIDER_ID } from '../../../shared/lia-voice'

/**
 * The guided install wizard, and the decision of when to autostart.
 *
 * Split out from `alltalk-runtime-service.ts` for the same reason
 * `alltalk-runtime-config.ts` exists: this file imports no Electron, so the
 * decisions it encodes can be tested directly.
 *
 * ## Why install is a wizard and not a download
 *
 * This was audited before being written, and the answer was no. AllTalk has no
 * official binary release for v2: the documented install is a `git clone` of the
 * `alltalkbeta` branch followed by `atsetup.bat`, which is *interactive* (it asks
 * the user to pick "Standalone Installation", then option 1). Its prerequisites -
 * Git, Microsoft C++ Build Tools with the Windows SDK, espeak-ng - are separate
 * installs needing an administrator. There is no versioned, checksummed artifact
 * to fetch, so nothing to verify integrity against.
 *
 * Automating that would mean driving an installer never designed to be driven,
 * and shipping a downloader with no way to check what it fetched. So the Lia
 * walks the user through it instead.
 *
 * The steps below are data, not code. If a future release ships a portable
 * archive with a stable URL and a published checksum, this list is the first
 * thing to replace.
 */
export const INSTALL_STEPS: LiaRuntimeInstallStep[] = [
  {
    id: 'git',
    title: 'Install Git',
    detail: 'AllTalk is distributed through Git. Install it, then restart your computer.',
    link: 'https://git-scm.com/download/win',
    done: false,
  },
  {
    id: 'build-tools',
    title: 'Install Microsoft C++ Build Tools',
    detail: 'Select "Desktop development with C++", which includes the Windows SDK.',
    link: 'https://alltalkdocumentation.readthedocs.io/en/latest/installing_windows_standalone.html',
    done: false,
  },
  {
    id: 'espeak',
    title: 'Install espeak-ng',
    detail: 'Needed for phoneme conversion. Choose the 64-bit installer.',
    link: 'https://alltalkdocumentation.readthedocs.io/en/latest/installing_espeakng.html',
    done: false,
  },
  {
    id: 'download',
    title: 'Download AllTalk',
    detail: 'Clone or download the alltalkbeta branch. Pick a folder with no spaces or hyphens in its path, and leave about 24 GB free.',
    link: 'https://github.com/erew123/alltalk_tts',
    done: false,
  },
  {
    id: 'setup',
    title: 'Run the AllTalk setup',
    detail: 'Open atsetup.bat and choose "Standalone Installation", then option 1. It finishes at around 10 GB.',
    done: false,
  },
  {
    id: 'point-lia',
    title: 'Show the Lia where it is',
    detail: 'Use "Choose folder" below and select the AllTalk folder you just installed.',
    done: false,
  },
]

/**
 * Builds the wizard, marking a step done when the evidence for it is in hand.
 *
 * Only the last step is detectable from inside the app. The prerequisites stay
 * unchecked rather than being guessed at - claiming progress the user did not
 * make is worse than asking them to confirm it.
 */
export function buildInstallSteps(params: { installed: boolean, installDirConfigured: boolean }): LiaRuntimeInstallStep[] {
  return INSTALL_STEPS.map(step => ({
    ...step,
    // A chosen folder that is not actually an install is a mistake, not progress.
    done: step.id === 'point-lia' ? params.installDirConfigured && params.installed : false,
  }))
}

/**
 * Whether the persisted voice selection needs the local runtime.
 *
 * Only a custom voice qualifies: starting the server for a built-in voice would
 * spend minutes of boot time and gigabytes of RAM on something the user will
 * never call.
 */
export function shouldAutostartRuntime(preferred: { providerId?: string } | undefined): boolean {
  return preferred?.providerId === CUSTOM_VOICE_PROVIDER_ID
}
