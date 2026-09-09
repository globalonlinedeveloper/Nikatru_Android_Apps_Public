import 'package:nikatru_core/nikatru_core.dart' show Money, MoneyBag;

import '../../data/models/subscription.dart';

class CategoryTotal {
  const CategoryTotal(this.name, this.value);
  final String name;

  /// A bag, not a [Money]: one category can hold rows in two currencies, and
  /// there is no rate table here to collapse them with.
  final MoneyBag value;
}

/// Pure derivations shared by Home / Insights / Budget / Calendar.
///
/// 🔴 EVERY TOTAL HERE IS A [MoneyBag], AND THAT IS THE DEFECT BEING CLOSED.
/// These folds used to run over `double`, which meant a user with a dollar
/// subscription and a rupee one got a single number that was the sum of two
/// unlike units — arithmetically fine, financially meaningless, and impossible
/// for anything downstream to detect because it looked exactly like a real
/// total. A bag keeps the subtotals apart; the formatter renders every one of
/// them. There is deliberately no conversion (see `Money`): an honest
/// cross-currency figure needs a DATED rate, and v1 has no source for one.
///
/// For the overwhelmingly common single-currency user, every function below
/// produces a one-entry bag and every screen renders exactly what it did.
class SubMath {
  SubMath._();

  static MoneyBag totalMonthly(List<Subscription> s) =>
      MoneyBag.sum(s.map((Subscription x) => x.monthlyPrice));

  static List<CategoryTotal> categoryTotals(List<Subscription> s) {
    final Map<String, List<Money>> m = <String, List<Money>>{};
    for (final Subscription x in s) {
      (m[x.category] ??= <Money>[]).add(x.monthlyPrice);
    }
    final List<CategoryTotal> list = m.entries
        .map(
          (MapEntry<String, List<Money>> e) =>
              CategoryTotal(e.key, MoneyBag.sum(e.value)),
        )
        .toList();
    list.sort(
      (CategoryTotal a, CategoryTotal b) =>
          _compareDesc(_orderKey(a.value), _orderKey(b.value), _order(s)),
    );
    return list;
  }

  static List<Subscription> byMonthlyDesc(List<Subscription> s) {
    final List<String> order = _order(s);
    final List<Subscription> l = List<Subscription>.of(s);
    l.sort(
      (Subscription a, Subscription b) =>
          _compareDesc(a.monthlyPrice, b.monthlyPrice, order),
    );
    return l;
  }

  /// The currency codes in the order they first appear in [s].
  ///
  /// 🔴 ORDERING ACROSS CURRENCIES IS A PRESENTATION RULE AND NEVER A CLAIM
  /// THAT THE AMOUNTS COMPARE. "Is 40 dollars more than 3000 rupees" has no
  /// answer here, so the rule below never asks it: rows GROUP by currency, the
  /// groups run in order of first appearance, and only WITHIN a group does the
  /// amount decide. That is a well-defined total order, it is stable, and for
  /// a single-currency list — everyone, in practice — it is byte-for-byte the
  /// old "biggest first".
  static List<String> _order(List<Subscription> s) {
    final List<String> order = <String>[];
    for (final Subscription x in s) {
      if (!order.contains(x.currencyCode)) order.add(x.currencyCode);
    }
    return order;
  }

  static Money _orderKey(MoneyBag bag) => bag.isEmpty
      ? const Money.zero(Money.fallbackCurrencyCode)
      : bag.amounts.first;

  static int _compareDesc(Money a, Money b, List<String> order) {
    if (a.currencyCode != b.currencyCode) {
      final int ia = order.indexOf(a.currencyCode);
      final int ib = order.indexOf(b.currencyCode);
      // A code the order does not know sorts last rather than first, which is
      // what `indexOf`'s -1 would otherwise do.
      return (ia < 0 ? order.length : ia).compareTo(ib < 0 ? order.length : ib);
    }
    return b.minorUnits.compareTo(a.minorUnits);
  }

  /// The weight a [bag] carries in a CHART, in minor units of [currencyCode].
  ///
  /// 🔴 A CHART IS A COMPARISON, AND UNLIKE CURRENCIES DO NOT COMPARE. A donut
  /// segment or a progress bar is a claim that this slice is that fraction of
  /// the whole; with two currencies in the list there is no whole, and adding
  /// their minor units would be the same silent fold this file exists to
  /// remove — worse here, because 100 yen and 100 dollars would draw the same
  /// segment.
  ///
  /// So the rule is: a chart is drawn IN THE USER'S OWN CURRENCY, and a
  /// subtotal in any other currency weighs nothing in it. The FIGURES beside
  /// the chart still print every subtotal (`MoneyFormatter.formatBag`), so
  /// nothing is hidden — what is withheld is only the claim that the shapes
  /// are proportional to something they are not.
  static double chartWeight(MoneyBag bag, String currencyCode) =>
      bag.inCurrency(currencyCode).minorUnits.toDouble();

  static List<Subscription> upcoming(
    List<Subscription> s,
    DateTime now, {
    int take = 4,
  }) {
    final List<Subscription> l = List<Subscription>.of(s);
    l.sort(
      (Subscription a, Subscription b) =>
          a.daysUntil(now).compareTo(b.daysUntil(now)),
    );
    return l.take(take).toList();
  }

  static List<Subscription> unused(List<Subscription> s) =>
      s.where((Subscription x) => x.unused).toList();

  /// What the user would keep, per month, by cancelling every row they have
  /// flagged unused.
  ///
  /// 🔴 THIS IS ZERO FOR EVERY REAL USER, AND THE CALLER — NOT THIS FUNCTION —
  /// IS WHERE THAT HAS TO BE HANDLED. `Subscription.unused` is written in
  /// exactly two places: `data/seed/demo_data.dart` (the demo set) and
  /// `SeedApiClient.update`, relaying an `unused` field the API would have to
  /// send. **No control anywhere in the app sets it**, so on real rows
  /// [unused] returns an empty list and this fold returns an empty bag,
  /// permanently.
  ///
  /// The ARITHMETIC is deliberately unchanged: `monthlyPrice` is the right unit
  /// for "you would keep this much every month", and normalising a yearly plan
  /// to a twelfth is exactly right for a recurring saving. The dishonesty was
  /// never the sum — it was rendering the sum when the input cannot exist. A
  /// "Potential savings 0.00" tile is not a zero, it is a missing feature
  /// wearing a number.
  ///
  /// ✅ So the rule for callers is: render this ONLY when `unused(s)` is
  /// non-empty. `home_screen.dart` already does (`if (showUnused &&
  /// unused.isNotEmpty)`). `insights_screen.dart` does NOT — it draws the
  /// savings card and its `/mo` pill unconditionally, with an
  /// `insightsNothingFlagged` line underneath, so a real user sees the pill
  /// read 0.00 beside "nothing flagged". That is the same defect one screen
  /// over and it is that file's to fix.
  static MoneyBag savings(List<Subscription> s) =>
      MoneyBag.sum(unused(s).map((Subscription x) => x.monthlyPrice));

  /// The money that will actually leave the account in the next [days] days.
  ///
  /// 🔴 `price`, NOT `monthlyPrice`, AND THE SWAP IS THE WHOLE FIGURE.
  /// `monthlyPrice` is a NORMALISED monthly share — a yearly plan divided by
  /// twelve — which is what makes `totalMonthly` comparable across cycles. It
  /// is the wrong unit for a horizon: a 120-a-year renewal falling on Thursday
  /// takes the whole 120 off the card on Thursday, not a twelfth of it. This
  /// summed the twelfth, so "DUE IN 7 DAYS" understated an imminent annual
  /// charge by 12x — and it understated it, which is the one direction a
  /// warning about money must not err in.
  ///
  /// A row is counted at most once because the window (`0..days`) is measured
  /// against the ONE `nextRenewal` each row carries; a 30-day horizon does not
  /// double-count a monthly plan that would also bill again in 31 days. That is
  /// a floor on the horizon, not a ceiling, and it is honest in the safe
  /// direction.
  static MoneyBag dueWithin(List<Subscription> s, DateTime now, int days) =>
      MoneyBag.sum(
        s
            .where((Subscription x) {
              final int d = x.daysUntil(now);
              return d >= 0 && d <= days;
            })
            .map((Subscription x) => x.price),
      );
}
