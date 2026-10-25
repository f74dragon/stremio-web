; Reinstall/uninstall must not terminate the launcher or interrupt its service.
; Explicit Quit uses the application's graceful backend shutdown before retry.
!macro customInstall
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "InstallLocation" "$INSTDIR"
!macroend

!macro customCheckAppRunning
  ${nsProcess::FindProcess} "${APP_EXECUTABLE_FILENAME}" $R0
  ${If} $R0 == 0
    MessageBox MB_OK|MB_ICONINFORMATION "Quit Custom Stremio from its tray or App menu, then run setup again. Closing the window keeps downloads running." /SD IDOK
    SetErrorLevel 1618
    Quit
  ${ElseIf} $R0 != 603
    MessageBox MB_OK|MB_ICONSTOP "Setup could not check whether Custom Stremio is running. Please close the app and retry." /SD IDOK
    SetErrorLevel 1618
    Quit
  ${EndIf}
!macroend
