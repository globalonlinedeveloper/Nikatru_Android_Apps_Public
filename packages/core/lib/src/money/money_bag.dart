import 'money.dart';

/// A total over amounts that may be in DIFFERENT currencies: one subtotal per
/// currency, and never a single number.
///
/// ## Why this type exists instead of a `Money` total
/// [Money.operator +] refuses to add unlike currencies, which is correct and
/// leaves every caller that folds a list with a problem: a user tracking a
/// dollar subscription and a rupee one still has to be shown a monthly total.
/// The two honest answers are "convert with a dated rate" and "report both",
/// and this codebase has no rate source, so this is the second one made
/// explicit.
///
/// 🔴 THE DISHONEST ANSWER IS THE ONE THIS REPLACES. Folding unlike units into
/// a double produced a number that looked exactly like a real total. Nothing
/// downstream — no test, no type, no reviewer reading the screen — could tell
/// the difference between "you spend 91.48 a month" and "you spend 40.00 plus
/// 5148 rupees a month, added together as if the units matched".
///
/// The overwhelmingly common case is ONE currency, where [isMixed] is false and
/// [single] is the ordinary total. Mixed is the rare case, and it is the one
/// that has to stop being silently wrong.
class MoneyBag {
  const MoneyBag(this.byCurrency);

  /// Empty in [currencyCode] — a bag with one zero subtotal, so a caller with
  /// no rows still has something to render under the user's chosen currency.
  MoneyBag.zero(String currencyCode)
      : byCurrency = <String, Money>{currencyCode: Money.zero(currencyCode)};

  /// Sums [amounts], grouping by currency code. Insertion order is preserved,
  /// so the currency the user's first row is in leads the rendering.
  factory MoneyBag.sum(Iterable<Money> amounts) {
    final Map<String, Money> totals = <String, Money>{};
    for (final Money m in amounts) {
      final Money? running = totals[m.currencyCode];
      totals[m.currencyCode] = running == null ? m : running + m;
    }
    return MoneyBag(totals);
  }

  /// Subtotal per ISO 4217 code. Empty only when nothing was summed.
  final Map<String, Money> byCurrency;

  bool get isEmpty => byCurrency.isEmpty;
  bool get isMixed => byCurrency.length > 1;

  /// The subtotals, in insertion order.
  Iterable<Money> get amounts => byCurrency.values;

  /// The one subtotal, when there is exactly one currency in play.
  ///
  /// Throws [StateError] when the bag is mixed or empty, because there is no
  /// honest single answer in either case and returning a zero would be a
  /// missing total wearing a number.
  Money get single {
    if (byCurrency.length != 1) {
      throw StateError(
        'MoneyBag.single on a bag holding ${byCurrency.length} currencies '
        '(${byCurrency.keys.join(', ')}). Render every subtotal, or ask for '
        'the one in a named currency.',
      );
    }
    return byCurrency.values.first;
  }

  /// The subtotal in [currencyCode], or a zero in that currency when this bag
  /// holds none. Safe because the currency is NAMED by the caller, so nothing
  /// is being merged across units.
  Money inCurrency(String currencyCode) =>
      byCurrency[currencyCode] ?? Money.zero(currencyCode);

  /// Every subtotal multiplied by a count — a per-year figure from a per-month
  /// one, for instance. Still a count, never a rate.
  MoneyBag times(int factor) => MoneyBag(<String, Money>{
        for (final MapEntry<String, Money> e in byCurrency.entries)
          e.key: e.value.times(factor),
      });

  @override
  String toString() =>
      'MoneyBag(${byCurrency.values.map((Money m) => m.toString()).join(', ')})';
}
