import 'package:flutter/material.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

export 'app_lifecycle_flush.dart';
export 'consent_prompt_card.dart';
export 'offline_banner_host.dart';

/// The app ROOT every stamped app inherits — [ADR 067] decision 2.
///
/// 🏗️ THIS IS THE BODY OF THE BRICK'S `<App>App`, MOVED. The brick keeps the
/// COMPOSITION ROOT and nothing else: the stamped seed (`buildAppTheme(seed:
/// const Color(0xFF<seed_hex>))`, which is mustache and cannot leave), the
/// app's own localisation delegates, the provider reads, and the gate chain it
/// passes to [shell]. Every one of those is either per-app by construction or
/// Riverpod, which this package declares none of.
///
/// 🔴 ONE IMPORT, ON PURPOSE. `tooling/ci/chassis-delegation.mjs` resolves a
/// delegation only when the adapter imports EXACTLY ONE
/// `package:nikatru_chassis_screens/…` path, and follows the files that path
/// re-exports one level. The brick's `app.dart` needs [NikatruApp],
/// [ConsentScrim], [ConsentPromptCard], [OfflineBannerHost] and
/// [AppLifecycleFlush]; the three `export` lines above are what let it name one
/// path and still reach all five, so the eleven guards that follow the
/// delegation can judge the moved properties where they now live.
///
/// ⚠️ WHAT DID NOT MOVE, AND WHY IT IS NOT AN OVERSIGHT:
///   · `MaterialApp.router`'s `title`, `theme`, `darkTheme`, `themeMode`,
///     `locale`, `localizationsDelegates`, `supportedLocales` and
///     `routerConfig` are PARAMETERS here rather than decisions. Each is
///     anchored in the brick by `tooling/ci/assert-stamp-properties.mjs`
///     (`theme: buildAppTheme(seed:`, `darkTheme: buildAppTheme(\n seed:`,
///     `themeMode: ref.watch(themeModeProvider)`, `locale:
///     ref.watch(localeProvider)`), and each anchor is a claim about the
///     STAMPED app supplying its own value — which is exactly what a required
///     parameter forces.
///   · The force-update DESTINATION resolves in the brick
///     (`ref.watch(appConfigProvider).valueOrNull?.updateUrl ??
///     AppConfig.updateUrl`, anchored by
///     `tooling/ci/assert-vendor-portability.mjs`), and the launch itself uses
///     `url_launcher` — a plugin, which this package may not declare.
class NikatruApp extends StatelessWidget {
  const NikatruApp({
    required this.title,
    required this.localizationsDelegates,
    required this.supportedLocales,
    required this.locale,
    required this.theme,
    required this.darkTheme,
    required this.themeMode,
    required this.routerConfig,
    required this.mustUpdate,
    required this.onUpdate,
    required this.shell,
    super.key,
  });

  /// [pipeline C-14] TEXT SCALING, clamped at the ROOT so every screen in every
  /// stamped app inherits it — this is one of the invariants that is near-free
  /// here and near-impossible to retrofit across fifty shipped apps.
  ///
  /// The floor of 1.0 refuses to shrink text below the design size; the ceiling
  /// of 2.0 is what keeps a layout usable. Both stores' accessibility settings
  /// can push well past 2.0, and unbounded scaling does not degrade gracefully
  /// — it overflows, and an overflow is a screen the user cannot finish.
  /// Clamping is the honest trade: very large text still works, rather than
  /// every screen breaking at the extreme.
  static const double minTextScale = 1.0;
  static const double maxTextScale = 2.0;

  final String title;

  /// The app's own delegates, with `ChassisLocalizations.delegate` composed
  /// BESIDE them by the caller — never instead of them.
  final List<LocalizationsDelegate<dynamic>> localizationsDelegates;
  final Iterable<Locale> supportedLocales;

  /// The persisted language override. NULL is not "no value" — it is "follow the
  /// device", and `MaterialApp` already does the right thing with null.
  final Locale? locale;

  final ThemeData theme;
  final ThemeData darkTheme;

  /// The persisted user override. Without it `MaterialApp` silently defaults to
  /// `ThemeMode.system`, which follows the OS but gives the user no say.
  final ThemeMode themeMode;

  final RouterConfig<Object> routerConfig;

  /// CFG-1 force-update kill-switch: blocks the app when the running version is
  /// below the resolved `min_supported_version`. It fails open while the config
  /// and the version load, so it never blocks the UI on a slow network.
  final bool mustUpdate;

  /// Opens the resolved update destination. The RESOLUTION stays in the brick —
  /// see the class doc.
  final VoidCallback onUpdate;

  /// The app's own gate chain, wrapped around the routed screen.
  ///
  /// A builder rather than a `Widget`, because the routed screen only exists
  /// inside `MaterialApp`'s `builder` — the one place where a widget is both
  /// below the `Localizations` this app installs and above the router's
  /// `Navigator`. Everything the chain does (consent, notification taps, the
  /// offline banner) needs both of those to be true at once.
  final Widget Function(Widget routed) shell;

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: title,
      // The store screenshot capture runs through `flutter drive`, which builds
      // in DEBUG — so every captured frame would otherwise carry Flutter's red
      // DEBUG ribbon and the listing would advertise an unfinished build. It is
      // one identifier and nothing else is holding it;
      // `tooling/ci/assert-listing-assets.mjs` follows the delegation from each
      // app's `lib/app.dart` to find it here.
      debugShowCheckedModeBanner: false,
      localizationsDelegates: localizationsDelegates,
      supportedLocales: supportedLocales,
      locale: locale,
      theme: theme,
      darkTheme: darkTheme,
      themeMode: themeMode,
      routerConfig: routerConfig,
      builder: (BuildContext context, Widget? child) =>
          MediaQuery.withClampedTextScaling(
            minScaleFactor: minTextScale,
            maxScaleFactor: maxTextScale,
            // 🔴 THE COPY IS PASSED, AND UNTIL 2026-09-04 IT WAS NOT — in EVERY
            // app this template had ever stamped. `ForceUpdateGate` carried
            // English parameter defaults and the call site supplied none, so the
            // one screen that REPLACES THE WHOLE APP and cannot be dismissed
            // shipped English to every locale. No key for it had ever existed in
            // any arb, in either tree.
            //
            // ⚠️ `context.chassisL10n` IS AVAILABLE HERE: this is
            // `MaterialApp.router`'s `builder`, which runs BELOW the
            // `Localizations` widget the MaterialApp installs.
            child: ForceUpdateGate(
              mustUpdate: mustUpdate,
              onUpdate: onUpdate,
              title: context.chassisL10n.updateRequiredTitle,
              message: context.chassisL10n.updateRequiredMessage,
              buttonLabel: context.chassisL10n.updateRequiredAction,
              child: shell(child ?? const SizedBox.shrink()),
            ),
          ),
    );
  }
}
