import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// The app SHELL — `NikatruApp` and the four surfaces it hosts.
///
/// 🏗️ The widget half of the brick's `theme-triplet-supplied`,
/// `analytics-on-switch-mounted`, `analytics-lifecycle-complete` and
/// `update-url-resolved-from-config` groups. The WIRING halves stay in the
/// brick's `test/chassis_properties_test.dart`, because what they assert is that
/// a STAMPED app reads its providers and passes them in —
/// `assert-stamp-properties.mjs` anchors each of those reads in the brick file
/// and would report COVERAGE LOST if the group left.
///
/// 🔴 ONE PUMP MOUNTS ALL FIVE, ON PURPOSE. `_pumpShell` composes exactly what
/// the brick's `app.dart` composes — `NikatruApp` with an `AppLifecycleFlush` →
/// `ConsentScrim` → `OfflineBannerHost` chain as its `shell` — so these cases
/// measure the real arrangement rather than five widgets in isolation. A shell
/// that only works when each part is pumped alone is a shell that does not work.
void main() {
  // ── A router that renders one page and nothing else ────────────────────────
  // `onGenerateRoute` rather than the `pages` API: the latter's callback was
  // renamed between the SDK on this workstation and the one `ci.yml` pins, and a
  // harness that fails to compile on one of the two is a harness that proves
  // nothing on that one.
  Widget routedBody = const Text('routed body');

  Widget buildApp({
    bool asking = false,
    bool unreachable = false,
    bool mustUpdate = false,
    VoidCallback? onBackground,
    VoidCallback? onRetry,
    void Function({required bool granted})? onAnswer,
    ThemeMode themeMode = ThemeMode.light,
  }) {
    return NikatruApp(
      title: 'Probe',
      localizationsDelegates: ChassisLocalizations.localizationsDelegates,
      supportedLocales: ChassisLocalizations.supportedLocales,
      locale: const Locale('en'),
      theme: buildAppTheme(seed: const Color(0xFF6750A4)),
      darkTheme: buildAppTheme(
        seed: const Color(0xFF6750A4),
        brightness: Brightness.dark,
      ),
      themeMode: themeMode,
      routerConfig: RouterConfig<Object>(
        routerDelegate: _OnePageRouterDelegate(() => routedBody),
      ),
      mustUpdate: mustUpdate,
      onUpdate: () {},
      shell: (Widget routed) => AppLifecycleFlush(
        onBackground: onBackground ?? () {},
        child: ConsentScrim(
          asking: asking,
          prompt: ConsentPromptCard(
            appName: 'Probe',
            onAnswer: onAnswer ?? ({required bool granted}) {},
          ),
          child: OfflineBannerHost(
            unreachable: unreachable,
            onRetry: onRetry ?? () {},
            child: routed,
          ),
        ),
      ),
    );
  }

  Future<void> pumpShell(
    WidgetTester tester,
    Size size, {
    bool asking = false,
    bool unreachable = false,
    bool mustUpdate = false,
    VoidCallback? onBackground,
    VoidCallback? onRetry,
    void Function({required bool granted})? onAnswer,
    TextScaler? incomingScale,
  }) async {
    await tester.binding.setSurfaceSize(size);
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final Widget app = buildApp(
      asking: asking,
      unreachable: unreachable,
      mustUpdate: mustUpdate,
      onBackground: onBackground,
      onRetry: onRetry,
      onAnswer: onAnswer,
    );
    await tester.pumpWidget(
      incomingScale == null
          ? app
          : MediaQuery(
              data: MediaQueryData(size: size, textScaler: incomingScale),
              child: app,
            ),
    );
    await tester.pumpAndSettle();
  }

  // ── (1) THE CONSENT CARD IS CAPPED, AT EVERY WINDOW CLASS ─────────────────
  //
  // The card is a modal over a dimmed app, so it keeps `Center` and takes only
  // the WIDTH from the chassis: `AppBreakpoints.form`. Measured at all three
  // window classes because the cap only shows itself once the window is wider
  // than it — a single narrow case would pass with the cap deleted.
  group('property: consent-card-capped-at-every-window-class', () {
    Future<double> cardWidthAt(WidgetTester tester, Size size) async {
      await pumpShell(tester, size, asking: true);
      return tester
          .getSize(
            find.ancestor(
              of: find.byType(SingleChildScrollView),
              matching: find.byType(ConstrainedBox),
            ).first,
          )
          .width;
    }

    testWidgets('kPhone — narrower than the cap, so the card yields', (
      WidgetTester tester,
    ) async {
      expect(await cardWidthAt(tester, kPhone), lessThanOrEqualTo(kPhone.width));
    });

    testWidgets('kTablet — the form cap holds', (WidgetTester tester) async {
      expect(
        await cardWidthAt(tester, kTablet),
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });

    testWidgets('kDesktop — the form cap still holds', (
      WidgetTester tester,
    ) async {
      expect(
        await cardWidthAt(tester, kDesktop),
        lessThanOrEqualTo(AppBreakpoints.form),
      );
    });
  });

  // ── (2) THE SCROLL VIEW, WHICH IS A DEFECT REPAIR WITH A NUMBER ON IT ─────
  //
  // At the largest text the chassis PERMITS the card overflowed by 644 px in
  // English on a 640-tall screen and laid "Allow" out entirely below the fold.
  // `assert-consent-withdrawal-surface.mjs` limb 4 fails the build if the
  // scroller goes; this is the behavioural half of the same claim.
  group('property: consent-card-scrolls-at-the-largest-permitted-text', () {
    testWidgets('both answers are reachable at text scale 2.0', (
      WidgetTester tester,
    ) async {
      await pumpShell(
        tester,
        const Size(360, 640),
        asking: true,
        incomingScale: TextScaler.linear(3.0),
      );
      expect(find.byType(SingleChildScrollView), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.dragUntilVisible(
        find.byType(FilledButton),
        find.byType(SingleChildScrollView),
        const Offset(0, -60),
      );
      expect(find.byType(FilledButton), findsOneWidget);
    });
  });

  // ── (3) THE SCRIM IS MODAL, AND THAT IS TWO LINES OF SEMANTICS ────────────
  //
  // Semantic taps dispatch straight to the widget and DO NOT hit-test, so an
  // opaque `ColoredBox` stops a finger and stops nothing for TalkBack or
  // VoiceOver. Measured before `ExcludeSemantics` landed: the screen behind the
  // scrim was fully exposed with live tap actions.
  group('property: consent-scrim-is-modal', () {
    testWidgets('the app behind is excluded while the question is open', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpShell(tester, kPhone, asking: true);
      expect(find.bySemanticsLabel('routed body'), findsNothing);
      handle.dispose();
    });

    testWidgets('and reachable again once it is answered', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpShell(tester, kPhone);
      expect(find.bySemanticsLabel('routed body'), findsOneWidget);
      handle.dispose();
    });

    testWidgets('both answers are equally prominent and both report', (
      WidgetTester tester,
    ) async {
      final List<bool> answers = <bool>[];
      await pumpShell(
        tester,
        kTablet,
        asking: true,
        onAnswer: ({required bool granted}) => answers.add(granted),
      );
      await tester.tap(find.byType(OutlinedButton));
      await tester.tap(find.byType(FilledButton));
      expect(answers, <bool>[false, true]);
    });
  });

  // ── (4) TEXT SCALING IS CLAMPED AT THE ROOT ───────────────────────────────
  //
  // Both stores' accessibility settings can push well past 2.0, and unbounded
  // scaling does not degrade gracefully — it overflows, and an overflow is a
  // screen the user cannot finish.
  group('property: text-scaling-clamped-at-the-root', () {
    testWidgets('a 3.0 request reaches the routed screen as 2.0', (
      WidgetTester tester,
    ) async {
      late TextScaler seen;
      routedBody = Builder(
        builder: (BuildContext context) {
          seen = MediaQuery.textScalerOf(context);
          return const Text('routed body');
        },
      );
      addTearDown(() => routedBody = const Text('routed body'));
      await pumpShell(
        tester,
        kTablet,
        incomingScale: TextScaler.linear(3.0),
      );
      expect(seen.scale(10), NikatruApp.maxTextScale * 10);
    });
  });

  // ── (5) THE OFFLINE BANNER — ITS ONLY CALL SITE ───────────────────────────
  //
  // Until 2026-08-06 `OfflineNotice` had no consumer anywhere in the repository:
  // present, anchored, green, and unreachable by every user of every stamped
  // app. It returns its child untouched while reachable, so the tree is
  // byte-identical to the pre-banner one until a request has actually failed.
  group('property: offline-banner-reachable', () {
    testWidgets('absent while the config resolves', (
      WidgetTester tester,
    ) async {
      await pumpShell(tester, kDesktop);
      expect(find.byType(OfflineNotice), findsNothing);
      expect(find.text('routed body'), findsOneWidget);
    });

    testWidgets('present, with a retry, once a request has failed', (
      WidgetTester tester,
    ) async {
      int retries = 0;
      await pumpShell(
        tester,
        kDesktop,
        unreachable: true,
        onRetry: () => retries += 1,
      );
      expect(find.byType(OfflineNotice), findsOneWidget);
      expect(find.text('routed body'), findsOneWidget);
      await tester.tap(find.byType(TextButton).first);
      expect(retries, 1);
    });
  });

  // ── (6) THE FLUSH FIRES ON ALL FOUR EDGES ─────────────────────────────────
  //
  // `inactive` is the one that covers desktop: on Windows, macOS and Linux the
  // previous three-state set fired on exactly one path — minimize — and never on
  // the way out of the app.
  group('property: lifecycle-flush-covers-desktop-too', () {
    testWidgets('every state that means "on the way out" flushes', (
      WidgetTester tester,
    ) async {
      int flushes = 0;
      await pumpShell(tester, kPhone, onBackground: () => flushes += 1);
      for (final AppLifecycleState state in <AppLifecycleState>[
        AppLifecycleState.inactive,
        AppLifecycleState.hidden,
        AppLifecycleState.paused,
        AppLifecycleState.detached,
      ]) {
        tester.binding.handleAppLifecycleStateChanged(state);
      }
      expect(flushes, 4);
    });

    testWidgets('and resuming does not', (WidgetTester tester) async {
      int flushes = 0;
      await pumpShell(tester, kPhone, onBackground: () => flushes += 1);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      expect(flushes, 0);
    });
  });

  // ── (7) THE FORCE-UPDATE WALL REPLACES THE WHOLE APP ──────────────────────
  //
  // It is the emergency exit, and it is the one screen that cannot be dismissed
  // — so the copy is passed from the chassis catalogue rather than defaulted to
  // English, which is what every app this template stamped shipped until
  // 2026-09-04.
  group('property: force-update-replaces-the-app', () {
    testWidgets('the routed screen is gone and the wall is localised', (
      WidgetTester tester,
    ) async {
      await pumpShell(tester, kPhone, mustUpdate: true);
      expect(find.text('routed body'), findsNothing);
      expect(find.byType(ForceUpdateGate), findsOneWidget);
    });
  });
}

/// One page, no navigation. See the note at the top of `main` for why this uses
/// `onGenerateRoute` rather than the declarative `pages` API.
class _OnePageRouterDelegate extends RouterDelegate<Object>
    with ChangeNotifier, PopNavigatorRouterDelegateMixin<Object> {
  _OnePageRouterDelegate(this.body);

  final Widget Function() body;

  @override
  final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();

  @override
  Widget build(BuildContext context) => Navigator(
    key: navigatorKey,
    onGenerateRoute: (RouteSettings settings) =>
        MaterialPageRoute<void>(builder: (BuildContext _) => body()),
  );

  @override
  Future<void> setNewRoutePath(Object configuration) async {}
}
