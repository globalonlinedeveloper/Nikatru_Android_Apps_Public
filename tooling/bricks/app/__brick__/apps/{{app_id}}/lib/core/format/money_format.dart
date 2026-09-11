// ─────────────────────────────────────────────────────────────────────────────
// MoneyFormatter — renders `Money` for a READER, on two independent axes: the
// reader's locale decides grouping and symbol placement, the money's own ISO
// code decides the symbol and the decimal places. Nothing here converts.
//
// 🔴 A COPY OF apps/subscriptiontracker/lib/core/format/money_format.dart, and
// the copy is deliberate for now: packages/design_system (which owns `intl`)
// must stay domain-free (assert-package-boundaries.mjs rule B) and `Money`
// lives in nikatru_core, so there is no shared package this can move to
// without a boundary decision. Until then, tooling/ci/assert-no-seam-forks.mjs
// LANDED_PAIRS holds the stamp and the app to the same price rendering.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:intl/intl.dart';
import 'package:nikatru_core/nikatru_core.dart' show Money, MoneyBag;

export 'package:nikatru_core/nikatru_core.dart' show Money, MoneyBag;

class MoneyFormatter {
  const MoneyFormatter(
    this.localeName, {
    this.emptyCurrencyCode = Money.fallbackCurrencyCode,
  });

  final String localeName;

  final String emptyCurrencyCode;

  static const String fallbackLocaleName = 'en_US';

  static const String mixedJoiner = ' + ';

  static final Map<String, NumberFormat> _cache = <String, NumberFormat>{};

  String format(Money amount) => _formatterFor(
    amount.currencyCode,
    amount.minorUnitDigits,
  ).format(amount.toMajorUnits());

  String formatRounded(Money amount) =>
      _formatterFor(amount.currencyCode, 0).format(amount.toMajorUnits());

  String formatBag(MoneyBag bag) => bag.isEmpty
      ? format(Money.zero(emptyCurrencyCode))
      : bag.amounts.map(format).join(mixedJoiner);

  String formatBagRounded(MoneyBag bag) => bag.isEmpty
      ? formatRounded(Money.zero(emptyCurrencyCode))
      : bag.amounts.map(formatRounded).join(mixedJoiner);

  NumberFormat _formatterFor(String currencyCode, int decimalDigits) {
    final String key = '$localeName|$currencyCode|$decimalDigits';
    final NumberFormat? cached = _cache[key];
    if (cached != null) return cached;
    final NumberFormat built = _build(localeName, currencyCode, decimalDigits);
    _cache[key] = built;
    return built;
  }

  static NumberFormat _build(
    String localeName,
    String currencyCode,
    int decimalDigits,
  ) {
    // A code with no symbol renders under the CODE plus a space, never a
    // guessed glyph: a wrong symbol on a real amount is worse than a plain one.
    final String symbol = Money.symbolFor(currencyCode) ?? '$currencyCode ';
    try {
      return NumberFormat.currency(
        locale: localeName,
        symbol: symbol,
        decimalDigits: decimalDigits,
      );
    } on Exception {
      return _fallback(symbol, decimalDigits);
    } on ArgumentError {
      // `Intl.verifiedLocale` throws an Error, not an Exception, for a locale
      // whose data is absent. Both arms exist because the class of the throw
      // depends on which layer of intl rejects it.
      return _fallback(symbol, decimalDigits);
    }
  }

  static NumberFormat _fallback(String symbol, int decimalDigits) =>
      NumberFormat.currency(
        locale: fallbackLocaleName,
        symbol: symbol,
        decimalDigits: decimalDigits,
      );
}
