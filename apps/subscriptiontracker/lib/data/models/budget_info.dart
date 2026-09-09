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
    Money.fromMajorUnits((j['cap'] as num?) ?? 0, currencyCode),
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

class BudgetInfo {
  const BudgetInfo({required this.monthlyBudget, required this.categories});

  final Money monthlyBudget;
  final List<BudgetCap> categories;

  factory BudgetInfo.fromJson(
    Map<String, dynamic> j, {
    String currencyCode = Money.fallbackCurrencyCode,
  }) => BudgetInfo(
    monthlyBudget: Money.fromMajorUnits(
      (j['monthly_budget'] as num?) ?? 0,
      currencyCode,
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
