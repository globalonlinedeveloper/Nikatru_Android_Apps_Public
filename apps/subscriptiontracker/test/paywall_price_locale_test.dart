// 🔴 THE PROOF THAT THE ONE SCREEN WHICH TAKES MONEY FORMATS IT LIKE EVERY
// OTHER SCREEN.
//
// The paywall rendered `Offering.formattedPrice`: `toStringAsFixed` with a
// glued symbol and NO grouping, so twelve and a half lakh rupees (125,000,000
// paise) read `₹1250000.00` in every locale — while the home hero, the budget,
// the calendar and every total in the app go through `MoneyFormatter` under
// the reader's locale. A Tamil reader groups the lakh (`12,50,000`); an
// English reader groups the thousand (`1,250,000`). Neither reads an ungrouped
// seven-digit string on the screen that asks them to pay.
//
// Real `PaywallScreen`, real `AppLocalizations`, real `MoneyFormatter` — the
// only fake is the rail, which supplies an INR offering.
//
// MUTATION PROOF (run and recorded in the PR): put `Text(o.formattedPrice)`
// back in paywall_screen.dart and both locale cases go red.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;
import 'package:nikatru_purchases/nikatru_purchases.dart';
import 'package:subscriptiontracker/features/monetization/paywall_screen.dart';
import 'package:subscriptiontracker/l10n/app_localizations.dart';
import 'package:subscriptiontracker/state/money_providers.dart';
import 'package:subscriptiontracker/state/providers.dart';

import 'support/width_harness.dart';

class _MemSecureStore implements core.SecureStore {
  final Map<String, String> data = <String, String>{};
  @override
  Future<void> delete(String key) async => data.remove(key);
  @override
  Future<void> deleteAll() async => data.clear();
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
}

/// Twelve and a half lakh rupees — the figure where the two groupings differ
/// in every separator position.
class _InrRail implements PurchaseRail {
  @override
  List<Offering> get offerings => const <Offering>[
    Offering(
      productId: 'pro_lifetime_inr',
      amountMinor: 125000000,
      currencyCode: 'INR',
      term: OfferingTerm.year,
      trialDays: 0,
    ),
  ];

  @override
  bool get canStartCheckout => true;

  @override
  Future<CheckoutStart> startCheckout(Offering offering) async =>
      const CheckoutRefused(
        CheckoutRefusal.notSignedIn,
        detail: 'this test buys nothing',
      );

  @override
  Future<CancellationOutcome> requestCancellation() async =>
      CancellationOutcome.noActivePlan;
}

Future<void> _pump(WidgetTester tester, Locale locale) async {
  await tester.binding.setSurfaceSize(const Size(800, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final ProviderContainer c = ProviderContainer(
    overrides: <Override>[
      ...defaultWidthOverrides(),
      secureStoreProvider.overrideWithValue(_MemSecureStore()),
      purchaseRailProvider.overrideWithValue(_InrRail()),
    ],
  );
  addTearDown(c.dispose);
  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: c,
      child: MaterialApp(
        locale: locale,
        localizationsDelegates: const <LocalizationsDelegate<Object>>[
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales,
        home: const PaywallScreen(),
      ),
    ),
  );
  for (int i = 0; i < 5; i++) {
    await tester.pump();
  }
}

void main() {
  testWidgets('🔴 Tamil: the lakh is grouped — ₹12,50,000.00', (
    WidgetTester tester,
  ) async {
    await _pump(tester, const Locale('ta'));
    expect(find.text('₹12,50,000.00'), findsOneWidget);
    expect(find.textContaining('1250000'), findsNothing);
  });

  testWidgets('🔴 English: the thousand is grouped — ₹1,250,000.00', (
    WidgetTester tester,
  ) async {
    await _pump(tester, const Locale('en'));
    expect(find.text('₹1,250,000.00'), findsOneWidget);
    expect(find.textContaining('1250000'), findsNothing);
  });
}
