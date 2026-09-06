import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/firstrun/onboarding_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `OnboardingView` — the first-run carousel.
///
/// 🏗️ The widget half of `property: onboarding-shown-once`. That the flag is
/// WRITTEN, that the router sends a fresh install here, and that an app-config
/// override replaces the chassis default are all wiring halves and stay in the
/// brick suite — the override read is anchored in the brick adapter by
/// `assert-config-registry.mjs` and `assert-stamp-properties.mjs:1094`.
void main() {
  // Long enough that the paragraph WANTS more than 720 px. A short string would
  // measure its own width at every window and pass with the cap deleted, which
  // is the shape this case exists to refuse.
  const String longBody =
      'A body long enough to want the whole window, so the reading cap is what '
      'decides the line length rather than the string running out first, which '
      'is the defect this measurement exists to catch on a wide display.';

  const List<OnboardingPage> pages = <OnboardingPage>[
    OnboardingPage(title: 'One', body: longBody),
    OnboardingPage(title: 'Two', body: 'The second thing'),
    OnboardingPage(title: 'Three', body: 'The third thing'),
  ];

  Widget view({VoidCallback? onFinish}) =>
      OnboardingView(pages: pages, onFinish: onFinish ?? () {});

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // 🔴 THE ONE SCREEN WHERE THE DAMAGE IS TYPOGRAPHIC. Unconstrained, the body
  // ran 1216 px lines on a 1280 px window — roughly 200 characters, three times
  // the 45–75 the eye can track. `.reading` (720) is the constant that says
  // "this is continuous prose", and it is asserted at two windows above it so a
  // deleted cap cannot pass by the window happening to be narrow.
  group('property: onboarding-reads-at-every-window-class', () {
    // The PARAGRAPH, not the pane box: `ContentPane` hands its child LOOSENED
    // constraints, so the `ConstrainedBox` itself reports the child's intrinsic
    // width. What the cap actually decides is how long a line gets, and that is
    // what is measured — minus the 32 px of padding on each side, which sits
    // INSIDE the cap exactly as the `Padding` it replaced did.
    const double gutters = 64;
    Future<double> lineWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.text(longBody).first).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields', (
      WidgetTester tester,
    ) async {
      expect(await lineWidthAt(tester, kPhone), kPhone.width - gutters);
    });

    testWidgets('kTablet — the reading cap holds', (
      WidgetTester tester,
    ) async {
      expect(
        await lineWidthAt(tester, kTablet),
        AppBreakpoints.reading - gutters,
      );
    });

    testWidgets('kDesktop — the reading cap still holds', (
      WidgetTester tester,
    ) async {
      expect(
        await lineWidthAt(tester, kDesktop),
        AppBreakpoints.reading - gutters,
      );
    });
  });

  // ── (2) IT CAN ALWAYS BE LEFT ─────────────────────────────────────────────
  group('property: onboarding-is-never-a-wall', () {
    testWidgets('SKIP is on the FIRST page and finishes immediately — an '
        'onboarding a user cannot leave is a wall, and both stores treat an '
        'unskippable first run as a dark pattern', (WidgetTester tester) async {
      bool finished = false;
      await pumpChassis(tester, kPhone, view(onFinish: () => finished = true));
      expect(find.text('One'), findsOneWidget);
      await tester.tap(find.byKey(OnboardingView.skipButton));
      expect(finished, isTrue);
    });

    testWidgets('the primary control ADVANCES until the last page, and only '
        'then finishes', (WidgetTester tester) async {
      int finished = 0;
      await pumpChassis(tester, kPhone, view(onFinish: () => finished++));

      await tester.tap(find.byKey(OnboardingView.advanceButton));
      await tester.pumpAndSettle();
      expect(find.text('Two'), findsOneWidget);
      expect(finished, 0);

      await tester.tap(find.byKey(OnboardingView.advanceButton));
      await tester.pumpAndSettle();
      expect(find.text('Three'), findsOneWidget);
      expect(finished, 0);

      await tester.tap(find.byKey(OnboardingView.advanceButton));
      expect(finished, 1);
    });

    testWidgets('the dots track the page — one filled, the rest outlined', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view());
      expect(find.byIcon(Icons.circle), findsOneWidget);
      expect(find.byIcon(Icons.circle_outlined), findsNWidgets(2));
    });
  });
}
