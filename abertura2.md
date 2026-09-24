
============================================
 Lia - Stage Tamagotchi (dev)
 pnpm dev:tamagotchi
============================================

Pressione Ctrl+C no terminal para encerrar o servidor de desenvolvimento.

$ pnpm -rF @proj-airi/stage-tamagotchi run dev
$ install-electron && electron-vite dev
vite v8.2.2 building ssr environment for development...
✓ 525 modules transformed.
out/main/rolldown-runtime-BMI-E3GI.js             1.92 kB
out/main/global-shortcut-uiohook-onAMpt-j.js      5.95 kB
out/main/vendor-debug-B35ok2k9.js                23.22 kB
out/main/vendor-h3-me2Q0P0t.js                   92.88 kB
out/main/index.js                             2,493.59 kB

✓ built in 1.27s

electron main process built successfully

-----

vite v8.2.2 building ssr environment for development...
✓ 5 modules transformed.
out/preload/index.mjs            0.11 kB
out/preload/beat-sync.mjs        0.12 kB
out/preload/shared-DtzQ5aVx.mjs  2.46 kB

✓ built in 22ms

electron preload scripts built successfully

-----

hiyori_free_zh.zip already exists in cache.
AvatarSample_B.vrm already exists in cache.
hiyori_pro_zh.zip already exists in cache.
AvatarSample_A.vrm already exists in cache.
hiyori_free_zh.zip already exists in J:\Lia-Project\airi\packages\stage-ui\src\assets.
AvatarSample_B.vrm already exists in J:\Lia-Project\airi\packages\stage-ui\src\assets.
hiyori_pro_zh.zip already exists in J:\Lia-Project\airi\packages\stage-ui\src\assets.
AvatarSample_A.vrm already exists in J:\Lia-Project\airi\packages\stage-ui\src\assets.
dev server running for the electron renderer process at:

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  Vue DevTools: Open http://localhost:5173/__devtools__/ as a separate window
  ➜  Vue DevTools: Press Alt(⌥)+Shift(⇧)+D in App to toggle the Vue DevTools

starting electron app...


@proj-airi/plugin-sdk is currently working in progress. APIs may change without warning.
[FileLogger] Session logs: C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\logs\airi-tamagotchi-1789603866803.log
2026-09-17T00:11:06.819Z [log] [injeca] PROVIDE    configs:app
2026-09-17T00:11:06.821Z [log] [injeca] PROVIDE    configs:artistry
2026-09-17T00:11:06.821Z [log] [injeca] PROVIDE    configs:lia-product
2026-09-17T00:11:06.822Z [log] [injeca] PROVIDE    services:lia-secrets
2026-09-17T00:11:06.822Z [log] [injeca] PROVIDE    services:lia-voice-profiles
2026-09-17T00:11:06.822Z [log] [injeca] PROVIDE    host:electron:app
2026-09-17T00:11:06.823Z [log] [injeca] PROVIDE    services:auto-updater (depends on: configs:app)
2026-09-17T00:11:06.823Z [log] [injeca] PROVIDE    libs:i18n (depends on: configs:app)
2026-09-17T00:11:06.823Z [log] [injeca] PROVIDE    modules:channel-server (depends on: host:electron:app, lifecycle)
2026-09-17T00:11:06.823Z [log] [injeca] PROVIDE    modules:airi-http-server
2026-09-17T00:11:06.824Z [log] [injeca] PROVIDE    modules:godot-stage-manager
2026-09-17T00:11:06.824Z [log] [injeca] PROVIDE    modules:apple-speech-transcription (depends on: lifecycle)
2026-09-17T00:11:06.824Z [log] [injeca] PROVIDE    modules:mcp-stdio-manager
2026-09-17T00:11:06.824Z [log] [injeca] PROVIDE    windows:widgets (depends on: modules:channel-server, libs:i18n)
2026-09-17T00:11:06.824Z [log] [injeca] PROVIDE    modules:plugin-host (depends on: modules:channel-server, windows:widgets)
2026-09-17T00:11:06.824Z [log] [injeca] PROVIDE    services:global-shortcut
2026-09-17T00:11:06.825Z [log] [injeca] PROVIDE    windows:beat-sync
2026-09-17T00:11:06.825Z [log] [injeca] PROVIDE    windows:devtools:markdown-stress
2026-09-17T00:11:06.825Z [log] [injeca] PROVIDE    windows:onboarding (depends on: modules:channel-server, libs:i18n)
2026-09-17T00:11:06.825Z [log] [injeca] PROVIDE    windows:notice (depends on: libs:i18n, modules:channel-server)
2026-09-17T00:11:06.825Z [log] [injeca] PROVIDE    windows:about (depends on: services:auto-updater, libs:i18n, modules:channel-server)
2026-09-17T00:11:06.825Z [log] [injeca] PROVIDE    windows:chat (depends on: windows:widgets, modules:channel-server, modules:mcp-stdio-manager, libs:i18n)
2026-09-17T00:11:06.825Z [log] [injeca] PROVIDE    windows:spotlight (depends on: modules:channel-server, libs:i18n, windows:chat, services:global-shortcut, configs:app)
2026-09-17T00:11:06.826Z [log] [injeca] PROVIDE    windows:editor (depends on: modules:channel-server, libs:i18n)
2026-09-17T00:11:06.826Z [log] [injeca] PROVIDE    windows:settings (depends on: windows:widgets, windows:beat-sync, services:auto-updater, windows:devtools:markdown-stress, modules:channel-server, modules:godot-stage-manager, modules:mcp-stdio-manager, libs:i18n, services:global-shortcut, windows:spotlight)
2026-09-17T00:11:06.826Z [log] [injeca] PROVIDE    windows:main (depends on: windows:editor, windows:settings, windows:chat, windows:widgets, windows:notice, windows:beat-sync, services:auto-updater, modules:channel-server, modules:godot-stage-manager, modules:mcp-stdio-manager, libs:i18n, windows:onboarding, modules:apple-speech-transcription)
2026-09-17T00:11:06.826Z [log] [injeca] PROVIDE    windows:caption (depends on: windows:main, modules:channel-server, libs:i18n)
2026-09-17T00:11:06.826Z [log] [injeca] PROVIDE    app:tray (depends on: windows:main, windows:settings, windows:caption, windows:widgets, modules:channel-server, windows:beat-sync, windows:about, libs:i18n)
2026-09-17T00:11:06.827Z [log] [injeca] BEFORE RUN provide: services:lia-secrets()
2026-09-17T00:11:06.828Z [log] [injeca] RUN        provide: services:lia-secrets() in 408.600µs
2026-09-17T00:11:06.828Z [log] [injeca] BEFORE RUN provide: configs:lia-product()
2026-09-17T00:11:06.830Z [log] [injeca] RUN        provide: configs:lia-product() in 1.871ms
2026-09-17T00:11:06.830Z [log] [injeca] BEFORE RUN provide: services:lia-voice-profiles()
2026-09-17T00:11:06.830Z [log] [injeca] RUN        provide: services:lia-voice-profiles() in 100.000µs
2026-09-17T00:11:06.830Z [log] [injeca] BEFORE RUN provide: host:electron:app()
2026-09-17T00:11:06.830Z [log] [injeca] RUN        provide: host:electron:app() in 21.600µs
2026-09-17T00:11:06.832Z [log] [injeca] BEFORE RUN provide: modules:channel-server()
2026-09-17T00:11:06.833Z [log] [@proj-airi/server-runtime/server] creating server channel  { hasTlsConfig=false }
2026-09-17T00:11:06.834Z [log] [injeca] RUN        provide: modules:channel-server() in 1.943ms
2026-09-17T00:11:06.834Z [log] [injeca] BEFORE RUN provide: configs:app()
2026-09-17T00:11:06.834Z [log] [injeca] RUN        provide: configs:app() in 495.300µs
2026-09-17T00:11:06.835Z [log] [injeca] BEFORE RUN provide: libs:i18n()
2026-09-17T00:11:06.836Z [log] [injeca] RUN        provide: libs:i18n() in 701.500µs
2026-09-17T00:11:06.836Z [log] [injeca] BEFORE RUN provide: windows:editor()
2026-09-17T00:11:06.836Z [log] [injeca] RUN        provide: windows:editor() in 153.200µs
2026-09-17T00:11:06.836Z [log] [injeca] BEFORE RUN provide: windows:widgets()
2026-09-17T00:11:06.837Z [log] [injeca] RUN        provide: windows:widgets() in 466.500µs
2026-09-17T00:11:06.837Z [log] [injeca] BEFORE RUN provide: windows:beat-sync()
2026-09-17T00:11:07.406Z [log] [injeca] RUN        provide: windows:beat-sync() in 568.960ms
2026-09-17T00:11:07.406Z [log] [injeca] BEFORE RUN provide: services:auto-updater()
2026-09-17T00:11:07.421Z [log] [injeca] RUN        provide: services:auto-updater() in 14.758ms
2026-09-17T00:11:07.421Z [log] [injeca] BEFORE RUN provide: windows:devtools:markdown-stress()
2026-09-17T00:11:07.421Z [log] [injeca] RUN        provide: windows:devtools:markdown-stress() in 86.600µs
2026-09-17T00:11:07.422Z [log] [injeca] BEFORE RUN provide: modules:godot-stage-manager()
2026-09-17T00:11:07.422Z [log] [injeca] RUN        provide: modules:godot-stage-manager() in 282.700µs
2026-09-17T00:11:07.422Z [log] [injeca] BEFORE RUN provide: modules:mcp-stdio-manager()
2026-09-17T00:11:07.429Z [log] [injeca] RUN        provide: modules:mcp-stdio-manager() in 6.592ms
2026-09-17T00:11:07.429Z [log] [injeca] BEFORE RUN provide: services:global-shortcut()
2026-09-17T00:11:07.429Z [log] [injeca] RUN        provide: services:global-shortcut() in 141.900µs
2026-09-17T00:11:07.430Z [log] [injeca] BEFORE RUN provide: windows:chat()
2026-09-17T00:11:07.430Z [log] [injeca] RUN        provide: windows:chat() in 64.300µs
2026-09-17T00:11:07.430Z [log] [injeca] BEFORE RUN provide: windows:spotlight()
2026-09-17T00:11:07.430Z [log] [injeca] RUN        provide: windows:spotlight() in 451.600µs
2026-09-17T00:11:07.430Z [log] [injeca] BEFORE RUN provide: windows:settings()
2026-09-17T00:11:07.431Z [log] [injeca] RUN        provide: windows:settings() in 128.000µs
2026-09-17T00:11:07.431Z [log] [injeca] BEFORE RUN provide: windows:notice()
2026-09-17T00:11:07.431Z [log] [injeca] RUN        provide: windows:notice() in 184.700µs
2026-09-17T00:11:07.431Z [log] [injeca] BEFORE RUN provide: windows:onboarding()
2026-09-17T00:11:07.432Z [log] [injeca] RUN        provide: windows:onboarding() in 141.900µs
2026-09-17T00:11:07.432Z [log] [injeca] BEFORE RUN provide: modules:apple-speech-transcription()
2026-09-17T00:11:07.432Z [log] [injeca] RUN        provide: modules:apple-speech-transcription() in 130.300µs
2026-09-17T00:11:07.432Z [log] [injeca] BEFORE RUN provide: windows:main()
2026-09-17T00:11:08.542Z [warn] [auto-updater] [auto-updater] applied generic feed override (github-release-lane:beta): https://github.com/moeru-ai/airi/releases/download/v0.12.0-beta.5
2026-09-17T00:11:16.070Z [log] [injeca] RUN        provide: windows:main() in 8.637s
2026-09-17T00:11:16.070Z [log] [injeca] BEFORE RUN provide: windows:caption()
2026-09-17T00:11:16.073Z [log] [injeca] RUN        provide: windows:caption() in 2.501ms
2026-09-17T00:11:16.074Z [log] [injeca] BEFORE RUN provide: windows:about()
2026-09-17T00:11:16.075Z [log] [injeca] RUN        provide: windows:about() in 163.200µs
2026-09-17T00:11:16.075Z [log] [injeca] BEFORE RUN provide: app:tray()
2026-09-17T00:11:16.105Z [log] [injeca] RUN        provide: app:tray() in 29.462ms
2026-09-17T00:11:16.105Z [log] [injeca] BEFORE RUN provide: modules:airi-http-server()
2026-09-17T00:11:16.106Z [log] [injeca] RUN        provide: modules:airi-http-server() in 186.400µs
2026-09-17T00:11:16.106Z [log] [injeca] BEFORE RUN provide: modules:plugin-host()
2026-09-17T00:11:16.108Z [log] [main/extension-host] loading extension manifests  { extensionsRoot=C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\extensions\v1 }
2026-09-17T00:11:16.110Z [log] [main/extension-host] extension manifests loaded  { count=0 }
2026-09-17T00:11:16.119Z [log] [injeca] RUN        provide: modules:plugin-host() in 12.477ms
2026-09-17T00:11:16.119Z [log] [injeca] BEFORE RUN provide: configs:artistry()
2026-09-17T00:11:16.119Z [log] [injeca] RUN        provide: configs:artistry() in 343.900µs
2026-09-17T00:11:16.120Z [log] [injeca] HOOK OnStart        modules:channel-server() executing
2026-09-17T00:11:16.126Z [log] [@proj-airi/server-runtime/server] @proj-airi/server-runtime started on ws://127.0.0.1:6121
2026-09-17T00:11:16.126Z [log] [main/server-runtime] WebSocket server started
2026-09-17T00:11:16.126Z [log] [injeca] HOOK OnStart        modules:channel-server() ran successfully in 6.088ms
2026-09-17T00:11:16.127Z [log] [injeca] HOOK OnStart        modules:apple-speech-transcription() executing
2026-09-17T00:11:16.127Z [log] [injeca] HOOK OnStart        modules:apple-speech-transcription() ran successfully in 5.800µs
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:16.129Z runtime.manager-registered
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:16.131Z runtime.autostart-requested installing=false
2026-09-17T00:11:16.132Z [log] [artistry-bridge] 🚀 Initializing Artistry bridge (Spawn + Update Interceptor + Headless Handler)...
2026-09-17T00:11:16.133Z [log] [injeca] RUNNING
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:16.134Z runtime.start-request source=autostart
[LIA-VOICE-RUNTIME] runtime.state-published status=stopped trigger=runtime.start-request
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:16.146Z runtime.classified health=alltalk occupancy=skipped
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:16.146Z runtime.port-diagnosis-started reason=alltalk-compatible
2026-09-17T00:11:16.251Z [log] [artistry-bridge] 🔄 Syncing artistry config to main. Provider: none
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:16.908Z port-owner port=7851 pid=14148 exe=C:\Users\lucas\AppData\Local\Lia\runtimes\alltalk\app\alltalk_environment\env\python.exe parentPid=13900 created=16/09/2026 21:08:28 underLiaInstallRoot=true
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:16.908Z port-owner-cmdline port=7851 pid=14148 cmd=C:\Users\lucas\AppData\Local\Lia\runtimes\alltalk\app\alltalk_environment\env\python.exe
[unocss] unmatched utility "scrollbar-color-[var(--scrollbar-thumb)_var(--scrollbar-track)]" in shortcut "scrollbar"
[unocss] unmatched utility "scrollbar-width-auto" in shortcut "scrollbar"
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:17.420Z port-owner port=7852 pid=13900 exe=C:\Users\lucas\AppData\Local\Lia\runtimes\alltalk\app\alltalk_environment\env\python.exe parentPid=22472 created=16/09/2026 21:08:09 underLiaInstallRoot=true
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:17.420Z port-owner-cmdline port=7852 pid=13900 cmd=python  script.py
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:17.420Z runtime.port-diagnosis-finished
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:19.194Z runtime.adopted-lia-managed-instance classification=lia-managed rootPid=13900
[LIA-VOICE-RUNTIME] runtime.state-published status=ready trigger=runtime.adopted-lia-managed-instance
2026-09-17T00:11:22.501Z [log] [@proj-airi/server-runtime:websocket] connected  { peer=45cc7a27-8c33-47b8-8be1-227f44f25385 activePeers=1 }
2026-09-17T00:11:36.027Z [log] [injeca] HOOK OnStop         modules:apple-speech-transcription() executing
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:36.027Z runtime.shutdown-begin trigger=before-quit
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:36.028Z runtime.shutdown-requested
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:36.028Z runtime.stopping-lia-managed-existing rootPid=13900
[LIA-VOICE-RUNTIME] runtime.state-published status=stopped trigger=runtime.stopping-lia-managed-existing
2026-09-17T00:11:36.032Z [log] [injeca] HOOK OnStop         modules:apple-speech-transcription() ran successfully in 4.944ms
2026-09-17T00:11:36.033Z [log] [injeca] HOOK OnStop         modules:channel-server() executing
2026-09-17T00:11:36.033Z [log] [@proj-airi/server-runtime/server] closing existing server instance
2026-09-17T00:11:36.033Z [log] [@proj-airi/server-runtime:websocket] closing all peers  { totalPeers=1 }
2026-09-17T00:11:36.035Z [log] [@proj-airi/server-runtime:websocket] closed  { peer=45cc7a27-8c33-47b8-8be1-227f44f25385 peerRemote=127.0.0.1 details={"reason":"server shutdown"} closeCode=undefined closeReason=server shutdown closeWasClean=undefined activePeers=0 peerAuthenticated=true peerName= peerIndex=undefined peerHealthy=true peerMissedHeartbeats=0 peerSilentFor=0 heartbeatLastSeenAt=1789603882509 heartbeatSilentForMs=13525 heartbeatTtlMs=60000 healthCheckIntervalMs=12000 likelyHeartbeatExpiry=false likelySilentNetworkClose=false }
2026-09-17T00:11:36.035Z [log] [@proj-airi/server-runtime/server] closing server instance
2026-09-17T00:11:36.053Z [log] [@proj-airi/server-runtime/server] server instance closed
2026-09-17T00:11:36.053Z [log] [@proj-airi/server-runtime/server] existing server instance closed
2026-09-17T00:11:36.054Z [log] [main/server-runtime] WebSocket server closed
2026-09-17T00:11:36.054Z [log] [injeca] HOOK OnStop         modules:channel-server() ran successfully in 21.302ms
[FileLogger] File closed successfully
[FileLogger] Session log file: C:\Users\lucas\AppData\Roaming\@proj-airi\stage-tamagotchi\logs\airi-tamagotchi-1789603866803.log (14.11 KB)
[LIA-VOICE-RUNTIME] 2026-09-17T00:11:36.058Z runtime.shutdown-nothing-to-stop phase=stopped

[OK] Stage Tamagotchi encerrou normalmente.

Pressione qualquer tecla para continuar. . .