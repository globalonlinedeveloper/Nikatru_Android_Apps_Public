import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/shell/app_shell.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/a11y_harness.dart';
import 'support/width_harness.dart';

/// A11Y — THE APP SHELL AND THE FOUR SURFACES IT HOSTS.
///
/// `NikatruApp`, `AppLifecycleFlush`, `ConsentScrim`, `ConsentPromptCard` and
/// `OfflineBannerHost` are mounted by EVERY stamped app on every launch, so
/// they are the most reachable surfaces the factory ships. See
/// `a11y_auth_test.dart`'s header for what each case asserts and why.
///
/// 🔴 ONE CASE HERE IS A PIN OVER A DEFECT THIS SUITE FOUND, NOT A SWEEP, AND
/// THE DEFECT IS IN `lib/` WHICH THIS UNIT DOES NOT OWN. Composed the way the
/// brick's `app.dart` composes it, `OfflineBannerHost`'s banner is MOUNTED and
/// INVISIBLE TO A SCREEN READER: the router pushes a `MaterialPageRoute`, whose
/// `ModalBarrier` wraps the page in `BlockSemantics`
/// (`flutter/lib/src/widgets/modal_barrier.dart:264`), and `BlockSemantics`
/// drops the semantics of everything painted BEFORE it — which is exactly the
/// notice, because `OfflineBannerHost.build` puts it FIRST in a `Column` above
/// the routed child. Measured 2026-09-07 in this rig:
/// `find.text('Retry')` → 1 widget, `find.byType(BlockSemantics)` → 1,
/// `find.bySemanticsLabel('Retry')` → **0 nodes**.
/// The banner sweeps correctly when it is pumped WITHOUT a router (the two
/// standalone cases below), so the sweep is real and the composition is the
/// defect. It is recorded as a residue against
/// `packages/chassis_screens/lib/shell/app_shell.dart` rather than fixed here.
void main() {
  // ── ConsentPromptCard ─────────────────────────────────────────────────────
  //
  // ⚠️ IT IS A `Positioned`, so it MUST be pumped inside a `Stack` — outside
  // one it throws `Incorrect use of ParentDataWidget` before a single
  // assertion runs. Measured while this file was written.
  group('a11y: consent-prompt-card', () {
    testWidgets('light, kPhone — both answers equally prominent', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: Stack(
              children: <Widget>[
                const Center(child: Text('the app behind the question')),
                ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
              ],
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'consent-prompt-card',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: Stack(
              children: <Widget>[
                const Center(child: Text('the app behind the question')),
                ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
              ],
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'consent-prompt-card (dark, kDesktop)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── OfflineBannerHost ─────────────────────────────────────────────────────
  group('a11y: offline-banner-host', () {
    testWidgets('light, kPhone — unreachable, so the notice and its retry are '
        'on screen', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: OfflineBannerHost(
              unreachable: true,
              onRetry: () {},
              child: const Center(child: Text('the app below the banner')),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'offline-banner-host',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: OfflineBannerHost(
              unreachable: true,
              onRetry: () {},
              child: const Center(child: Text('the app below the banner')),
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'offline-banner-host (dark, kDesktop)',
          tappable: 1,
          labelled: 3,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── ConsentScrim + AppLifecycleFlush ──────────────────────────────────────
  //
  // The scrim is MODAL and that is two lines of semantics: a semantic tap
  // dispatches straight to the widget and does NOT hit-test, so an opaque
  // `ColoredBox` stops a finger and stops nothing for TalkBack or VoiceOver.
  // These cases sweep the question that is ON TOP; that the app BEHIND is
  // excluded is `app_shell_view_test.dart`'s claim and stays there.
  group('a11y: consent-scrim', () {
    testWidgets('light, kPhone — asking', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            body: ConsentScrim(
              asking: true,
              prompt: ConsentPromptCard(
                appName: 'Probe',
                onAnswer: ({required bool granted}) {},
              ),
              child: AppLifecycleFlush(
                onBackground: () {},
                child: const Center(child: Text('the app behind the scrim')),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'consent-scrim (asking)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kDesktop — asking', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kDesktop,
          Scaffold(
            body: ConsentScrim(
              asking: true,
              prompt: ConsentPromptCard(
                appName: 'Probe',
                onAnswer: ({required bool granted}) {},
              ),
              child: AppLifecycleFlush(
                onBackground: () {},
                child: const Center(child: Text('the app behind the scrim')),
              ),
            ),
          ),
          brightness: Brightness.dark,
        );
        expectSweepHadSubjects(
          tester,
          'consent-scrim (asking, dark, kDesktop)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kPhone — NOT asking, which is the state the app spends '
        'its life in and the one that must not swallow the tree', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpForA11y(
          tester,
          kPhone,
          Scaffold(
            appBar: AppBar(title: const Text('Probe')),
            body: ConsentScrim(
              asking: false,
              prompt: ConsentPromptCard(
                appName: 'Probe',
                onAnswer: ({required bool granted}) {},
              ),
              child: AppLifecycleFlush(
                onBackground: () {},
                child: Center(
                  child: FilledButton(
                    onPressed: () {},
                    child: const Text('A control the reader must still reach'),
                  ),
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'consent-scrim (answered)',
          tappable: 1,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });

  // ── NikatruApp, composed exactly as the brick's `app.dart` composes it ─────
  group('a11y: nikatru-app', () {
    testWidgets('light, kPhone — a routed page under the whole gate chain', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(tester, 'shell', tappable: 1, labelled: 2);
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('dark, kDesktop', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kDesktop,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.dark,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'shell (dark, kDesktop)',
          tappable: 1,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kPhone — the consent question OVER the routed page, '
        'which is the first thing a new install is handed', (
      WidgetTester tester,
    ) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: true,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'shell (asking)',
          tappable: 2,
          labelled: 5,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kPhone — the force-update gate, the one screen that '
        'REPLACES the app and cannot be dismissed', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => const Scaffold(body: Center(child: Text('routed body'))),
              ),
            ),
            mustUpdate: true,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: false,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );
        expectSweepHadSubjects(
          tester,
          'shell (force update)',
          tappable: 1,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });

    testWidgets('light, kPhone — THE PIN: the offline banner is mounted and '
        'announces NOTHING through the router', (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      try {
        await pumpRootForA11y(
          tester,
          kPhone,
          NikatruApp(
            title: 'Probe',
            localizationsDelegates: ChassisLocalizations.localizationsDelegates,
            supportedLocales: ChassisLocalizations.supportedLocales,
            locale: const Locale('en'),
            theme: buildAppTheme(seed: kChassisSeed),
            darkTheme: buildAppTheme(
              seed: kChassisSeed,
              brightness: Brightness.dark,
            ),
            themeMode: ThemeMode.light,
            routerConfig: RouterConfig<Object>(
              routerDelegate: _OnePageRouterDelegate(
                () => Scaffold(
                  appBar: AppBar(title: const Text('Probe')),
                  body: Center(
                    child: FilledButton(
                      onPressed: () {},
                      child: const Text('A routed control'),
                    ),
                  ),
                ),
              ),
            ),
            mustUpdate: false,
            onUpdate: () {},
            shell: (Widget routed) => AppLifecycleFlush(
              onBackground: () {},
              child: ConsentScrim(
                asking: false,
                prompt: ConsentPromptCard(
                  appName: 'Probe',
                  onAnswer: ({required bool granted}) {},
                ),
                child: OfflineBannerHost(
                  unreachable: true,
                  onRetry: () {},
                  child: routed,
                ),
              ),
            ),
          ),
        );

        // 🔴 THE DEFECT, MEASURED. The notice IS mounted…
        expect(find.byType(OfflineNotice), findsOneWidget);
        // …a `BlockSemantics` from the page route's `ModalBarrier` sits above
        // it in paint order…
        expect(find.byType(BlockSemantics), findsOneWidget);
        // …and the reader is handed NOTHING of it. This is a `lib/` defect and
        // this unit does not own `lib/`, so it is PINNED here and recorded as a
        // residue: the day the composition is repaired, this case fails and
        // asks for the banner's nodes to join the sweep above.
        final List<String> announced = tester.semantics
            .simulatedAccessibilityTraversal()
            .map((SemanticsNode n) => n.getSemanticsData().label)
            .where((String l) => l.trim().isNotEmpty)
            .toList();
        expect(
          announced.any(
            (String l) => l.contains('Could not reach') || l == 'Retry',
          ),
          isFalse,
          reason:
              'the offline banner now announces itself through the router — '
              'REPAIRED. Delete this pin and add the banner to the swept '
              'shell case above, with the tappable floor raised by one.',
        );

        // What the reader IS handed is still swept, so this case is a
        // measurement and not only a complaint.
        expectSweepHadSubjects(
          tester,
          'shell (offline, banner unannounced)',
          tappable: 1,
          labelled: 2,
        );
        await expectLater(tester, meetsGuideline(androidTapTargetGuideline));
        await expectLater(tester, meetsGuideline(labeledTapTargetGuideline));
        await expectLater(tester, meetsGuideline(textContrastGuideline));
      } finally {
        handle.dispose();
      }
    });
  });
}

/// One page, no navigation — the same shape `app_shell_view_test.dart` uses,
/// and for the same reason: `onGenerateRoute` compiles on both the SDK on this
/// workstation and the one `ci.yml` pins, where the declarative `pages` API's
/// callback was renamed between them.
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
