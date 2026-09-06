import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/check_inbox_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `CheckInboxView` — the screen a SESSIONLESS sign-up lands on.
///
/// 🏗️ The widget half of `property: sessionless-signup-reaches-check-inbox`.
/// That the sign-up NAVIGATES here is the wiring half and stays in the brick's
/// `chassis_properties_test.dart`, which boots the stamped root.
void main() {
  Widget view({
    String email = 'someone@example.com',
    VoidCallback? onBackToSignIn,
  }) =>
      CheckInboxView(
        email: email,
        onBackToSignIn: onBackToSignIn ?? () {},
      );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  group('property: check-inbox-fills-the-form-pane at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester
          .getSize(find.byKey(CheckInboxView.backToSignInButton))
          .width;
    }

    testWidgets('kPhone — narrower than the cap, so the pane yields',
        (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kPhone), lessThan(kPhone.width));
    });

    testWidgets('kTablet — the cap holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kTablet), AppBreakpoints.form);
    });

    testWidgets('kDesktop — the cap still holds', (WidgetTester tester) async {
      expect(await paneWidthAt(tester, kDesktop), AppBreakpoints.form);
    });
  });

  // ── (2) NAMING THE ADDRESS IS THE WHOLE JOB ───────────────────────────────
  testWidgets('property: check-inbox-names-the-address',
      (WidgetTester tester) async {
    await pumpChassis(tester, kPhone, view(email: 'typo@exmaple.com'));
    expect(find.textContaining('typo@exmaple.com'), findsOneWidget);
  });

  // ── (3) THERE IS A WAY OUT, AND IT IS THE PRIMARY ACTION ──────────────────
  //
  // 🔴 WITHOUT IT THE SCREEN IS A DEAD END, which is the defect it was built to
  // remove: confirming happens in a mail client, and the next thing this app
  // can do for them is take their password.
  testWidgets('property: check-inbox-is-not-a-dead-end',
      (WidgetTester tester) async {
    int back = 0;
    await pumpChassis(tester, kPhone, view(onBackToSignIn: () => back++));
    await tester.tap(find.byKey(CheckInboxView.backToSignInButton));
    await tester.pump();
    expect(back, 1);
  });

  // ── (4) NO RESEND CONTROL, AND THAT IS A PROPERTY OF THE STATE ────────────
  //
  // `resendVerificationEmail()` aims at the CURRENT session and there is none
  // here. A button that could only throw is worse than no button.
  testWidgets('property: check-inbox-offers-no-resend',
      (WidgetTester tester) async {
    await pumpChassis(tester, kPhone, view());
    expect(find.byType(OutlinedButton), findsNothing);
    expect(find.byType(FilledButton), findsOneWidget);
  });
}
