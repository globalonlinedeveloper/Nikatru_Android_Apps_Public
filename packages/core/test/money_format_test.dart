// MoneyFormatter, tested in the package that owns it. The cases are the ones
// apps/subscriptiontracker/test/logic_test.dart has carried since the formatter
// replaced the en_US-hardcoded one; they stay there too, where they now
// exercise the app's re-export path.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// `intl` separates a LETTER-ended currency symbol from its number with a
/// NON-BREAKING space (U+00A0) — correct rendering, and invisible in a failure
/// message, where `ZZZ 4.99` and `ZZZ 4.99` print identically and differ
/// at offset 3. Normalised here so an assertion about the CODE is not secretly
/// an assertion about which space character intl chose.
String plain(String s) => s.replaceAll(' ', ' ');

void main() {
  group('MoneyFormatter — the money and the reader are two axes', () {
    test(r'USD under en_US formats with the $ symbol and two decimals', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      expect(f.format(const Money(1000, 'USD')), r'$10.00');
      expect(f.formatRounded(const Money(123400, 'USD')), r'$1,234');
    });

    test('other currencies RE-SYMBOL the stored number, never convert it', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      expect(f.format(const Money(1000, 'EUR')), '€10.00');
      expect(f.format(const Money(100, 'INR')), '₹1.00');
      // The measured bug this replaces: a 499-rupee plan entered as 499
      // rendered as 41,417, because a hardcoded FX table multiplied by 83.
      expect(f.formatRounded(const Money(49900, 'INR')), '₹499');
    });

    test('the same amount under two currencies differs ONLY by the symbol', () {
      // The per-currency expectations above are not what catches a rate table:
      // whoever adds one just updates them to match. The relationship BETWEEN
      // currencies is the assertion no conversion can satisfy, so it is the one
      // that would have caught the original bug.
      //
      // 🔴 THE COMPARISON NO LONGER SLICES THE FIRST CODE UNIT OFF. The old
      // form was `usd.fmt(499).substring(1)`, which assumed a one-code-unit
      // symbol glued to the FRONT — true only because the old formatter did
      // exactly that in every locale. A formatter that honours the locale can
      // put the symbol behind the number (de_DE) or use a two-character one
      // (A$), so the symbol is REPLACED rather than positionally removed and
      // the invariant survives the thing that used to break it.
      const MoneyFormatter f = MoneyFormatter('en_US');
      final String usd = f
          .format(const Money(49900, 'USD'))
          .replaceFirst(Money.symbolFor('USD')!, '¤');
      final String usd0 = f
          .formatRounded(const Money(123400, 'USD'))
          .replaceFirst(Money.symbolFor('USD')!, '¤');
      for (final String code in const <String>['EUR', 'GBP', 'INR']) {
        expect(
          f
              .format(Money(49900, code))
              .replaceFirst(Money.symbolFor(code)!, '¤'),
          usd,
        );
        expect(
          f
              .formatRounded(Money(123400, code))
              .replaceFirst(Money.symbolFor(code)!, '¤'),
          usd0,
        );
      }
    });

    test('🔴 GROUPING FOLLOWS THE READER, NOT THE MONEY', () {
      // THE DEFECT, in one assertion. The old formatter was
      // `NumberFormat('#,##0.00', 'en_US')` — a locale compiled in and a
      // reader's own convention ignored — so one and a quarter million rupees
      // came out `1,250,000` for every user on earth. India groups the last
      // three digits and then in pairs.
      const Money lakhs = Money(125000000, 'INR');
      expect(const MoneyFormatter('en_US').formatRounded(lakhs), '₹1,250,000');
      expect(const MoneyFormatter('ta').formatRounded(lakhs), '₹12,50,000');
      expect(const MoneyFormatter('en_IN').formatRounded(lakhs), '₹12,50,000');
    });

    test('the two axes are INDEPENDENT — an Indian reader, a US price', () {
      // The case a single "currency setting" cannot express: Indian grouping
      // around a dollar sign, with the dollar's own two decimal places.
      expect(
        const MoneyFormatter('en_IN').format(const Money(125000000, 'USD')),
        r'$12,50,000.00',
      );
    });

    test('decimal places follow the CURRENCY, not a hardcoded two', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      expect(f.format(const Money(500, 'JPY')), '¥500');
      expect(plain(f.format(const Money(1005, 'KWD'))), 'KWD 1.005');
    });

    test('an unknown currency prints its CODE rather than a guessed glyph', () {
      expect(
        plain(const MoneyFormatter('en_US').format(const Money(499, 'ZZZ'))),
        'ZZZ 4.99',
      );
    });

    test('an unknown locale DEGRADES to en_US instead of throwing', () {
      // The same trap `subscriptions_controller.dart` records for DateFormat:
      // a formatter built outside a MaterialApp can only be sure of `en_US`.
      // Throwing here would surface as an unrelated failure somewhere else.
      expect(
        const MoneyFormatter('zz_ZZ').format(const Money(1000, 'USD')),
        r'$10.00',
      );
    });

    test('an EMPTY total reads in the currency the caller names', () {
      // A new user who has chosen the rupee and added nothing yet must not be
      // shown a dollar zero on the home hero. An empty bag has no currency of
      // its own, so the screen supplies the one it would have been in.
      const MoneyBag nothing = MoneyBag(<String, Money>{});
      expect(const MoneyFormatter('en_US').formatBag(nothing), r'$0.00');
      expect(
        const MoneyFormatter(
          'en_US',
          emptyCurrencyCode: 'INR',
        ).formatBag(nothing),
        '₹0.00',
      );
    });

    test('a mixed total prints EVERY subtotal and converts none of them', () {
      const MoneyFormatter f = MoneyFormatter('en_US');
      final MoneyBag bag = MoneyBag.sum(const <Money>[
        Money(4000, 'USD'),
        Money(49900, 'INR'),
      ]);
      expect(f.formatBag(bag), r'$40.00 + ₹499.00');
      expect(f.formatBagRounded(bag), r'$40 + ₹499');
    });
  });
}
