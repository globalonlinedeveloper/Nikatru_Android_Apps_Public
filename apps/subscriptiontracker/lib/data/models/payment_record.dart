/// Subly-domain payment model — lives in the app, not the shared spine (G-22).
class PaymentRecord {
  const PaymentRecord({required this.date, required this.amount});
  final DateTime date;
  final double amount;

  factory PaymentRecord.fromJson(Map<String, dynamic> j) => PaymentRecord(
    date: DateTime.parse(j['paid_at'] as String),
    amount: (j['amount'] as num?)?.toDouble() ?? 0,
  );
}
