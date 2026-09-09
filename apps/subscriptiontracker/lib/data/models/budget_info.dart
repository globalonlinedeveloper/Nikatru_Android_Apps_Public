/// Subly-domain budget models — live in the app, not the shared spine (G-22).
class BudgetCap {
  const BudgetCap(this.name, this.cap);
  final String name;
  final double cap;

  factory BudgetCap.fromJson(Map<String, dynamic> j) => BudgetCap(
    (j['name'] ?? '') as String,
    (j['cap'] as num?)?.toDouble() ?? 0,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{'name': name, 'cap': cap};
}

class BudgetInfo {
  const BudgetInfo({required this.monthlyBudget, required this.categories});

  final double monthlyBudget;
  final List<BudgetCap> categories;

  factory BudgetInfo.fromJson(Map<String, dynamic> j) => BudgetInfo(
    monthlyBudget: (j['monthly_budget'] as num?)?.toDouble() ?? 0,
    categories: ((j['categories'] as List<dynamic>?) ?? <dynamic>[])
        .map((dynamic e) => BudgetCap.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'monthly_budget': monthlyBudget,
    'categories': categories.map((BudgetCap c) => c.toJson()).toList(),
  };
}
