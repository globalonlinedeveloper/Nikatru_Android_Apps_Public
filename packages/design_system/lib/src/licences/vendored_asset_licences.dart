import 'dart:async';

import 'package:flutter/foundation.dart';

/// Registers the licences of assets that ship in the bundle but that Flutter's
/// own NOTICES collector never sees.
///
/// ─────────────────────────────────────────────────────────────────────────────
/// 🔴 WHY THIS FILE EXISTS — A MEASURED, FACTORY-WIDE ATTRIBUTION BREACH
///
/// Flutter builds `assets/NOTICES` from the LICENSE files of Dart **packages**.
/// `MaterialIcons-Regular.otf` does not arrive as a package — it comes from the
/// **SDK artifact cache** (`bin/cache/artifacts/material_fonts/`, pinned by
/// `bin/internal/material_fonts.version`), which that collector never reads. So
/// the font ships and its licence does not, in **every app this factory stamps**.
///
/// Measured in Subly's shipped bundle on 2026-08-13 — `build/web/assets/NOTICES`,
/// 33,785 lines:
///   · `Attribution 4.0 International` → **0**
///   · `CC BY` → **0**
///   · `material-design-icons` / `materialicons` / `Material Icons` → **0**
/// Its single `creativecommons.org` hit is a CC0 zero-waive for the unrelated
/// W3C Ahem test font. The control case is in the same file: `cupertino_icons`
/// IS a pub package and its licence IS present.
///
/// ⚠️ THE LICENCE IS CC BY 4.0, NOT APACHE-2.0, and both readings were true of
/// different artefacts — which is why the corpus could hold them at once. The
/// `google/material-design-icons` repository is Apache-2.0; the font Flutter
/// actually **vendors** carries CC BY 4.0 (`materialicons_license.txt:1` in the
/// artifact cache reads *"Attribution 4.0 International"* verbatim). The
/// tie-breaker is not which repository is upstream but **which bytes are in the
/// bundle**.
///
/// ── WHY A NOTICE AND NOT THE FULL LEGALCODE ─────────────────────────────────
/// CC BY 4.0 **§3(a)(2)**: *"You may satisfy the conditions in Section 3(a)(1)
/// in any reasonable manner based on the medium, means, and context in which You
/// Share the Licensed Material. For example, it may be reasonable to satisfy the
/// conditions by providing a URI or hyperlink to a resource that includes the
/// required information."* So the five §3(a)(1)(A) retentions plus the
/// §3(a)(1)(B) modification indication, carried with a URI to the legalcode, is
/// a compliant discharge. Vendoring ~7,000 words of legalcode into every binary
/// is not required and is not what §3(a)(2) asks for.
///
/// 🔴 §3(a)(1)(B) IS OWED BECAUSE THE ASSET IS **ADAPTED**, measured: the shipped
/// `MaterialIcons-Regular.otf` is **11,524 B** against the vendored
/// **1,645,184 B** — 0.7%, i.e. tree-shaken to the glyphs actually used. That is
/// a modification, so *"indicate if You modified the Licensed Material"* applies
/// **on top of** the five retentions. It is stated explicitly below.
///
/// ── ⏱ 2026-09-12 · THAT FUTURE BUILD ARRIVED, AND THE REGISTER CAUGHT IT ────
/// This section used to say Roboto was NOT registered here because no Roboto
/// bytes were distributed, and that **"if a future build ever ships Roboto,
/// this file is where its entry belongs — and the asset register's row is what
/// should catch it."** Both halves came true, in that order, and nobody had to
/// remember: `assert-licence-register.mjs --bundle` failed the app-brick job on
/// `Roboto-Regular.ttf ships … and has NO row`.
///
/// MEASURED 2026-09-12, and the trigger is narrower than "Flutter ships Roboto":
///   · the stamped probe, built by CI on Flutter 3.47.2 with
///     `--no-web-resources-cdn`, emits `Roboto-Regular.ttf` into `build/web`;
///   · the SAME SDK and the SAME flag deployed apps/subscriptiontracker on the
///     same day and its live bundle carries no Roboto at all — probed at
///     `nikatru.com/subscriptiontracker/assets/…`, where `MaterialIcons-Regular.otf`
///     answers `font/otf` 11,768 B and every Roboto path answers the SPA shell.
/// So WHICH bundles carry it is not established, and this notice deliberately
/// does not depend on that: it is registered unconditionally, because a licence
/// obligation that is only discharged in the builds somebody remembered to check
/// is the shape of the breach this whole file exists to close.
///
/// The licence is **Apache-2.0**, read from the bytes that ship rather than from
/// a repository: `roboto_license.txt` in the same `material_fonts/` artifact
/// (pinned by `bin/internal/material_fonts.version` to the fonts archive the
/// asset register already cites) opens *"Apache License / Version 2.0, January
/// 2004"*. That is a DIFFERENT licence from the icon font beside it in the same
/// archive (CC BY 4.0), which is why each font gets its own entry rather than
/// one notice covering "the vendored fonts".
///
/// Apache-2.0 §4(a) asks that recipients get a copy of the License, and §4(c)
/// that attribution notices are retained; §4(b)'s change-notice duty is stated
/// as unknown rather than waved away — this application does not modify the
/// font, and whether the toolchain re-writes it in the bundle is recorded as an
/// open measurement on the asset-register row, not asserted here.
///
/// ─────────────────────────────────────────────────────────────────────────────
/// Call this ONCE, early, from the app's `main()` — before `runApp`. It is
/// idempotent by [_registered] so a hot restart or a second call cannot stack
/// duplicate entries into `LicenseRegistry`, which would show the same notice
/// twice on the `LicensePage` every app's Settings offers.
void registerVendoredAssetLicences() {
  if (_registered) return;
  _registered = true;
  LicenseRegistry.addLicense(_vendoredFontLicences);
}

@visibleForTesting
bool get vendoredAssetLicencesRegistered => _registered;

/// Resets the idempotence latch. Tests only — a test that registers into the
/// process-wide [LicenseRegistry] and then asserts on a later registration
/// otherwise reads the FIRST test's state and passes for the wrong reason.
@visibleForTesting
void debugResetVendoredAssetLicences() {
  _registered = false;
}

bool _registered = false;

Stream<LicenseEntry> _vendoredFontLicences() async* {
  yield const LicenseEntryWithLineBreaks(
    <String>['flutter-material-icons'],
    // §3(a)(1)(A)(i) identification of the creator — the licence file Flutter
    // vendors names Google as the licensor of the icon font.
    'Material Icons font (MaterialIcons-Regular.otf)\n'
    'Copyright (c) Google Inc.\n'
    '\n'
    // §3(a)(1)(A)(iii) a notice referring to this Public License, with
    // §3(a)(2)'s URI to the resource carrying the required information.
    'Licensed under the Creative Commons Attribution 4.0 International '
    'License (CC BY 4.0).\n'
    'You may obtain a copy of the License at:\n'
    '    https://creativecommons.org/licenses/by/4.0/legalcode\n'
    '\n'
    // §3(a)(1)(A)(v) a URI to the Licensed Material.
    'Licensed Material:\n'
    '    https://github.com/google/material-design-icons\n'
    'The bytes distributed with this application are the icon font vendored by '
    'the Flutter SDK (bin/cache/artifacts/material_fonts/), which carries CC BY '
    '4.0. This is a different artefact from the upstream repository tree, which '
    'is published under Apache-2.0.\n'
    '\n'
    // §3(a)(1)(B) indicate if You modified the Licensed Material.
    'MODIFICATIONS: this font has been MODIFIED. It is subset ("tree-shaken") '
    'at build time to contain only the glyphs this application actually '
    'references. No other modification is made.\n'
    '\n'
    // §3(a)(1)(A)(iv) a notice referring to the disclaimer of warranties.
    'DISCLAIMER: Unless otherwise separately undertaken by the Licensor, to the '
    'extent possible, the Licensor offers the Licensed Material as-is and '
    'as-available, and makes no representations or warranties of any kind '
    'concerning the Licensed Material, whether express, implied, statutory or '
    'other. See Section 5 of the License for the full disclaimer of warranties '
    'and limitation of liability.\n',
  );

  yield const LicenseEntryWithLineBreaks(
    // The key is the asset-register row id, so a reader holding the register can
    // find this notice on the shipped LicensePage by the same name.
    <String>['flutter-roboto'],
    'Roboto (Roboto-Regular.ttf and the other Roboto faces the Flutter SDK '
    'vendors)\n'
    'Copyright (c) Google Inc.\n'
    '\n'
    // Apache-2.0 §4(a): recipients must receive a copy of the License. §3(a)(2)
    // reasoning does not apply here — Apache-2.0 names no URI allowance — so the
    // notice carries the canonical location of the full text.
    'Licensed under the Apache License, Version 2.0 (the "License"); you may '
    'not use this font except in compliance with the License.\n'
    'You may obtain a copy of the License at:\n'
    '    https://www.apache.org/licenses/LICENSE-2.0\n'
    '\n'
    'Licensed Material:\n'
    '    https://github.com/googlefonts/roboto\n'
    'The bytes distributed with this application are the Roboto faces vendored '
    'by the Flutter SDK (bin/cache/artifacts/material_fonts/, pinned by '
    'bin/internal/material_fonts.version), whose roboto_license.txt is the '
    'Apache License 2.0. The icon font in that same artifact carries a '
    'DIFFERENT licence (CC BY 4.0) and is notified separately above.\n'
    '\n'
    // Apache-2.0 §4(b) — a change notice is owed only for files we modified.
    // This application modifies none; "we did not change it" is the honest
    // statement, and it is not a claim about what the toolchain emits.
    'MODIFICATIONS: this application does not modify the font. Unlike the icon '
    'font above, Roboto is not subject to icon tree-shaking.\n'
    '\n'
    'DISCLAIMER: unless required by applicable law or agreed to in writing, the '
    'Licensor provides the Licensed Material on an "AS IS" BASIS, WITHOUT '
    'WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See '
    'Section 7 of the License for the full disclaimer of warranty and Section 8 '
    'for the limitation of liability.\n',
  );
}
