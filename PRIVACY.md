# Ghost Typer privacy

Ghost Typer stores the fields, groups, aliases, and values you enter locally in your current Chrome profile. It does not use an account, backend, cloud synchronization, telemetry, advertising, or analytics. It does not upload your information.

When you request a scan, it reads supported form controls on the active website and accessible same-origin frames/open shadow roots. Matching and preview happen within the extension. Separate reviews and fill receipts are retained in session storage per tab so the popup can be reopened. Reviews become unusable after ten minutes or relevant page/library changes. Scheduled cleanup removes expired records when Chrome is running; browser suspension can delay deletion. Page-side snapshots have their own expiry timer. Unsaved editor drafts stay in session storage until saved, discarded, or the browser session ends. Confirmation sends only the selected proposed values to the relevant page controls. Ghost Typer does not itself submit the form. Website scripts may read inserted values, react to input events, autosave, or submit independently.

The extension skips identifiable sensitive and legal-consent controls. Detection depends on website markup and cannot guarantee recognition of every sensitive question. Always review proposed fills. Values filled into a page become accessible to that website’s scripts and privacy practices.

Local extension storage is not an encrypted vault. Exported JSON backups contain readable personal data. You decide where to save them and whether to import them. Importing requires confirmation and replaces the existing library. You can remove individual fields and groups in the interface; uninstalling removes extension-managed local storage. Deleting a group preserves the fields in Ungrouped. Files you exported remain wherever you saved them until you remove them yourself.

Permissions:

- **storage** — save your library and temporary review.
- **activeTab** — access the current website after you invoke the extension.
- **scripting** — inspect supported form controls and fill selected values after confirmation.
- **alarms** — schedule cleanup of expired reviews and fill receipts.

Ghost Typer includes no third-party runtime services or remote resources.
