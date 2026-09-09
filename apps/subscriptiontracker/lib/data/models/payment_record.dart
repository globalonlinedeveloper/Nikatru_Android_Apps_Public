import 'package:nikatru_core/nikatru_core.dart' show Money;

/// Subly-domain payment model — lives in the app, not the shared spine (G-22).
class PaymentRecord {
  const PaymentRecord({required this.date, required this.amount});
  final DateTime date;

  /// What actually left the account, with the currency it left in. A payment
  /// history is the one place a stale currency would be most misleading — the
  /// row is a record of a real charge, not a figure the user can restate.
  final Money amount;

  factory PaymentRecord.fromJson(
    Map<String, dynamic> j, {
    String fallbackCurrencyCode = Money.fallbackCurrencyCode,
  }) {
    final Object? rawCode = j['currency'];
    final String code = rawCode is String && rawCode.length == 3
        ? rawCode.toUpperCase()
        : fallbackCurrencyCode;
    final Object? minor = j['amount_minor'];
    if (minor is int) {
      return PaymentRecord(date: _date(j), amount: Money(minor, code));
    }
    return PaymentRecord(
      date: _date(j),
      amount: Money.fromMajorUnits((j['amount'] as num?) ?? 0, code),
    );
  }

  static DateTime _date(Map<String, dynamic> j) =>
      DateTime.parse(j['paid_at'] as String);
}
