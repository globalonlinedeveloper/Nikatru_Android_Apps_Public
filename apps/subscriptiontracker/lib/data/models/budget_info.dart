import 'package:nikatru_core/nikatru_core.dart' show Money, MoneyBag;

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

/// Whether [j] RECORDS its own currency — by exactly the rule [readMoney]
/// uses to decide whether to honour it, so the two can never disagree about
/// whether a figure has a unit.
bool recordsCurrency(Map<String, dynamic> j) {
  final Object? rawCode = j['currency'];
  return rawCode is String && rawCode.length == 3;
}

class BudgetInfo {
  const BudgetInfo({
    required this.monthlyBudget,
    required this.categories,
    this.currencyKnown = true,
  });

  /// Whether this budget's currency was RECORDED, rather than supplied by the
  /// reader because the figures arrived bare.
  ///
  /// 🔴 THE LINE BETWEEN "LABEL" AND "RELABEL". The server's `/budget` stores a
  /// bare number and returns one with no currency, so for THAT figure the
  /// user's chosen currency is the only unit it could mean. A budget this
  /// client wrote carries `currency`, and a budget built in code carries a
  /// [Money]: both are KNOWN, and moving them into another currency with no
  /// rate is the defect — a ₹5,000 budget read as $5,000 the moment the user
  /// tapped the dollar chip (review item 4).
  final bool currencyKnown;

  /// The budget's own currency — the unit its caps are in, and the unit
  /// spending is measured in against it.
  String get currencyCode => monthlyBudget.currencyCode;

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
    currencyKnown: recordsCurrency(j),
  );

  /// This budget as the reader should see it, given their chosen
  /// [currencyCode].
  ///
  /// 🔴 A KNOWN CURRENCY IS NEVER RELABELLED — this returns the budget
  /// UNCHANGED, in its own currency. There is no rate table in this app and
  /// there must not be one, so the only honest rendering of a ₹5,000 budget for
  /// a reader who now prefers dollars is ₹5,000. Only a budget whose figures
  /// arrived BARE ([currencyKnown] false) takes [currencyCode], because for it
  /// that is not a relabel: the digits never had a unit.
  BudgetInfo inCurrency(String currencyCode) {
    if (currencyKnown) return this;
    return BudgetInfo(
      monthlyBudget: Money(monthlyBudget.minorUnits, currencyCode),
      categories: categories
          .map((BudgetCap c) => c.inCurrency(currencyCode))
          .toList(),
      currencyKnown: false,
    );
  }

  /// How [spent] measures against this budget, IN THIS BUDGET'S CURRENCY.
  ///
  /// Only the subtotal in [currencyCode] counts: a budget stated in one
  /// currency cannot judge spending in another, and comparing unlike [Money]
  /// throws by design. The screen still PRINTS every subtotal; this is what
  /// the ring and the over/under decision are computed from.
  BudgetUsage usageOf(MoneyBag spent) {
    final Money here = spent.inCurrency(currencyCode);
    final double ratio = monthlyBudget.minorUnits <= 0
        ? 0
        : (here.minorUnits / monthlyBudget.minorUnits).clamp(0, 1).toDouble();
    return BudgetUsage(
      spentHere: here,
      over: here > monthlyBudget,
      ratio: ratio,
    );
  }

  /// The wire/cache shape. The currency and the exact minor units are written
  /// ONLY when the currency is known — a bare budget cached under the reader's
  /// code would come back KNOWN in a currency nobody recorded, and [readMoney]
  /// would then honour it.
  Map<String, dynamic> toJson() => <String, dynamic>{
    'monthly_budget': monthlyBudget.toMajorUnits(),
    if (currencyKnown) 'monthly_budget_minor': monthlyBudget.minorUnits,
    if (currencyKnown) 'currency': monthlyBudget.currencyCode,
    'categories': categories.map((BudgetCap c) {
      final Map<String, dynamic> row = c.toJson();
      if (!currencyKnown) {
        row.remove('currency');
        row.remove('cap_minor');
      }
      return row;
    }).toList(),
  };
}

/// What a budget measures spending as — see [BudgetInfo.usageOf].
class BudgetUsage {
  const BudgetUsage({
    required this.spentHere,
    required this.over,
    required this.ratio,
  });

  /// The spending in the budget's own currency.
  final Money spentHere;

  /// Whether that spending exceeds the budget.
  final bool over;

  /// spentHere / budget, clamped to 0..1 (0 for a zero budget).
  final double ratio;
}
