# Ghost Typer 1.1.0 — reliability improvements

All six reproduced audit issue groups have been addressed. The unpacked build and ZIP have been rebuilt. Existing version 1 fields and groups migrate automatically without losing values.

| Issue | Change | Verification |
|---|---|---|
| Names/addresses confused across sections | Review rows show form/section context. Repeated or alternate-person/address matches are left unselected. Explicit contextual aliases can match a specific section. | Emergency-contact and shipping-context cases |
| Compact sensitive names bypass exclusions | A shared safety policy covers spaced/compact identifiers and selected multilingual names. Recognized sensitive answers cannot be newly saved for filling. Legacy imported sensitive fields stay excluded from proposals. | Compact card fields skipped before their current values are read |
| Live forms change after scanning | Each write rechecks route, form/root/section identity, radio membership, current value, and control metadata. | Added radio option, moved control, route change during filling |
| Visible input differs from website state | Native checkbox/radio clicks update framework state. Text/select inputs retain native setters/events. The batch is checked again after deferred page updates. | Actual React 19 and Vue 3 controlled text, checkboxes, radios, and multi-selects; delayed rejection |
| Backups cannot be restored | Shared byte-size rules: 8 MB library, 16 MB import. Export size is checked; Unicode bytes count correctly. | 600-field backup above 5 MB restored through the UI and persisted in Chrome storage |
| Concurrent edits overwrite/recreate data | Mutations compare the record opened by the editor with the latest saved version. Stale changes fail with an explanation. | Concurrent editor conflict and deleted-record resurrection regression cases |

Additional improvements:

- Native multi-selects accept one saved option label per line.
- Skipped controls have individual reasons. A supported unmatched control can be manually mapped to a saved field, then reviewed and confirmed.
- Each tab has its own review. Closing the popup during filling no longer loses the fill receipt.
- Ten-minute reviews/receipts have scheduled cleanup. The additional `alarms` permission is used only for local expiration; no broad website permissions were added.
- HTTP pages show an explicit unencrypted-page acknowledgement before filling.
- Unsaved field/group drafts survive popup closure during the browser session. Resume/discard controls prevent accidental replacement by a different edit. Explicit Save/Cancel/close/Escape clears a draft.
- Invalid or unknown stored schemas open recovery controls: export raw data, restore a backup, or explicitly reset. The app never silently discards unreadable data.
- DOM traversal and scan/fill time budgets prevent unbounded work. Matching uses prebuilt indexes instead of repeatedly scanning the whole saved library for each input.
- Keyboard-operable tabs, focus restoration for retained controls, improved contrast, and a stable 420 × 550 popup layout improve accessibility.
- Scroll preservation remains intact for editing, deletion, cancellation, tab changes, and updates from another window.

## Validation

- 16 unit tests passed.
- 13 original browser integration checks passed.
- 20 new reliability checks passed in Chromium, using the real extension and isolated-world page injection.
- 10 targeted scroll checks passed.
- Browser restart retained saved values.
- The packaged ZIP matches current source, includes no development dependencies, and has no installed host permissions.

React, Vue, esbuild, and Playwright are development-only testing dependencies. None are shipped with the extension.

## Boundaries retained deliberately

Custom JavaScript widgets, rich-text editors, cross-origin frames, and closed shadow roots may still require manual entry. Accessible unsupported controls now explain that limitation instead of being counted silently. Native multi-selects are supported.

Post-fill verification observes values after page updates; it cannot guarantee that arbitrary website scripts will never change them later. The result screen makes that clear. The extension does not itself submit a form, but a website may react to clicks/input events, including autosaving or submission.

Saved data and backup files remain local plaintext rather than an encrypted credential vault. Ordinary form details are the intended scope. Review expiry is enforced immediately when checked; browser suspension can delay the scheduled deletion itself.

Testing used macOS Chromium with isolated profiles and a temporary test-only loopback permission. It does not establish universal compatibility with every website, operating system, assistive technology, or browser version.

## Apply the update

At `chrome://extensions`, reload Ghost Typer and reopen its popup. Keep using the same installed folder to retain its local data. The current folder is `dist/ghost-typer`; the portable package is `dist/ghost-typer.zip`.
