# Ghost Typer

A local-first Manifest V3 Chrome extension. Save the details you type repeatedly, organize them into groups, scan a website, review exact matches, and **confirm before filling**.

## Install in Chrome

1. Open `chrome://extensions` in Google Chrome (version 120 or newer).
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select the **`dist/ghost-typer` folder** in this project. Select the folder containing `manifest.json`, not the ZIP or the outer project folder.
5. Open Chrome’s Extensions menu (puzzle icon) and pin **Ghost Typer**.

For another computer, unzip `dist/ghost-typer.zip` into a permanent folder, then load that folder using the same steps. Chrome does not install a development ZIP by dragging it onto the browser. Keep the unpacked folder in place while the extension is installed.

This is an installable development extension, not a Chrome Web Store listing. No developer account or build command is needed to load the included folder.

## Use it

1. Click Ghost Typer, then **My fields**. Click a field’s value (or **Add a value to get started**) to edit it, or choose **Add field**. The editor opens with the value focused. Values save when you click **Save changes** / **Add field**.
2. Use groups to organize your details. Starter groups: **Personal, Contact, Address, Education, Employment**. All suggested values start empty.
3. Add aliases such as `University name, College, Institution` for the labels websites use.
4. Visit a regular HTTP/HTTPS website. Click the Ghost Typer toolbar icon, then **Scan this page**.
5. Review the website field names, matched saved fields, and exact proposed values. Deselect anything you do not want filled.
6. Click **Confirm & fill**. Check the website’s form before submitting it yourself.

Opening the extension or scanning never fills the page. There is no automatic background filling or learning.

The popup opens on **Review & fill**, the first tab. When nothing is selected to fill, **Scan again** refreshes the review, including values you changed on the website. Selectable matches appear before rows already containing the saved value. Selecting a match brings back **Confirm & fill**.

Your scroll position is preserved across library actions and dialog cancellation, and each popup tab remembers its position while the popup stays open. If deleting content makes the page shorter, the position is limited to the remaining scrollable area.

### Organizing fields

- Add, rename, recolor, or delete groups.
- Move a field using the **Group** dropdown in its edit dialog.
- Deleting a group preserves its fields and values in **Ungrouped**.
- Deleting a field asks for confirmation and removes its saved value. Concurrent editors detect stale changes instead of silently overwriting or recreating records.
- The top-right expand button opens the full field manager, with search and JSON backup controls.
- Closing a popup preserves its unsaved field/group draft for this browser session. Use **Resume** or **Discard** next time. Save, Cancel, Escape, and the editor’s close button clear the draft.
- The full manager edits your library. Scan and fill from the toolbar popup while on the intended website.

### Values and matching

- Blank saved values are skipped.
- Text answers can be multiline. Dates must use `YYYY-MM-DD`.
- For dropdowns and radio buttons, save the visible option label or its underlying value. For a native multi-select, enter one option label per line. Only a unique exact option match is used.
- For checkboxes, choose **Checkbox** as the answer type, then **Checked** or **Unchecked**. `Not set` disables the answer.
- Matching uses exact normalized labels, names, IDs, placeholders, aliases, and standard autocomplete tokens. It normalizes punctuation, case, camelCase, and spacing. It does not use AI or broad substring guessing. Form/section context appears in the review; answers matching different people or sections are not preselected. Under skipped controls, **Choose a saved field** can manually map a supported control. Mapping only creates a proposal; filling still requires confirmation.
- Ambiguous matches are omitted. Make aliases more specific to resolve them.
- Existing values are left unselected. A clearly labeled replacement checkbox allows you to explicitly overwrite them. Values already equal to the proposal need no change.
- A scan is valid for ten minutes and belongs to its tab. HTTP pages show an unencrypted-connection warning that must be acknowledged before filling. Reopening the popup on the same page restores its review. Editing the library, navigating, reloading, or rescanning invalidates the previous review. If a field changes between review and confirmation, it is skipped.
- Website validation constraints and rejected values are reported in the fill result.

## Backups

Open the full manager and choose **Export backup**. The resulting JSON contains readable personal information; keep it private. Library storage is limited to 8 MB and imports to 16 MB, with export-size checks ensuring that every newly exported backup can be imported. Unicode byte sizes are counted correctly. **Import** validates a backup, shows its field/group counts, and requires confirmation before replacing the existing library. Export first if you want to keep your current data.

## Privacy and permissions

`storage`, `activeTab`, `scripting`, and `alarms` permissions are requested. The alarm permission schedules removal of expired reviews and fill receipts; it adds no website access. There are no install-time host permissions, static content scripts, remote fonts, trackers, remote code, analytics, cloud requests, or accounts. Clicking the toolbar icon grants temporary access to the active website through Chrome’s `activeTab` mechanism.

Saved fields live in `chrome.storage.local`, restricted to trusted extension contexts. Reviews and fill receipts are held separately for each tab in `chrome.storage.session`. They become unusable after ten minutes; scheduled cleanup removes them when Chrome is running. Page-side snapshots also have an expiry timer. Browser sleep can delay cleanup, but expired reviews cannot be used. A confirmed action is consumed once; the background worker sends only approved values to the page. Messages that read or mutate saved data are accepted only from the extension’s own popup and manager.

Passwords, card fields, verification codes, SSNs, common government/bank identifiers, and legal-consent controls are excluded using input types, labels, names, and autocomplete metadata. Hidden, disabled, read-only, and search controls are skipped. Metadata-based detection cannot recognize every misleadingly labeled sensitive control; review every proposal. Ghost Typer is not a password manager or encrypted vault. Websites can read values inserted into their forms, even without submission. Uninstalling the extension removes its locally saved data.

See [PRIVACY.md](PRIVACY.md).

## Supported forms and known limits

Supported: native text, email, phone, URL, number, date, textarea, single- and multi-select dropdown, radio, and checkbox controls. Scanning includes accessible same-origin frames and open shadow roots. Native value setters and input/change events are used for text/selects. Native checkbox/radio clicks update framework state. React and Vue controlled text, checkbox, radio, and multi-select fixtures are tested. The batch is checked after page updates, but a website can still validate or alter values later. Dynamic forms can be rescanned.

Not supported: custom JavaScript dropdown widgets, contenteditable editors, file uploads, closed shadow roots, cross-origin frames, browser settings, Chrome Web Store pages, built-in PDF viewers, or local `file://` pages. Some websites reject synthetic input events. Ghost Typer does not solve CAPTCHAs, click submit buttons, or automatically accept terms.

## Try the demo

From this project directory:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open `http://127.0.0.1:8080/demo/form.html` in Chrome and use the extension. The demo sends no form data anywhere and includes native controls, a preserved existing value, protected fields, and a button that adds a dynamic field.

## Development

The extension uses native JavaScript ES modules, HTML, and CSS. There are no runtime dependencies or bundler requirements. This keeps the unpacked source directly inspectable. Node 22+ and Python 3 are used for the build; Playwright, React, Vue, and esbuild are development-only test dependencies. None are included in the extension ZIP.

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:browser
npm run test:reliability
```

Set `GHOST_TYPER_CHROMIUM` to an existing Chromium executable if needed. Browser tests use an isolated temporary profile and **a temporary test-only extension copy with loopback host access** because headless Chrome cannot click the toolbar to grant `activeTab`. The shipped manifest has no host permissions. Tests exercise the extension UI, background worker, storage, scan/review/confirmation flow, native controls, mutation guards, hidden/protected exclusions, frames, shadow roots, and no-submit behavior. Screenshots are written to `test-results/`.

After changing source: run `npm run build`, then click **Reload** on the Ghost Typer card at `chrome://extensions`. Close old popups and scan again.

## Project layout

```text
extension/
  manifest.json        Minimal Manifest V3 permissions
  app.js, styles.css   Popup and full library manager
  background.js        Serialized storage and review/confirmation coordination
  model.js             Starter templates, validation, group and field operations
  matcher.js           Conservative matching and proposed values
  page-agent.js        Isolated-world scanning, stale checks, native filling
  icons/               Original ghost icon
scripts/build.mjs      Icon generation, unpacked folder, ZIP packaging
tests/                 Unit and real Chromium integration tests
demo/form.html         Local practice form
dist/ghost-typer/       Ready for Load unpacked
dist/ghost-typer.zip    Portable extension package
```

Inspired by the local-first organization of Open Autofill. This is an independent implementation; it does not contain Open Autofill source code or assets.

## Recovery and updates

Version 1 libraries migrate without losing fields or values. If saved data is invalid or uses an unsupported schema, Ghost Typer shows recovery tools: export the raw data, restore a valid backup, or explicitly reset to empty templates. It never silently resets an unreadable library. Keep recovery exports private.

Scan traversal and matching have size/time limits; a partial-scan notice explains when these are reached. Unsupported controls have per-control reasons and remain untouched.
