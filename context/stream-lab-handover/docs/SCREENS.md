# Screens index

Every artboard in the two design canvases, by page. Open the HTML under `design/` in a browser to see a board. Motion boards animate; the files load a small `support.js` that only the live canvas provides, so if a local file looks off, use the canvas link.

- Website canvas: https://claude.ai/artifact/1LWBK6FbZomk2D2mLVgiAY
- Desktop canvas: https://claude.ai/artifact/7sLc3R8Cs7hTBtn9uR84WN
- Design system: https://claude.ai/artifact/XsFEmm7ktnXLYf9PcgJJ7m

Rule: build each board as a **state of one component or route**, not as a separate page.



## Website (108 boards)

### Brand

| Board | Title | Route / component | File |
|---|---|---|---|
| B01 | B01 Logo · six concepts | brand assets | `design/web/B01-Logo-options.dc.html` |
| B02 | B02 Logo · chosen mark and usage | brand assets | `design/web/B02-Logo-system.dc.html` |
| B03 | B03 Node library · categories, icons, states | brand assets | `design/web/B03-Node-library.dc.html` |

### Landing & site

| Board | Title | Route / component | File |
|---|---|---|---|
| W02 | W02 Download · macOS detected | /download | `design/web/W02-Download-mac.dc.html` |
| W02b | W02 Download · Windows detected | /download | `design/web/W02b-Download-win.dc.html` |
| W02c | W02 Download · Linux detected | /download | `design/web/W02c-Download-linux.dc.html` |
| W03 | W03 404 · not found | 404 | `design/web/W03-NotFound.dc.html` |
| W01 | W01 Landing · animated hero | / (landing) | `design/web/W01-Landing.dc.html` |
| W01b | W01 Landing · returning visitor | / (landing) | `design/web/W01b-Landing-Returning.dc.html` |

### Learn

| Board | Title | Route / component | File |
|---|---|---|---|
| W04 | W04 Course · new learner | /learn | `design/web/W04-Course-new.dc.html` |
| W04b | W04 Course · in progress | /learn | `design/web/W04b-Course-progress.dc.html` |
| W04c | W04 Course · completed | /learn | `design/web/W04c-Course-done.dc.html` |
| W05 | W05 Chapter · reading, sandbox idle | /learn/:chapter | `design/web/W05-Chapter-read.dc.html` |
| W05b | W05 Chapter · sandbox running | /learn/:chapter | `design/web/W05b-Chapter-run.dc.html` |
| W05c | W05 Chapter · challenge | /learn/:chapter | `design/web/W05c-Chapter-challenge.dc.html` |
| W05d | W05 Chapter · wrong answer with hint | /learn/:chapter | `design/web/W05d-Chapter-wrong.dc.html` |
| W05e | W05 Chapter · challenge passed | /learn/:chapter | `design/web/W05e-Chapter-pass.dc.html` |
| W05f | W05 Chapter · chapter complete dialog | /learn/:chapter | `design/web/W05f-Chapter-complete.dc.html` |
| W06d | W06 Concept card · drawer over a chapter | /glossary | `design/web/W06d-Concept-drawer.dc.html` |
| W06 | W06 Glossary · index | /glossary | `design/web/W06-Glossary.dc.html` |
| W06b | W06 Glossary · search results | /glossary | `design/web/W06b-Glossary-search.dc.html` |
| W06c | W06 Glossary · no results | /glossary | `design/web/W06c-Glossary-empty.dc.html` |

### Simulator

| Board | Title | Route / component | File |
|---|---|---|---|
| W07 | W07 New pipeline · scenario gallery | /new | `design/web/W07-Gallery.dc.html` |
| W07b | W07 New pipeline · loading a scenario | /new | `design/web/W07b-Gallery-loading.dc.html` |
| W08 | W08 My pipelines · empty | /pipelines | `design/web/W08-MyPipelines-empty.dc.html` |
| W08b | W08 My pipelines · list | /pipelines | `design/web/W08b-MyPipelines-list.dc.html` |
| W08c | W08 My pipelines · import failed | /pipelines | `design/web/W08c-MyPipelines-import-error.dc.html` |
| W08d | W08 My pipelines · delete confirm | /pipelines | `design/web/W08d-MyPipelines-delete.dc.html` |
| W09 | W09 Workspace · empty canvas | /sim/:id Workspace | `design/web/W09-Workspace-empty.dc.html` |
| W09b | W09 Workspace · quick-add (double-click or /) | /sim/:id Workspace | `design/web/W09b-Workspace-quick-add.dc.html` |
| W09c | W09 Workspace · dragging with helper lines | /sim/:id Workspace | `design/web/W09c-Workspace-dragging.dc.html` |
| W09d | W09 Workspace · connecting, valid target | /sim/:id Workspace | `design/web/W09d-Workspace-connecting.dc.html` |
| W09e | W09 Workspace · connecting, invalid target | /sim/:id Workspace | `design/web/W09e-Workspace-connect-invalid.dc.html` |
| W09f | W09 Workspace · built, ready to run | /sim/:id Workspace | `design/web/W09f-Workspace-ready.dc.html` |
| W09g | W09 Workspace · node selected, toolbar and menu | /sim/:id Workspace | `design/web/W09g-Workspace-context-menu.dc.html` |
| W09h | W09 Workspace · insert a node on an edge | /sim/:id Workspace | `design/web/W09h-Workspace-insert-on-edge.dc.html` |
| W09i | W09 Workspace · running (animated edges, glowing node) | /sim/:id Workspace | `design/web/W09i-Workspace-running.dc.html` |
| W09j | W09 Workspace · paused, stepping one event | /sim/:id Workspace | `design/web/W09j-Workspace-paused.dc.html` |
| W09k | W09 Workspace · finished, output tab | /sim/:id Workspace | `design/web/W09k-Workspace-finished.dc.html` |
| W09l | W09 Workspace · validation errors with alert | /sim/:id Workspace | `design/web/W09l-Workspace-error.dc.html` |
| W09m | W09 Workspace · undo history | /sim/:id Workspace | `design/web/W09m-Workspace-history.dc.html` |
| W09n | W09 Workspace · delete with undo | /sim/:id Workspace | `design/web/W09n-Workspace-undo-toast.dc.html` |
| W09o | W09 Workspace · auto-layout applied | /sim/:id Workspace | `design/web/W09o-Workspace-auto-layout.dc.html` |
| W09p | W09 Workspace · command palette | /sim/:id Workspace | `design/web/W09p-Workspace-command-palette.dc.html` |

### Node config

| Board | Title | Route / component | File |
|---|---|---|---|
| W10 | W10 Node config · Source | /sim/:id → NodeDrawer | `design/web/W10-Source.dc.html` |
| W10 | W10 Node config · Filter | /sim/:id → NodeDrawer | `design/web/W10-Filter.dc.html` |
| W10 | W10 Node config · Map | /sim/:id → NodeDrawer | `design/web/W10-Map.dc.html` |
| W10 | W10 Node config · Validate · rule error | /sim/:id → NodeDrawer | `design/web/W10-Validate.dc.html` |
| W10 | W10 Node config · Lookup | /sim/:id → NodeDrawer | `design/web/W10-Lookup.dc.html` |
| W10 | W10 Node config · Window | /sim/:id → NodeDrawer | `design/web/W10-Window.dc.html` |
| W10 | W10 Node config · Join | /sim/:id → NodeDrawer | `design/web/W10-Join.dc.html` |
| W10 | W10 Node config · Deduplicate | /sim/:id → NodeDrawer | `design/web/W10-Dedup.dc.html` |
| W10 | W10 Node config · Top-N | /sim/:id → NodeDrawer | `design/web/W10-TopN.dc.html` |
| W10 | W10 Node config · Route | /sim/:id → NodeDrawer | `design/web/W10-Route.dc.html` |
| W10 | W10 Node config · Sink | /sim/:id → NodeDrawer | `design/web/W10-Sink.dc.html` |
| W10 | W10 Node config · Dead-letter | /sim/:id → NodeDrawer | `design/web/W10-DLQ.dc.html` |
| W10 | W10 Node config · Pattern (v1) | /sim/:id → NodeDrawer | `design/web/W10-Pattern.dc.html` |
| W10 | W10 Node config · SQL node (v1) | /sim/:id → NodeDrawer | `design/web/W10-SQLNode.dc.html` |
| W10x | W10 Node config · Window, input schema tab | /sim/:id → NodeDrawer | `design/web/W10x-Window-schema.dc.html` |
| W10y | W10 Node config · Window, output preview with state per key | /sim/:id → NodeDrawer | `design/web/W10y-Window-preview.dc.html` |
| W10z | W10 Node config · Window, docs tab | /sim/:id → NodeDrawer | `design/web/W10z-Window-docs.dc.html` |

### Data & schema

| Board | Title | Route / component | File |
|---|---|---|---|
| W12 | W12 Data · generator settings | /sim/:id → DataDrawer | `design/web/W12-Data-generator.dc.html` |
| W12b | W12 Data · uploading a file | /sim/:id → DataDrawer | `design/web/W12b-Data-upload.dc.html` |
| W12c | W12 Data · upload has bad rows | /sim/:id → DataDrawer | `design/web/W12c-Data-upload-error.dc.html` |
| W13 | W13 Reference tables · list | /sim/:id → RefTables | `design/web/W13-RefTables.dc.html` |
| W13b | W13 Reference tables · versioned table | /sim/:id → RefTables | `design/web/W13b-RefTables-versioned.dc.html` |

### Tour & explain

| Board | Title | Route / component | File |
|---|---|---|---|
| T01 | T01 Tour · step 1 of 5, your node library | /sim/:id → Tour | `design/web/T01-Tour-palette.dc.html` |
| T02 | T02 Tour · step 2 of 5, drop a source | /sim/:id → Tour | `design/web/T02-Tour-canvas.dc.html` |
| T03 | T03 Tour · step 3 of 5, configure from below | /sim/:id → Tour | `design/web/T03-Tour-drawer.dc.html` |
| T04 | T04 Tour · step 4 of 5, run, step or break it | /sim/:id → Tour | `design/web/T04-Tour-run.dc.html` |
| T05 | T05 Tour · step 5 of 5, watch the watermark | /sim/:id → Tour | `design/web/T05-Tour-timeline.dc.html` |
| T06 | T06 Tour · finished | /sim/:id → Tour | `design/web/T06-Tour-done.dc.html` |
| E01 | E01 Explain this run · an event arrives | /sim/:id → Explain/Trace/Tests | `design/web/E01-Explain-1.dc.html` |
| E02 | E02 Explain this run · it passes the rules | /sim/:id → Explain/Trace/Tests | `design/web/E02-Explain-2.dc.html` |
| E03 | E03 Explain this run · the window fires | /sim/:id → Explain/Trace/Tests | `design/web/E03-Explain-3.dc.html` |
| E04 | E04 Explain this run · a late event is set aside | /sim/:id → Explain/Trace/Tests | `design/web/E04-Explain-4.dc.html` |
| E05 | E05 Explain this run · routed as an alert | /sim/:id → Explain/Trace/Tests | `design/web/E05-Explain-5.dc.html` |
| E06 | E06 Trace · one output row highlighted on the canvas | /sim/:id → Explain/Trace/Tests | `design/web/E06-Trace.dc.html` |
| E07 | E07 What-if compare (v1) | /sim/:id → Explain/Trace/Tests | `design/web/E07-Compare.dc.html` |
| E08 | E08 Tests · passing (v1) | /sim/:id → Explain/Trace/Tests | `design/web/E08-Tests-pass.dc.html` |
| E09 | E09 Tests · failing (v1) | /sim/:id → Explain/Trace/Tests | `design/web/E09-Tests-fail.dc.html` |

### Export & share

| Board | Title | Route / component | File |
|---|---|---|---|
| W17 | W17 Export · Flink SQL | /sim/:id → ExportDialog | `design/web/W17-Export-sql.dc.html` |
| W17b | W17 Export · Run it for real (v1) | /sim/:id → ExportDialog | `design/web/W17b-Export-compose.dc.html` |
| W17c | W17 Export · send to desktop (v1) | /sim/:id → ExportDialog | `design/web/W17c-Export-desktop.dc.html` |
| W17d | W17 Export · opening the desktop app | /sim/:id → ExportDialog | `design/web/W17d-Export-desktop-wait.dc.html` |
| W17e | W17 Export · desktop app not found | /sim/:id → ExportDialog | `design/web/W17e-Export-desktop-none.dc.html` |
| W17f | W17 Export · sent to desktop | /sim/:id → ExportDialog | `design/web/W17f-Export-desktop-sent.dc.html` |
| W18 | W18 Shared link · read-only copy | /s#… shared | `design/web/W18-Shared-readonly.dc.html` |
| W18b | W18 Share dialog | /s#… shared | `design/web/W18b-Share-dialog.dc.html` |

### Errors & alerts

| Board | Title | Route / component | File |
|---|---|---|---|
| WX00 | WX00 Errors and alerts · system | error states | `design/web/WX00-Alert-system.dc.html` |
| WX01 | WX01 Simulator · CEL rule error inline | error states | `design/web/WX01-CEL-error.dc.html` |
| WX02 | WX02 Simulator · Run blocked, reason on hover | error states | `design/web/WX02-Run-blocked.dc.html` |
| WX03 | WX03 Simulator · engine stopped unexpectedly | error states | `design/web/WX03-Engine-crash.dc.html` |
| WX04 | WX04 Browser storage full | error states | `design/web/WX04-Storage-full.dc.html` |
| WX05 | WX05 Share link too long | error states | `design/web/WX05-Link-too-long.dc.html` |
| WX06 | WX06 Upload too large | error states | `design/web/WX06-File-too-large.dc.html` |
| WX07 | WX07 Unsupported browser | error states | `design/web/WX07-Unsupported-browser.dc.html` |
| WX08 | WX08 Same pipeline open in two tabs | error states | `design/web/WX08-Two-tabs.dc.html` |
| WX09 | WX09 Simulator on a small screen | error states | `design/web/WX09-Small-screen.dc.html` |
| WX10 | WX10 Large pipeline · performance mode | error states | `design/web/WX10-Large-graph.dc.html` |

### Motion

| Board | Title | Route / component | File |
|---|---|---|---|
| WM00 | Motion · principles and tokens | motion spec | `design/web/WM00-Tokens.dc.html` |
| WM01 | Motion · Watermark sweep and window fire | motion spec | `design/web/WM01-wm.dc.html` |
| WM02 | Motion · Late event to side output | motion spec | `design/web/WM02-late.dc.html` |
| WM03 | Motion · Node drop and edge connect | motion spec | `design/web/WM03-node.dc.html` |
| WM04 | Motion · Panels, toasts and button states | motion spec | `design/web/WM04-ui.dc.html` |
| WM05 | Motion · Dialog open and close | motion spec | `design/web/WM05-dialog.dc.html` |
| WM06 | Motion · running pipeline | motion spec | `design/web/WM06-running.dc.html` |
| WM07 | Motion · tour spotlight | motion spec | `design/web/WM07-tour.dc.html` |

## Desktop app (120 boards)

### Install & first run

| Board | Title | Route / component | File |
|---|---|---|---|
| I01 | I01 macOS · disk image window | installer / splash | `design/desktop/I01-Mac-DMG.dc.html` |
| I02 | I02 Windows installer · welcome | installer / splash | `design/desktop/I02-Win-Welcome.dc.html` |
| I03 | I03 Windows installer · location | installer / splash | `design/desktop/I03-Win-Location.dc.html` |
| I04 | I04 Windows installer · installing | installer / splash | `design/desktop/I04-Win-Installing.dc.html` |
| I05 | I05 Windows installer · finished | installer / splash | `design/desktop/I05-Win-Finish.dc.html` |
| I06 | I06 First launch · splash | installer / splash | `design/desktop/I06-Splash.dc.html` |

### Connections

| Board | Title | Route / component | File |
|---|---|---|---|
| D01 | D01 Welcome · no connections yet | Welcome | `design/desktop/D01-Welcome.dc.html` |
| D02 | D02 Connection form · blank | ConnectionForm | `design/desktop/D02-ConnForm-blank.dc.html` |
| D02b | D02 Connection form · filled | ConnectionForm | `design/desktop/D02b-ConnForm-filled.dc.html` |
| D02c | D02 Connection form · validation errors | ConnectionForm | `design/desktop/D02c-ConnForm-invalid.dc.html` |
| D02d | D02 Connection form · testing | ConnectionForm | `design/desktop/D02d-ConnForm-testing.dc.html` |
| D02e | D02 Connection form · test passed | ConnectionForm | `design/desktop/D02e-ConnForm-pass.dc.html` |
| D02f | D02 Connection form · test failed at sign-in | ConnectionForm | `design/desktop/D02f-ConnForm-fail.dc.html` |
| D02g | D02 Connection form · SSH tunnel (v1) | ConnectionForm | `design/desktop/D02g-ConnForm-ssh.dc.html` |
| D02h | D02 Connection form · Kubernetes port-forward (v1) | ConnectionForm | `design/desktop/D02h-ConnForm-k8s.dc.html` |
| D02i | D02 Connection form · certificates (v1) | ConnectionForm | `design/desktop/D02i-ConnForm-mtls.dc.html` |
| D03 | D03 Connection manager | Connections | `design/desktop/D03-Connections.dc.html` |
| D03b | D03 Import connections | Connections | `design/desktop/D03b-Connections-import.dc.html` |
| D03c | D03 Export connections | Connections | `design/desktop/D03c-Connections-export.dc.html` |
| D03d | D03 Delete connection | Connections | `design/desktop/D03d-Connections-delete.dc.html` |
| D03e | D03 Cluster unreachable · full page | Connections | `design/desktop/D03e-Unreachable.dc.html` |

### Fleet & cluster

| Board | Title | Route / component | File |
|---|---|---|---|
| D04 | D04 Fleet · healthy | Fleet | `design/desktop/D04-Fleet.dc.html` |
| D04b | D04 Fleet · one cluster unreachable | Fleet | `design/desktop/D04b-Fleet-unreachable.dc.html` |
| D04c | D04 Fleet · loading | Fleet | `design/desktop/D04c-Fleet-loading.dc.html` |
| D04d | D04 Fleet · offline, showing cached data | Fleet | `design/desktop/D04d-Fleet-offline.dc.html` |
| D05 | D05 Cluster overview | Cluster | `design/desktop/D05-Cluster.dc.html` |
| D05b | D05 Cluster · TaskManagers | Cluster | `design/desktop/D05b-TaskManagers.dc.html` |
| D05c | D05 TaskManager detail drawer | Cluster | `design/desktop/D05c-TaskManager-detail.dc.html` |
| D06 | D06 Applications (v1, Flink 2.3) | Applications | `design/desktop/D06-Applications.dc.html` |

### Jobs

| Board | Title | Route / component | File |
|---|---|---|---|
| D07 | D07 Job list | Jobs | `design/desktop/D07-Jobs.dc.html` |
| D07b | D07 Job list · filtered to failing | Jobs | `design/desktop/D07b-Jobs-filtered.dc.html` |
| D07c | D07 Job list · empty cluster | Jobs | `design/desktop/D07c-Jobs-empty.dc.html` |
| D07d | D07 Job list · loading | Jobs | `design/desktop/D07d-Jobs-loading.dc.html` |
| D08 | D08 Job overview · healthy | Job › Overview | `design/desktop/D08-Job-healthy.dc.html` |
| D08b | D08 Job overview · backpressure with hint | Job › Overview | `design/desktop/D08b-Job-backpressure.dc.html` |
| D08c | D08 Job overview · failing and restarting | Job › Overview | `design/desktop/D08c-Job-restarting.dc.html` |
| D08d | D08 Job overview · finished | Job › Overview | `design/desktop/D08d-Job-finished.dc.html` |
| D08e | D08 Job overview · read-only connection | Job › Overview | `design/desktop/D08e-Job-readonly.dc.html` |
| D08f | D08 Job overview · explain drawer | Job › Overview | `design/desktop/D08f-Job-explain.dc.html` |
| D09 | D09 Operator panel · metrics | Job › Operator | `design/desktop/D09-Operator-metrics.dc.html` |
| D09b | D09 Operator panel · watermark lag | Job › Operator | `design/desktop/D09b-Operator-watermarks.dc.html` |
| D09c | D09 Operator panel · subtask skew | Job › Operator | `design/desktop/D09c-Operator-subtasks.dc.html` |
| D10 | D10 Job history · local timeline | Job › History | `design/desktop/D10-Job-history.dc.html` |
| D11 | D11 Exceptions · grouped | Job › Exceptions | `design/desktop/D11-Job-exceptions.dc.html` |
| D11b | D11 Exceptions · expanded group | Job › Exceptions | `design/desktop/D11b-Job-exception-detail.dc.html` |
| D12 | D12 Checkpoints · healthy | Job › Checkpoints | `design/desktop/D12-Job-checkpoints.dc.html` |
| D12b | D12 Checkpoints · failing | Job › Checkpoints | `design/desktop/D12b-Job-checkpoints-failing.dc.html` |
| D13 | D13 Configuration · compare with staging (v1) | Job › Config | `design/desktop/D13-Job-config-compare.dc.html` |
| D14 | D14 Savepoints (v1) | Job › Savepoints | `design/desktop/D14-Job-savepoints.dc.html` |
| D14b | D14 Savepoints · none yet | Job › Savepoints | `design/desktop/D14b-Job-savepoints-empty.dc.html` |

### Job actions

| Board | Title | Route / component | File |
|---|---|---|---|
| D15 | D15 Stop with savepoint · confirm | Job action dialogs | `design/desktop/D15-Stop-savepoint.dc.html` |
| D15b | D15 Stop with savepoint · in progress | Job action dialogs | `design/desktop/D15b-Stop-progress.dc.html` |
| D15c | D15 Stop with savepoint · done | Job action dialogs | `design/desktop/D15c-Stop-success.dc.html` |
| D15d | D15 Stop with savepoint · failed | Job action dialogs | `design/desktop/D15d-Stop-failed.dc.html` |
| D15e | D15 Cancel on production · type to confirm | Job action dialogs | `design/desktop/D15e-Cancel-prod.dc.html` |
| D15f | D15 Trigger savepoint · in progress toast | Job action dialogs | `design/desktop/D15f-Trigger-savepoint.dc.html` |
| D15g | D15 Rescale (v1) | Job action dialogs | `design/desktop/D15g-Rescale.dc.html` |
| D16 | D16 Submit JAR (v1) · choose JAR | SubmitJar wizard | `design/desktop/D16-Submit-upload.dc.html` |
| D16 | D16 Submit JAR (v1) · configure | SubmitJar wizard | `design/desktop/D16-Submit-config.dc.html` |
| D16 | D16 Submit JAR (v1) · submitting | SubmitJar wizard | `design/desktop/D16-Submit-run.dc.html` |
| D16 | D16 Submit JAR (v1) · running | SubmitJar wizard | `design/desktop/D16-Submit-ok.dc.html` |
| D16 | D16 Submit JAR (v1) · failed to start | SubmitJar wizard | `design/desktop/D16-Submit-err.dc.html` |

### SQL

| Board | Title | Route / component | File |
|---|---|---|---|
| D17 | D17 SQL editor (v1) · empty | SQL editor | `design/desktop/D17-SQL-empty.dc.html` |
| D17 | D17 SQL editor (v1) · streaming results | SQL editor | `design/desktop/D17-SQL-run.dc.html` |
| D17 | D17 SQL editor (v1) · error | SQL editor | `design/desktop/D17-SQL-err.dc.html` |
| D17 | D17 SQL editor (v1) · plan view | SQL editor | `design/desktop/D17-SQL-plan.dc.html` |
| D17 | D17 SQL editor (v1) · pipeline from simulator | SQL editor | `design/desktop/D17-SQL-incoming.dc.html` |
| D17 | D17 SQL editor (v1) · no SQL Gateway | SQL editor | `design/desktop/D17-SQL-nogw.dc.html` |

### Logs, alerts & settings

| Board | Title | Route / component | File |
|---|---|---|---|
| D18 | D18 Logs · following | Logs | `design/desktop/D18-Logs.dc.html` |
| D18b | D18 Logs · search and level filter | Logs | `design/desktop/D18b-Logs-filtered.dc.html` |
| D19 | D19 Thread dump (v1) | TM › Thread dump / Flame graph | `design/desktop/D19-ThreadDump.dc.html` |
| D19b | D19 Flame graph viewer (later) | TM › Thread dump / Flame graph | `design/desktop/D19b-FlameGraph.dc.html` |
| D20 | D20 Alerts (v1) · recent | Alerts | `design/desktop/D20-Alerts-recent.dc.html` |
| D20b | D20 Alerts (v1) · rules | Alerts | `design/desktop/D20b-Alerts-rules.dc.html` |
| D20c | D20 Alerts (v1) · new rule | Alerts | `design/desktop/D20c-Alerts-new-rule.dc.html` |
| D20d | D20 Desktop notification | Alerts | `design/desktop/D20d-Notification.dc.html` |
| D21 | D21 Settings · general | Settings | `design/desktop/D21-Settings-0.dc.html` |
| D21 | D21 Settings · history and storage | Settings | `design/desktop/D21-Settings-1.dc.html` |
| D21 | D21 Settings · updates | Settings | `design/desktop/D21-Settings-2.dc.html` |
| D21 | D21 Settings · about | Settings | `design/desktop/D21-Settings-3.dc.html` |

### Global

| Board | Title | Route / component | File |
|---|---|---|---|
| G01 | G01 Command palette | global | `design/desktop/G01-Command-palette.dc.html` |
| G02 | G02 Keyboard shortcuts | global | `design/desktop/G02-Shortcuts.dc.html` |
| G03 | G03 Update available · banner | global | `design/desktop/G03-Update-banner.dc.html` |
| G04 | G04 Update available · dialog | global | `design/desktop/G04-Update-dialog.dc.html` |
| G05 | G05 Updating | global | `design/desktop/G05-Updating.dc.html` |

### Connect any cluster

| Board | Title | Route / component | File |
|---|---|---|---|
| C01 | C01 New connection · where does your cluster run? | ConnectionWizard / connection health | `design/desktop/C01-Where-is-cluster.dc.html` |
| C02 | C02 Connection form · advanced: base path, headers, proxy, gateway | ConnectionWizard / connection health | `design/desktop/C02-Advanced-settings.dc.html` |
| C03 | C03 Untrusted certificate · trust this server? | ConnectionWizard / connection health | `design/desktop/C03-Trust-certificate.dc.html` |
| C04 | C04 Test connection · each check shown, one failing | ConnectionWizard / connection health | `design/desktop/C04-Test-steps.dc.html` |
| C05 | C05 Version capabilities · what works on this cluster | ConnectionWizard / connection health | `design/desktop/C05-Version-capabilities.dc.html` |
| C06 | C06 JobManager failover (HA): leader moved | ConnectionWizard / connection health | `design/desktop/C06-Leader-changed.dc.html` |
| C07 | C07 Managed service link expired | ConnectionWizard / connection health | `design/desktop/C07-Presigned-expired.dc.html` |
| C08 | C08 Connection · certificate checks turned off | ConnectionWizard / connection health | `design/desktop/C08-TLS-verify-off.dc.html` |

### Errors & alerts

| Board | Title | Route / component | File |
|---|---|---|---|
| X00 | X00 Errors and alerts · system | error and extra states | `design/desktop/X00-Alert-system.dc.html` |
| X01 | X01 SQL · syntax error, inline | error and extra states | `design/desktop/X01-SQL-syntax-error.dc.html` |
| X02 | X02 SQL · unknown table with quick fix | error and extra states | `design/desktop/X02-SQL-unknown-table.dc.html` |
| X03 | X03 SQL · warning, unbounded state | error and extra states | `design/desktop/X03-SQL-warning-state.dc.html` |
| X04 | X04 SQL · several problems, Run blocked | error and extra states | `design/desktop/X04-SQL-problems-list.dc.html` |
| X05 | X05 SQL · statement failed after submit | error and extra states | `design/desktop/X05-SQL-runtime-failure.dc.html` |
| X06 | X06 SQL · gateway connection lost while streaming | error and extra states | `design/desktop/X06-SQL-gateway-lost.dc.html` |
| X07 | X07 SQL · results capped (info) | error and extra states | `design/desktop/X07-SQL-truncated.dc.html` |
| X08 | X08 Sign-in expired (401) | error and extra states | `design/desktop/X08-Session-expired.dc.html` |
| X09 | X09 Action not allowed (403) | error and extra states | `design/desktop/X09-Permission-denied.dc.html` |
| X10 | X10 Conflict (409): job already stopping | error and extra states | `design/desktop/X10-Conflict.dc.html` |
| X11 | X11 Partial data: some TaskManagers did not answer | error and extra states | `design/desktop/X11-Partial-data.dc.html` |
| X12 | X12 Slow cluster: timeout with automatic retry | error and extra states | `design/desktop/X12-Timeout-retry.dc.html` |
| X13 | X13 Restarted after a crash | error and extra states | `design/desktop/X13-Crash-recovery.dc.html` |
| X14 | X14 Stop dialog: savepoint folder not configured | error and extra states | `design/desktop/X14-Savepoint-dir-missing.dc.html` |
| X15 | X15 Update failed | error and extra states | `design/desktop/X15-Update-failed.dc.html` |
| X16 | X16 SQL · saved queries and snippets | error and extra states | `design/desktop/X16-SQL-saved-queries.dc.html` |
| X17 | X17 Submit · saved run configurations | error and extra states | `design/desktop/X17-Submit-saved-configs.dc.html` |
| X18 | X18 Jobs · saved views across all clusters | error and extra states | `design/desktop/X18-Jobs-saved-views.dc.html` |
| X19 | X19 Local history · storage limit reached | error and extra states | `design/desktop/X19-History-retention.dc.html` |
| X20 | X20 Exceptions · grouped by type | error and extra states | `design/desktop/X20-Exceptions-grouped.dc.html` |

### Motion

| Board | Title | Route / component | File |
|---|---|---|---|
| DM00 | Motion · principles and tokens | motion spec | `design/desktop/DM00-Tokens.dc.html` |
| DM01 | Motion · Live metrics and loading | motion spec | `design/desktop/DM01-metric.dc.html` |
| DM02 | Motion · Backpressure on the job graph | motion spec | `design/desktop/DM02-bp.dc.html` |
| DM03 | Motion · Connection test checklist | motion spec | `design/desktop/DM03-conn.dc.html` |
| DM04 | Motion · Dialog open and close | motion spec | `design/desktop/DM04-dialog.dc.html` |
| DM05 | Motion · Panels, toasts and button states | motion spec | `design/desktop/DM05-ui.dc.html` |
