enum BillingCycle { monthly, yearly }

/// A single tracked subscription. JSON is snake_case to match the Worker/D1 API.
///
/// Subly-domain model — lives in the app, not the shared spine (de-Subly-fy
/// G-22: `packages/core` stays app-agnostic so stamped apps don't read as clones).
class Subscription {
  const Subscription({
    required this.id,
    required this.name,
    required this.category,
    required this.price,
    required this.cycle,
    required this.nextRenewal,
    this.plan = '',
    this.glyph = '',
    this.usedPct = 0,
    this.usageNote = '',
    this.unused = false,
  });

  final String id;
  final String name;
  final String category;
  final double price;
  final BillingCycle cycle;
  final DateTime nextRenewal;
  final String plan;
  final String glyph;
  final int usedPct;
  final String usageNote;
  final bool unused;

  /// Normalized to a monthly figure so totals compare like-for-like.
  double get monthlyPrice =>
      cycle == BillingCycle.yearly ? price / 12.0 : price;

  bool get isActive => !unused && usedPct > 60;

  int daysUntil(DateTime now) {
    final DateTime a = DateTime(now.year, now.month, now.day);
    final DateTime b = DateTime(
      nextRenewal.year,
      nextRenewal.month,
      nextRenewal.day,
    );
    return b.difference(a).inDays;
  }

  factory Subscription.fromJson(Map<String, dynamic> j) => Subscription(
    id: j['id'].toString(),
    name: (j['name'] ?? '') as String,
    category: (j['category'] ?? 'Other') as String,
    price: (j['price'] as num?)?.toDouble() ?? 0,
    cycle: (j['cycle'] == 'yearly')
        ? BillingCycle.yearly
        : BillingCycle.monthly,
    nextRenewal: DateTime.parse(j['next_renewal'] as String),
    plan: (j['plan'] ?? '') as String,
    glyph: (j['glyph'] ?? '') as String,
    usedPct: (j['used_pct'] as num?)?.toInt() ?? 0,
    usageNote: (j['usage_note'] ?? '') as String,
    unused: j['unused'] == true || j['unused'] == 1,
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'name': name,
    'category': category,
    'price': price,
    'cycle': cycle.name,
    'next_renewal': dateOnly(nextRenewal),
    'plan': plan,
    'glyph': glyph,
    'used_pct': usedPct,
    'usage_note': usageNote,
    'unused': unused,
  };

  Subscription copyWith({
    String? name,
    String? category,
    double? price,
    BillingCycle? cycle,
    DateTime? nextRenewal,
    String? plan,
    int? usedPct,
    bool? unused,
  }) => Subscription(
    id: id,
    name: name ?? this.name,
    category: category ?? this.category,
    price: price ?? this.price,
    cycle: cycle ?? this.cycle,
    nextRenewal: nextRenewal ?? this.nextRenewal,
    plan: plan ?? this.plan,
    glyph: glyph,
    usedPct: usedPct ?? this.usedPct,
    usageNote: usageNote,
    unused: unused ?? this.unused,
  );

  static String dateOnly(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-'
      '${d.month.toString().padLeft(2, '0')}-'
      '${d.day.toString().padLeft(2, '0')}';
}
