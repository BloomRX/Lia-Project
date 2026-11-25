/* eslint-disable no-template-curly-in-string */

/** Windows product installer. Stage is packaged independently before this step. */
export default {
  appId: 'ai.lia.launcher.preview',
  productName: 'Lia Preview',
  electronVersion: '43.4.1',
  directories: { output: 'dist/windows-native-preview' },
  files: ['out/**', 'package.json', '!**/node_modules/electron{,/**}'],
  asar: true,
  npmRebuild: false,
  publish: null,
  extraMetadata: { name: 'lia', main: 'out/main/index.js' },
  extraResources: [
    { from: '../stage/dist/lia-windows/win-unpacked', to: 'stage', filter: ['**/*'] },
    { from: 'scripts/DISTRIBUTION-NOTICE.txt', to: 'licenses/DISTRIBUTION-NOTICE.txt' },
    { from: 'scripts/AIRI-MIT.txt', to: 'licenses/AIRI-MIT.txt' },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    executableName: 'Lia',
    publish: null,
  },
  nsis: {
    artifactName: 'LiaPreviewSetup-${version}-${arch}.${ext}',
    shortcutName: 'Lia Preview',
    uninstallDisplayName: 'Lia Preview',
    perMachine: false,
    oneClick: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
  },
}
