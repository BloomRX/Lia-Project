/* eslint-disable no-template-curly-in-string */

/** Windows product installer. Stage is packaged independently before this step. */
export default {
  appId: 'ai.lia.launcher',
  productName: 'Lia',
  electronVersion: '43.4.1',
  directories: { output: 'dist/windows' },
  files: ['out/**', 'package.json', '!**/node_modules/electron{,/**}'],
  asar: true,
  npmRebuild: false,
  publish: null,
  extraMetadata: { name: 'lia', main: 'out/main/index.js' },
  extraResources: [
    { from: '../stage-tamagotchi/dist/lia-windows/win-unpacked', to: 'stage', filter: ['**/*'] },
    { from: '../../LICENSE', to: 'licenses/Stage-LICENSE' },
    { from: 'scripts/DISTRIBUTION-NOTICE.txt', to: 'licenses/DISTRIBUTION-NOTICE.txt' },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'Lia',
    publish: null,
  },
  nsis: {
    artifactName: 'LiaSetup-${version}-${arch}.${ext}',
    shortcutName: 'Lia',
    uninstallDisplayName: 'Lia',
    perMachine: false,
    oneClick: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
  },
}
