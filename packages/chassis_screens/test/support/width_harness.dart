import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

/// The window classes every chassis screen is measured at, and the pump that
/// puts one under a real `MaterialApp` with the chassis delegate composed.
///
/// 🔴 THE THREE CONSTANTS ARE THE VOCABULARY `assert-responsive-coverage.mjs`
/// READS, not decoration. That guard harvests `const Size k… = Size(w, h)` out
/// of `<root>/test/support/width_harness.dart` (`:756`, `:963`) and then
/// requires every covered surface to be pumped at each of `kPhone` / `kTablet`
/// / `kDesktop` (`REQUIRED_WIDTHS`, `:602`). A root that declares none — which
/// is where `packages/design_system` still is — gets the WEAK form: "some case
/// pumped this widget at some size". This package joins the strong form on the
/// day it is created, because the whole reason the screens moved here is that
/// one width decision now reaches every app the factory stamps.
///
/// ⚠️ `tester.binding.setSurfaceSize`, NOT `tester.view.physicalSize` — the
/// latter needs a matching `devicePixelRatio` and its own reset, and getting
/// either wrong silently changes the logical width the test believes it set.
/// Restored by `addTearDown` so a surface left set cannot leak into the next
/// case.
const Size kPhone = Size(375, 812);
const Size kTablet = Size(768, 1024);
const Size kDesktop = Size(1280, 900);

/// Every size a chassis screen is measured at, in one list, so a new screen's
/// suite cannot quietly measure two of the three.
const List<Size> kAllWindows = <Size>[kPhone, kTablet, kDesktop];

/// Pumps [child] at [size] under the same localisation wiring a stamped app
/// composes.
///
/// The delegate list is `ChassisLocalizations.localizationsDelegates` and not a
/// hand-written one: if the generated triplet is missing, or the delegate is
/// not exported, this is where it fails — loudly, at the first `l10n.` read,
/// which is what `nullable-getter: false` in `l10n.yaml` buys.
Future<void> pumpChassis(
  WidgetTester tester,
  Size size,
  Widget child, {
  Locale locale = const Locale('en'),
}) async {
  await tester.binding.setSurfaceSize(size);
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: ChassisLocalizations.localizationsDelegates,
      supportedLocales: ChassisLocalizations.supportedLocales,
      home: child,
    ),
  );
  await tester.pumpAndSettle();
}
