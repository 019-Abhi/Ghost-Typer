# Ghost Typer — publication readiness review

Reviewed 18 November 2026. Scope: current extension source, shipped ZIP, automated tests, isolated Chromium reproductions with dummy data, and Chrome's published Web Store requirements. This review did not change the application or publish anything.

**Recommendation: do not launch this build broadly as-is.** The feature set is sufficient for a focused first release, but the correctness and data-handling issues below deserve a hardening pass first. It is suitable for controlled evaluation with its limitations understood. Store acceptance is a separate decision made by Google, not something this review can guarantee.

The source files and the ZIP matched byte-for-byte. The nine existing unit tests passed. Additional audit fixtures reproduced the issues below; evidence is in `test-results/publish-audit-evidence.json`. The previously passing integration suite primarily covers native controls on controlled demo pages. It does not establish compatibility with arbitrary websites, real React/Vue applications, all operating systems, or the actual production toolbar permission flow.

## Recommended fixes before public release

### 1. Form context is missing from matching and review

**Impact:** wrong details can be proposed for another person or another section of the same page.

Reproduction: a form containing `Your details → Name` and `Emergency contact → Name` produced two preselected proposals for the user's saved full name. Both review labels were simply `Name`, hiding the distinction that the user needed to approve safely.

`page-agent.js:46` reads a fieldset legend but uses it as the main label only for radios. It does not preserve a text field's form/section context in the descriptor. The matcher independently matches each control. Autocomplete handling also keeps only the last token, losing billing/shipping/section distinctions.

Recommended change: retain form and section context, display it in the review, and avoid preselecting generic matches when they appear across unrelated sections. Add regression fixtures for applicant/reference/emergency-contact names and billing/shipping addresses. Grouping saved fields alone does not provide page-side context.

### 2. Sensitive-field detection and matching normalize differently

**Impact:** a field that should be excluded can be filled after confirmation if the user has saved a sensitive answer.

Reproduction: a visible text input labeled and named `cardnumber`, with autocomplete off, matched a stored field named `Card number`. The proposed dummy value was filled successfully. No real card information was used.

`matcher.js:6` and `page-agent.js:6` require word boundaries or spaces in several blocked terms. Matching later permits compact equivalents, so `cardnumber` can match `Card number` without triggering the block. The scanner and matcher also maintain separate blocklists, making future drift likely.

This is **not** an observed silent data-exfiltration exploit: the value must exist in the library and the user must confirm the fill. It does invalidate an unconditional claim that card fields are never filled.

Recommended change: align normalization for detection and matching, cover compact identifiers, test common multilingual variants, and make the ordinary-contact-data scope explicit in the product. Consider rejecting recognized sensitive saved-field categories as well. Arbitrary or deliberately misleading website labels can never be classified perfectly.

### 3. Stale-page protection misses changes during a fill and new radio options

**Impact:** approved values can overwrite choices made after the scan, or continue into a different application view.

Two reproductions:

- After scanning an unselected radio group, the page added a new `Hybrid` option and selected it. Ghost Typer filled the old `Remote` option with `overwrite: false`, unchecking the new choice. The saved radio-member list did not include the new control.
- The first input's event handler changed the URL using `history.pushState`. Ghost Typer still filled the second input on the changed route. The URL is checked once before the batch rather than before each write.

Relevant code: `page-agent.js:73`, `page-agent.js:89`, and `page-agent.js:92`. The existing document-ID check correctly protects against many full document navigations; these are narrower gaps within a live document.

Recommended change: revalidate the current URL/form identity before every write; rebuild radio-group membership and current selection before changing it; stop or skip when the reviewed context no longer matches. Test page-driven transitions caused by input/change handlers.

### 4. A visible value is not proof that the website accepted it

**Impact:** users can see a successful fill but submit old or missing application data.

Reproductions:

- A checkbox with application state updated by a click handler became visually checked and was reported as successful, while the application state remained false.
- A text field reverted its value 150 ms after input. Ghost Typer reported success after its 30 ms check; the final field was empty.

`page-agent.js:122` dispatches input/change events but no click event. React's own ChangeEventPlugin specifically uses click events for checkbox/radio onChange handling. The local fixture establishes the click-handler problem; a dedicated real React test is still needed before claiming framework support.

Recommended change: use a deliberately tested per-control event strategy, add real framework fixtures, check after the batch has settled, and describe the result accurately. Increasing a timeout alone cannot guarantee that arbitrary website logic accepted the data. Do not blindly click arbitrary elements or submit controls as a workaround.

Primary reference: [React ChangeEventPlugin](https://raw.githubusercontent.com/facebook/react/main/packages/react-dom-bindings/src/events/plugins/ChangeEventPlugin.js).

### 5. Valid backups can exceed the import limit

**Impact:** users can export a library and later be unable to restore it through the UI.

Reproduction: a schema-valid library with 600 fields of 9,000 characters exported to **5,570,331 bytes**. The import dialog rejects files above **5,242,880 bytes**. This example is below Chrome local storage's nominal 10 MB limit. The product allows up to 1,000 fields and 10,000 characters per value.

Relevant code: `model.js:54`, `model.js:76`, `app.js:213`, and `app.js:225`.

Recommended change: define coherent total-size limits across saving, export, and import; guarantee that every successfully exported library can be restored; handle storage quota errors clearly. Include large Unicode values, since bytes and characters differ.

### 6. Concurrent editors can silently overwrite changes or resurrect deleted fields

**Impact:** saved user data can change unexpectedly when a popup and manager, or two managers, edit the same field.

Model reproduction: one editor renames `Full name` to `Legal name`. A second editor saves a value using its older field object; the name becomes `Full name` again. If the first editor deletes the field instead, the second editor's save adds it back.

`app.js:163` captures a field object when opening the dialog. `model.js:88` later replaces the entire record, or inserts it if absent. The background queue serializes writes but does not detect stale editor versions. The library revision is used to invalidate reviews, not to protect editor mutations.

Recommended change: distinguish create from update, add expected-revision checks or field-level conflict detection, and prompt the user to refresh/resolve an edit conflict rather than silently replacing newer data.

## Security strengths and remaining boundaries

- Manifest V3 with only `storage`, `activeTab`, and `scripting`; no broad installed host permissions.
- No backend, tracking, remote code, remote fonts, or runtime third-party libraries in the shipped extension.
- Saved values are kept in `chrome.storage.local` with trusted-context access restrictions.
- Background message handlers restrict callers to this extension's popup and manager.
- UI interpolation escapes stored values and page labels. No unescaped page-label or saved-value execution path was found in the reviewed templates.
- Filling requires explicit confirmation. Approved operations are consumed once, and existing values normally need explicit replacement consent.
- The extension does not call form submission APIs. However, website scripts can react to dispatched events, read inserted values, autosave, or submit on their own. Public claims should say Ghost Typer does not itself submit forms, rather than promise that no website can react.

These are useful safeguards, not a security certification. The sensitive-field and live-page gaps above still need fixes.

Further privacy improvements:

- Surface the no-password-manager limitation and website visibility of filled values during onboarding, not just in repository documentation.
- Treat HTTP pages deliberately: the current scheme check permits them and the review shows the host without highlighting an insecure connection. A visible warning or secure-default policy would reduce mistaken disclosure on unencrypted sites.
- A ten-minute review is invalid after ten minutes, but the data is not automatically removed at that moment. Session storage and the page snapshot can retain it until subsequent actions or context teardown. Either implement cleanup or describe the retention precisely.
- Exported backups and saved values are plaintext data, not an encrypted vault. This is an intentional design boundary; encryption at rest is not automatically a prerequisite for an ordinary contact-information tool. Do not market the extension as secure storage for credentials or financial secrets.

## Other issues users are likely to encounter

- **Unsupported controls:** custom dropdown widgets, rich-text editors, multi-selects, cross-origin embedded forms, and closed shadow roots are not supported. CSS-hidden native controls used behind custom checkbox/radio widgets may also be skipped.
- **Limited matching:** exact aliases work, but ordinary phrasing variations can be missed. Adding a second saved field with overlapping aliases can make both ambiguous. There is no manual page-to-saved-field mapping workflow.
- **Limited explanations:** skipped inputs are reported mostly as a count, so users cannot easily identify which field failed or why. Per-field reasons and a manual matching option would improve trust.
- **Draft loss:** a Chrome popup closes when the user clicks elsewhere. Unsaved editor contents are not preserved between popup instances. The full manager helps, but new users need guidance or draft persistence.
- **One pending review globally:** scanning another tab replaces the single `storage.session.review` entry. A cancelled/expired review may require rescanning. Per-tab state would improve multi-window use.
- **Large pages/libraries:** the 2,000-control limit applies after traversing the document, and radio grouping scans the full control list repeatedly. There is no practical DOM traversal/time budget; large pages need performance testing.
- **Accessibility:** text is small in several places, tabs lack full tablist semantics, and focus can be lost when the interface is entirely rerendered. Keyboard, zoom, high contrast, and screen-reader checks are still needed.
- **Recovery and updates:** there is no user-facing recovery flow if stored data fails validation, and there is no implemented schema-migration framework. Establish a tested update/backup recovery process before growing the schema.

Multiple profiles, cloud sync, AI answers, auto-learning, and support for every custom website widget are **not necessary** for a useful first release. The key is reliable supported behavior and accurate limitations.

## Chrome Web Store preparation still required

1. **Public privacy-policy URL.** The repository contains `PRIVACY.md`, but the codebase does not establish a publicly hosted policy or dashboard configuration. Chrome requires privacy disclosures even for data processed only locally. Publish an accurate policy and supply its URL in the designated dashboard field.
2. **Privacy-practices declarations.** Describe the single purpose, justify all three permissions, declare that there is no remote code, and accurately disclose the handled data types. Do not claim “no user data handled” simply because no server receives it.
3. **Store listing assets.** Prepare the description, required screenshots, and icon to the current store specifications. The existing 128 px icon fills almost the whole canvas; check its padding against the store icon guidance. Existing QA screenshots are not a finished listing asset set.
4. **Developer account and submission.** Register/configure the publisher account and pay the registration fee if not already done. Account readiness was not inspected. Prepare support contact information and review instructions.
5. **Release validation.** Test the exact shipped ZIP through the ordinary toolbar flow on stable Chrome, with denied access, popup closure, browser restart, extension update, representative frameworks, and multiple operating systems. Current headless integration tests grant loopback host access only to a temporary test copy, so they do not exercise the shipped activeTab grant gesture.

The ZIP already has a root-level manifest, Manifest V3 configuration, and a 108-character description. Those structural checks are satisfactory. GitHub hosting is not a technical dependency of the extension.

Official references reviewed:

- [User Data FAQ — local processing still requires disclosure](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)
- [Privacy policy requirements](https://developer.chrome.com/docs/webstore/program-policies/privacy)
- [Privacy practices dashboard fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)
- [Preparing an extension for submission](https://developer.chrome.com/docs/webstore/prepare)
- [Store images](https://developer.chrome.com/docs/webstore/images)
- [Developer registration](https://developer.chrome.com/docs/webstore/register)

Recommended release sequence: fix the six reproduced issue groups; add regression coverage and a small real-site/framework compatibility matrix; finish privacy/onboarding/store assets; run a limited beta; then submit a clearly scoped first public version.
