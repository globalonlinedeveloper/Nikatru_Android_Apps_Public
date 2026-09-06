import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/verify_email_screen.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `VerifyEmailView` — the three controls, and what each one is FOR.
///
/// 🏗️ The widget half of `property: auth-redirect-follows-session`. The wiring
/// half — that an unverified session is redirected here at all — stays in the
/// brick's `chassis_properties_test.dart`, where the stamped root is booted.
void main() {
  Widget view({
    String email = 'someone@example.com',
    Future<bool> Function()? onCheckConfirmed,
    Future<void> Function()? onResend,
    Future<void> Function()? onSignOut,
  }) =>
      VerifyEmailView(
        email: email,
        onCheckConfirmed: onCheckConfirmed ?? () async => false,
        onResend: onResend ?? () async {},
        onSignOut: onSignOut ?? () async {},
      );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  // Written out rather than looped: the guard reads the window CONSTANT out of
  // an argument position in this file.
  group('property: verify-email-fills-the-form-pane at every window class', () {
    Future<double> paneWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, view());
      return tester.getSize(find.byKey(VerifyEmailView.continueButton)).width;
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

  // ── (2) THE ADDRESS IS NAMED ──────────────────────────────────────────────
  //
  // A mistyped address is visible on this screen and nowhere else: the mail
  // went somewhere, and the only person who can tell it went to the wrong place
  // is the one reading it here.
  testWidgets('property: verify-email-names-the-address',
      (WidgetTester tester) async {
    await pumpChassis(tester, kPhone, view(email: 'typo@exmaple.com'));
    expect(find.textContaining('typo@exmaple.com'), findsOneWidget);
  });

  // ── (3) "I'VE CONFIRMED" ASKS THE SERVER AGAIN, AND SAYS SO WHEN IT IS NO ─
  //
  // 🔴 STILL UNVERIFIED IS A REAL ANSWER, NOT AN ERROR. Nothing pushes the
  // answer at a running app — the link is opened in a mail client, often on
  // another device — so without this control the only way out is to kill the
  // app, which reads as the app being broken.
  group('property: verify-email-rechecks-the-server', () {
    testWidgets('a still-unverified answer is shown inline',
        (WidgetTester tester) async {
      int asked = 0;
      await pumpChassis(
        tester,
        kPhone,
        view(onCheckConfirmed: () async {
          asked++;
          return true;
        }),
      );
      await tester.tap(find.byKey(VerifyEmailView.continueButton));
      await tester.pumpAndSettle();

      expect(asked, 1);
      expect(find.byKey(VerifyEmailView.statusLine), findsOneWidget);
    });

    testWidgets('a confirmed answer leaves no notice behind',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(onCheckConfirmed: () async => false),
      );
      await tester.tap(find.byKey(VerifyEmailView.continueButton));
      await tester.pumpAndSettle();
      expect(find.byKey(VerifyEmailView.statusLine), findsNothing);
    });
  });

  // ── (4) RESEND, AND THE WAY OUT ───────────────────────────────────────────
  group('property: verify-email-offers-a-resend-and-an-exit', () {
    testWidgets('resend calls the seam and confirms it',
        (WidgetTester tester) async {
      int sent = 0;
      await pumpChassis(tester, kPhone, view(onResend: () async => sent++));
      await tester.tap(find.byKey(VerifyEmailView.resendButton));
      await tester.pumpAndSettle();
      expect(sent, 1);
      expect(find.byKey(VerifyEmailView.statusLine), findsOneWidget);
    });

    testWidgets('sign-out is reachable — the gate is not a locked door',
        (WidgetTester tester) async {
      int out = 0;
      await pumpChassis(tester, kPhone, view(onSignOut: () async => out++));
      await tester.tap(find.byKey(VerifyEmailView.signOutButton));
      await tester.pumpAndSettle();
      expect(out, 1,
          reason:
              'a user who mistyped their address has no other move: the account '
              'exists and they cannot reach the app');
    });

    testWidgets('a failure from any control is SHOWN, never swallowed',
        (WidgetTester tester) async {
      await pumpChassis(
        tester,
        kPhone,
        view(onResend: () async => throw StateError('network is gone')),
      );
      await tester.tap(find.byKey(VerifyEmailView.resendButton));
      await tester.pumpAndSettle();
      expect(
        tester.widget<Text>(find.byKey(VerifyEmailView.statusLine)).data,
        contains('network is gone'),
      );
    });
  });
}
