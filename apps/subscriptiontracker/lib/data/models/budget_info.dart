import 'package:nikatru_core/nikatru_core.dart' show Money;

/// Subly-domain budget models — live in the app, not the shared spine (G-22).
class BudgetCap {
  const BudgetCap(this.name, this.cap);
  final String name;
  final Money cap;

  /// 🔴 THE WIRE CARRIES NO CURRENCY FOR A BUDGET, and pretending otherwise
  /// would be a guess. `budget.cap` and `budget.monthly_budget` are bare
  /// `REAL`s the user typed with nothing recording what they meant by them —
  /// which is precisely the defect this increment closes for a subscription's
  /// own price, and which cannot be closed the same way here without a schema
  /// change this increment is not allowed to make.
  ///
  /// So the reading is explicit: a budget figure is in [currencyCode], which
  /// the caller supplies from the user's chosen currency, because that is the
  /// only unit those digits could have meant. The default exists for
  /// `data/api/` (a frozen boundary that cannot pass one) and
  /// [BudgetInfo.inCurrency] is how a screen that KNOWS the user's choice
  /// re-labels what came back.
  factory BudgetCap.fromJson(
    Map<String, dynamic> j, {
    String currencyCode = Money.fallbackCurrencyCode,
  }) => BudgetCap(
    (j['name'] ?? '') as String,
    readMoney(
      j,
      minorKey: 'cap_minor',
      majorKey: 'cap',
      fallbackCurrencyCode: currencyCode,
    ),
  );

  BudgetCap inCurrency(String currencyCode) =>
      BudgetCap(name, Money(cap.minorUnits, currencyCode));

  Map<String, dynamic> toJson() => <String, dynamic>{
    'name': name,
    'cap': cap.toMajorUnits(),
    // Additive, exactly as `Subscription.toJson` is: an old server ignores
    // these, a new one can prefer them, and nothing that reads `cap` breaks.
    'cap_minor': cap.minorUnits,
    'currency': cap.currencyCode,
  };
}

/// Reads a figure from a row, preferring the exact integer shape and the
/// row's OWN currency, and falling back to the decimal shape and the
/// caller's code only when the row carries neither.
///
/// 🔴 THE ROW'S CURRENCY WINS WHEN IT IS THERE. `toJson` writes `currency`
/// and the `_minor` count beside the decimal, and until this helper existed
/// `fromJson` read neither: a budget the user saved in INR came back from
/// the device store as USD, with the digits intact and the meaning gone —
/// the exact relabel the Money rail was introduced to remove. A row with no
/// currency (an older server, an older store) still takes the caller's code,
/// which is the migration and not a preference. Same rule, same shape, as
/// `Subscription.readPrice`.
Money readMoney(
  Map<String, dynamic> j, {
  required String minorKey,
  required String majorKey,
  required String fallbackCurrencyCode,
}) {
  final Object? rawCode = j['currency'];
  final String code = rawCode is String && rawCode.length == 3
      ? rawCode.toUpperCase()
      : fallbackCurrencyCode;
  final Object? minor = j[minorKey];
  // `is int`, not `is num`: a decimal in the integer field is a confused
  // writer, and reading 4.99 as 499 would misprice the figure by a hundred.
  if (minor is int) return Money(minor, code);
  return Money.fromMajorUnits((j[majorKey] as num?) ?? 0, code);
}

class BudgetInfo {
  const BudgetInfo({required this.monthlyBudget, required this.categories});

  final Money monthlyBudget;
  final List<BudgetCap> categories;

  factory BudgetInfo.fromJson(
    Map<String, dynamic> j, {
    String currencyCode = Money.fallbackCurrencyCode,
  }) => BudgetInfo(
    monthlyBudget: readMoney(
      j,
      minorKey: 'monthly_budget_minor',
      majorKey: 'monthly_budget',
      fallbackCurrencyCode: currencyCode,
    ),
    categories: ((j['categories'] as List<dynamic>?) ?? <dynamic>[])
        .map(
          (dynamic e) => BudgetCap.fromJson(
            e as Map<String, dynamic>,
            currencyCode: currencyCode,
          ),
        )
        .toList(),
  );

  /// The same figures, RE-LABELLED under [currencyCode].
  ///
  /// ⚠️ This is a relabel, NOT a conversion — the digits are untouched. It is
  /// honest for exactly one reason: the number never had a currency, so
  /// nothing is being converted away. It is the same operation the old
  /// `Currency` class performed on every figure in the app, and it stops being
  /// acceptable the moment the value DOES carry a currency — which is why
  /// `Subscription` has no equivalent.
  BudgetInfo inCurrency(String currencyCode) => BudgetInfo(
    monthlyBudget: Money(monthlyBudget.minorUnits, currencyCode),
    categories: categories
        .map((BudgetCap c) => c.inCurrency(currencyCode))
        .toList(),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'monthly_budget': monthlyBudget.toMajorUnits(),
    'monthly_budget_minor': monthlyBudget.minorUnits,
    'currency': monthlyBudget.currencyCode,
    'categories': categories.map((BudgetCap c) => c.toJson()).toList(),
  };
}
