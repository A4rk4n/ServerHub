SERVER HUB 1.3.0 — WINDOWS X64 PORTABLE

1. Extract the complete ServerHub folder from the ZIP.
2. Double-click ServerHub.exe.
3. Wait a few seconds for the native Server Hub window to appear.
4. Closing that window shuts down Server Hub and its managed processes.

ServerHub.exe owns an embedded WebView2 window. It does not open an external browser.
Windows 10/11 normally includes the Microsoft Edge WebView2 Runtime.
If WebView2 has been removed, install Microsoft's Evergreen WebView2 Runtime and retry.

Data is stored under %APPDATA%\ServerHub and survives application updates.
The app is unsigned, so Windows SmartScreen may ask you to confirm the first run.
The management service accepts localhost requests only and must not be exposed to the internet.
