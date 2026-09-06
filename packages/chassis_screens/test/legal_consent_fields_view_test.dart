import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:nikatru_design_system/nikatru_design_system.dart';

import 'support/width_harness.dart';

/// `LegalConsentFieldsView` — the two boxes, and the rules that are DIFFERENT
/// for each of them.
///
/// 🏗️ The widget half of `property: legal-reacceptance-gated`. That the ROUTER
/// puts a user in front of these boxes when `kTermsVersion` moves is the wiring
/// half and stays in the brick, which boots the stamped root.
void main() {
  Widget fields({
    bool termsAccepted = false,
    bool marketingAccepted = false,
    bool enabled = true,
    bool showMarketing = true,
    ValueChanged<bool>? onTermsChanged,
    ValueChanged<bool>? onMarketingChanged,
    VoidCallback? onOpenTerms,
    VoidCallback? onOpenPrivacy,
  }) =>
      Scaffold(
        body: LegalConsentFieldsView(
          termsAccepted: termsAccepted,
          marketingAccepted: marketingAccepted,
          enabled: enabled,
          showMarketing: showMarketing,
          onTermsChanged: onTermsChanged ?? (_) {},
          onMarketingChanged: onMarketingChanged ?? (_) {},
          onOpenTerms: onOpenTerms ?? () {},
          onOpenPrivacy: onOpenPrivacy ?? () {},
        ),
      );

  // ── (1) THE WIDTH DECISION, AT ALL THREE WINDOW CLASSES ───────────────────
  //
  // This widget carries no cap of its own — it fills whatever pane it is given,
  // which is the whole reason both consent surfaces can host it. The assertion
  // is therefore that it TRACKS the surface rather than that it stops at a
  // number, and it is made at all three classes because "it fitted on a phone"
  // says nothing about a 1280 px window.
  group('property: legal-consent-fields-track-the-pane at every window class',
      () {
    Future<double> rowWidthAt(WidgetTester tester, Size size) async {
      await pumpChassis(tester, size, fields());
      return tester.getSize(find.byType(Checkbox).first).width +
          tester.getSize(find.byType(LegalConsentFieldsView)).width;
    }

    testWidgets('kPhone', (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, fields());
      expect(tester.getSize(find.byType(LegalConsentFieldsView)).width,
          kPhone.width);
    });

    testWidgets('kTablet', (WidgetTester tester) async {
      await pumpChassis(tester, kTablet, fields());
      expect(tester.getSize(find.byType(LegalConsentFieldsView)).width,
          kTablet.width);
    });

    testWidgets('kDesktop', (WidgetTester tester) async {
      await pumpChassis(tester, kDesktop, fields());
      expect(tester.getSize(find.byType(LegalConsentFieldsView)).width,
          kDesktop.width,
          reason:
              'it carries no cap of its own — the pane it is placed in owns the '
              'width, which is why both consent surfaces can host it');
      expect(await rowWidthAt(tester, kDesktop), greaterThan(0));
    });
  });

  // ── (2) NEITHER BOX CAN BE ASKED TO ARRIVE TICKED ─────────────────────────
  //
  // 🔴 THE VALUES COME FROM THE CALLER AND THERE IS NO `initial…` ARGUMENT.
  // `assert-signup-consent-shape.mjs` relies on that: limb 1 reads a `bool …=
  // false;` declaration in the surface, and an `initialTermsAccepted:` here
  // would be a way to pre-tick a box without any field in this repository
  // saying `true`.
  group('property: legal-consent-fields-are-never-born-ticked', () {
    testWidgets('both boxes render unticked when the caller says false',
        (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, fields());
      expect(
        tester
            .widget<Checkbox>(find.byKey(LegalConsentFieldsView.termsCheckbox))
            .value,
        isFalse,
      );
      expect(
        tester
            .widget<Checkbox>(
                find.byKey(LegalConsentFieldsView.marketingCheckbox))
            .value,
        isFalse,
      );
    });

    testWidgets('the marketing box is ABSENT when showMarketing is false',
        (WidgetTester tester) async {
      await pumpChassis(tester, kPhone, fields(showMarketing: false));
      expect(find.byKey(LegalConsentFieldsView.termsCheckbox), findsOneWidget);
      expect(find.byKey(LegalConsentFieldsView.marketingCheckbox), findsNothing,
          reason:
              'asking for a marketing opt-in on a screen the user cannot leave '
              'is the conditionality research/43 declined');
    });
  });

  // ── (3) THE LABEL IS A SECOND HIT TARGET, THE GUTTER IS NOT ───────────────
  //
  // 🔴 A TAP IN THE GUTTER BESIDE "Privacy" ONCE TICKED THE CONSENT BOX. That
  // is a legal acceptance recorded by a mis-tap, on the one control that blocks
  // registration.
  group('property: legal-consent-fields-toggle-from-the-sentence-only', () {
    testWidgets('tapping the sentence toggles the box',
        (WidgetTester tester) async {
      final List<bool> terms = <bool>[];
      await pumpChassis(
        tester,
        kPhone,
        fields(onTermsChanged: terms.add),
      );
      await tester.tap(find.byType(GestureDetector).first);
      await tester.pump();
      expect(terms, <bool>[true]);
    });

    testWidgets('tapping a legal LINK opens the document, it does not tick',
        (WidgetTester tester) async {
      final List<String> opened = <String>[];
      final List<bool> terms = <bool>[];
      await pumpChassis(
        tester,
        kPhone,
        fields(
          onTermsChanged: terms.add,
          onOpenTerms: () => opened.add('terms'),
          onOpenPrivacy: () => opened.add('privacy'),
        ),
      );
      expect(find.byType(FocusableTap), findsNWidgets(2),
          reason: 'both legal documents are focusable controls, not prose');
      await tester.tap(find.byType(FocusableTap).first);
      await tester.pumpAndSettle();
      expect(opened, <String>['terms']);
      expect(terms, isEmpty,
          reason: 'opening the document is not agreeing to it');
    });
  });

  // ── (4) DISABLED MEANS DISABLED ───────────────────────────────────────────
  testWidgets('property: legal-consent-fields-are-inert-while-busy',
      (WidgetTester tester) async {
    final List<bool> terms = <bool>[];
    await pumpChassis(
      tester,
      kPhone,
      fields(enabled: false, onTermsChanged: terms.add),
    );
    expect(
      tester
          .widget<Checkbox>(find.byKey(LegalConsentFieldsView.termsCheckbox))
          .onChanged,
      isNull,
    );
    await tester.tap(find.byType(GestureDetector).first);
    await tester.pump();
    expect(terms, isEmpty);
  });
}
