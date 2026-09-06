import 'package:flutter/widgets.dart';

import 'chassis_localizations.dart';

/// The chassis strings, from anywhere below the `MaterialApp` that composed
/// [ChassisLocalizations.delegate].
///
/// 🔴 WHY AN EXTENSION AND NOT A BARE `ChassisLocalizations.of(context)`.
/// [ADR 067] decision 2 re-points 185 `l10n.` passes across 13 brick files, and
/// the ledger rule those passes are measured by ([ADR 066]) counts LINES at the
/// call site: a screen moves only when the calling code measurably shrinks. A
/// screen that reads only chassis keys therefore changes by exactly one token —
/// `AppLocalizations.of(context)` becomes `context.chassisL10n` on the line it
/// already had — and loses its `import '../../l10n/app_localizations.dart';`
/// outright, because the barrel it already imports carries this.
///
/// A screen that reads BOTH takes two locals, and that is the honest shape: the
/// two string sets have different owners. `chassis_en.arb` is one translation
/// fix for every app the factory stamps; `lib/l10n/app_en.arb` is the copy one
/// app owns, and `assert-no-clone-tells` is what decides which is which —
/// vocabulary that names what an app SELLS may not live in `packages/`.
extension ChassisL10nX on BuildContext {
  /// The chassis strings for this context's locale.
  ///
  /// Throws the same way [ChassisLocalizations.of] does when the delegate was
  /// not composed — `nullable-getter: false` in `l10n.yaml` is deliberate, so a
  /// missing delegate is a loud failure at the first read rather than a silent
  /// null that renders an empty screen.
  ChassisLocalizations get chassisL10n => ChassisLocalizations.of(this);
}
