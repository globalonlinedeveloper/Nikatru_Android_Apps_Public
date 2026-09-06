import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/monetization/manage_plan_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `ManagePlanView` — the ROSCA cancel surface.
///
/// 🏗️ The widget half. That the cancel really reaches
/// `PurchaseRail.requestCancellation()` and that the entitlement is re-read
/// afterwards are wiring halves and stay in the brick suite.
void main() {
  Widget view({
    bool isPro = true,
    bool busy = false,
    String? outcomeMessage,
    VoidCallback? onBack,
    VoidCallback? onRestore,
    VoidCallback? onCancel,
  }) => ManagePlanView(
    title: 'Manage plan',
    isPro: isPro,
    planStatusLabel: isPro ? 'Your plan is active' : 'No active plan',
    restoreHint: 'Sign in on a new device and your plan follows you',
    cancelLabel: 'Cancel plan',
    busy: busy,
    outcomeMessage: outcomeMessage,
    onBack: onBack ?? () {},
    onRestore: onRestore ?? () {},
    onCancel: onCancel ?? () {},
  );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // ROSCA is a rule about how hard the control is to FIND, and layout is part of
  // how hard something is to find: unconstrained, the cancel row's label sat a
  // full window away from the icon that identifies it on a desktop.
  group('property: manage-plan-page-is-capped at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byType(ListView)).width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kPhone), kPhone.width);
    });

    testWidgets('kTablet — still under the page cap', (
      WidgetTester tester,
    ) async {
      expect(await paneWidthAt(tester, kTablet), kTablet.width);
    });

    testWidgets('kDesktop — the page cap engages', (
      WidgetTester tester,
    ) async {
      expect(
        await paneWidthAt(tester, kDesktop),
        AppBreakpoints.kMaxBodyWidth,
      );
    });
  });

  // ── (2) THE CANCEL ENTRY IS ONE TAP FROM HERE, AND ONLY WHEN THERE IS A
  //        PLAN TO CANCEL ────────────────────────────────────────────────────
  group('property: manage-plan-controls', () {
    testWidgets('an active plan offers BOTH restore and cancel, one tap each', (
      WidgetTester tester,
    ) async {
      int cancelled = 0;
      int restored = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(onCancel: () => cancelled++, onRestore: () => restored++),
      );
      await tester.tap(find.byKey(ManagePlanView.cancelTile));
      await tester.tap(find.byKey(ManagePlanView.restoreTile));
      expect(cancelled, 1);
      expect(restored, 1);
    });

    testWidgets('no active plan hides the cancel row — there is nothing to '
        'cancel, and offering it is an offer the app cannot honour', (
      WidgetTester tester,
    ) async {
      await pumpChassis(tester, kPhone, view(isPro: false));
      expect(find.byKey(ManagePlanView.cancelTile), findsNothing);
      expect(find.byKey(ManagePlanView.restoreTile), findsOneWidget);
    });

    testWidgets('a request in flight disables EVERY control, so a second tap '
        'cannot start a second cancellation', (WidgetTester tester) async {
      int cancelled = 0;
      // `settle: false` — the busy bar is a `LinearProgressIndicator` and it
      // never stops animating, so `pumpAndSettle` would time out on the very
      // state this case is about.
      await pumpChassis(
        tester,
        kPhone,
        view(busy: true, onCancel: () => cancelled++),
        settle: false,
      );
      expect(find.byType(LinearProgressIndicator), findsOneWidget);
      await tester.tap(find.byKey(ManagePlanView.cancelTile));
      expect(cancelled, 0);
    });

    testWidgets('the outcome sentence is RENDERED, not swallowed', (
      WidgetTester tester,
    ) async {
      await pumpChassis(
        tester,
        kPhone,
        view(outcomeMessage: 'We have recorded your request'),
      );
      expect(find.text('We have recorded your request'), findsOneWidget);
    });
  });

  // ── (3) THE WAY OUT ───────────────────────────────────────────────────────
  //
  // The screen is reached with `context.go`, which REPLACES the stack, so
  // `AppBar` never built a back control of its own. On the one screen whose job
  // is "cancelling must be no harder than subscribing", that left no way out.
  testWidgets('the explicit back control is present and calls onBack', (
    WidgetTester tester,
  ) async {
    bool back = false;
    await pumpChassis(tester, kPhone, view(onBack: () => back = true));
    await tester.tap(find.byType(BackButton));
    expect(back, isTrue);
  });
}
