// 🔴 THE PROOF THAT A BUNDLE'S EXPIRY IS ENFORCED ON THE DEVICE, AND THAT THE
// OFFLINE CACHE KEEPS WHERE A GRANT CAME FROM.
//
// The per-app read (`services/platform/src/routes/entitlements.ts`) answers a
// bundle-only customer with `is_pro: true`, `granted_via: 'bundle'`, an EMPTY
// `entitlements` list and a `bundle` block carrying `expires_at`.
// `Entitlements.fromJson` used to read none of `granted_via` or `bundle`, and
// `isProAt` reads an empty list as an undated LIFETIME grant — so the bundle's
// end date was never consulted client-side and the cache went on saying Pro
// after the bundle had ended. `toJson` dropped both too, so the cache lost the
// attribution even where nothing else went wrong.
//
// MUTATION PROOF (run and recorded in the PR):
//   · make `isProAt` ignore `grantedVia` (the old `items.isEmpty || …` body)
//     → the "past the bundle's expiry" cases go red;
//   · drop the `bundle` line from `Entitlements.toJson`
//     → the round-trip and the cache end-to-end cases go red.
import 'package:nikatru_core/nikatru_core.dart';
import 'package:test/test.dart';

/// Exactly the server's per-app answer for a bundle-only customer.
Map<String, dynamic> bundleOnly({Object? expiresAt = '2026-10-01T00:00:00Z'}) =>
    <String, dynamic>{
      'app_id': 'subscriptiontracker',
      'is_pro': true,
      'granted_via': 'bundle',
      'entitlements': <Object?>[],
      'bundle': <String, dynamic>{
        'feature_set': 'all-products',
        'version': 2,
        'products': <String>['subscriptiontracker', 'tabwise'],
        'expires_at': expiresAt,
        'source': 'paddle',
      },
    };

final DateTime _before = DateTime.utc(2026, 9, 15);
final DateTime _after = DateTime.utc(2026, 10, 2);

void main() {
  group('the wire shape is read, not dropped', () {
    test('granted_via and every bundle field survive fromJson', () {
      final Entitlements e = Entitlements.fromJson(bundleOnly());
      expect(e.grantedVia, 'bundle');
      final EntitlementBundle b = e.bundle!;
      expect(b.featureSet, 'all-products');
      expect(b.version, 2);
      expect(b.products, <String>['subscriptiontracker', 'tabwise']);
      expect(b.source, 'paddle');
      expect(b.expiresAt, DateTime.utc(2026, 10, 1));
    });

    test('an ABSENT bundle key is null, and absent granted_via is null', () {
      final Entitlements e = Entitlements.fromJson(<String, dynamic>{
        'app_id': 'subscriptiontracker',
        'is_pro': false,
        'entitlements': <Object?>[],
      });
      expect(e.grantedVia, isNull);
      expect(e.bundle, isNull);
    });
  });

  group('🔴 the bundle expiry decides offline Pro', () {
    test('inside the bundle term, a bundle-only answer is Pro', () {
      expect(Entitlements.fromJson(bundleOnly()).isProAt(_before), isTrue);
    });

    test(
        'PAST the bundle expiry it is NOT Pro — the empty list is not a '
        'lifetime grant', () {
      expect(Entitlements.fromJson(bundleOnly()).isProAt(_after), isFalse);
    });

    test('the grace window applies to the bundle as it does to an item', () {
      final Entitlements e = Entitlements.fromJson(bundleOnly());
      expect(e.isProAt(_after, grace: const Duration(days: 3)), isTrue);
      expect(
        e.isProAt(DateTime.utc(2026, 10, 5), grace: const Duration(days: 3)),
        isFalse,
      );
    });

    test('an unreadable bundle expiry fails CLOSED', () {
      final Entitlements e = Entitlements.fromJson(
        bundleOnly(expiresAt: 'not-a-date'),
      );
      expect(e.isProAt(_before), isFalse);
      // …and stays refused after a cache round-trip.
      expect(Entitlements.fromJson(e.toJson()).isProAt(_before), isFalse);
    });

    test('a bundle block that is not an object fails CLOSED', () {
      final Map<String, dynamic> j = bundleOnly()..['bundle'] = 'garbage';
      final Entitlements e = Entitlements.fromJson(j);
      expect(e.isProAt(_before), isFalse);
      expect(Entitlements.fromJson(e.toJson()).isProAt(_before), isFalse);
    });

    test('a customer holding BOTH keeps Pro while EITHER branch is valid', () {
      final Entitlements e = Entitlements.fromJson(<String, dynamic>{
        ...bundleOnly(),
        'granted_via': 'app',
        'entitlements': <Object?>[
          <String, dynamic>{
            'entitlement': 'pro',
            'product_id': 'subscriptiontracker_pro_monthly',
            'store': 'paddle',
            'is_active': true,
            'expires_at': '2026-09-20T00:00:00Z',
          },
        ],
      });
      // The app item has lapsed; the bundle has not.
      expect(e.isProAt(DateTime.utc(2026, 9, 25)), isTrue);
      // Both have lapsed.
      expect(e.isProAt(_after), isFalse);
    });

    test('a PRE-UNION answer (no granted_via) keeps the old lifetime rule', () {
      final Entitlements e = Entitlements.fromJson(<String, dynamic>{
        'app_id': 'subscriptiontracker',
        'is_pro': true,
        'entitlements': <Object?>[],
      });
      expect(e.isProAt(DateTime.utc(2099)), isTrue);
    });
  });

  group('the cache keeps the attribution', () {
    test('toJson → fromJson round-trips granted_via and the bundle', () {
      final Entitlements back = Entitlements.fromJson(
        Entitlements.fromJson(bundleOnly()).toJson(),
      );
      expect(back.grantedVia, 'bundle');
      expect(back.bundle?.featureSet, 'all-products');
      expect(back.bundle?.version, 2);
      expect(back.bundle?.products, <String>['subscriptiontracker', 'tabwise']);
      expect(back.bundle?.source, 'paddle');
      expect(back.bundle?.expiresAt, DateTime.utc(2026, 10, 1));
      expect(back.isProAt(_before), isTrue);
      expect(back.isProAt(_after), isFalse);
    });

    test('verifiedAtNow carries both — the server-success path', () {
      final Entitlements stamped = Entitlements.fromJson(
        bundleOnly(),
      ).verifiedAtNow(_before);
      expect(stamped.grantedVia, 'bundle');
      expect(stamped.bundle?.expiresAt, DateTime.utc(2026, 10, 1));
    });

    test(
        '🔴 END TO END through EntitlementCache: an expired bundle is NOT '
        'honoured offline, well inside the staleness ceiling', () async {
      final EntitlementCache cache = EntitlementCache(
        store: InMemorySecureStore(),
      );
      // Verified the day before the bundle ends (10-01). The cache's own grace
      // is three days, so the bundle is honoured through 10-04 and refused on
      // 10-05 — five days after verification, still INSIDE the 7-day staleness
      // ceiling, so ONLY the bundle's expiry can be what refuses.
      expect(cache.grace, const Duration(days: 3));
      await cache.saveVerified(
        Entitlements.fromJson(bundleOnly()),
        now: DateTime.utc(2026, 9, 30),
      );
      final Entitlements inside = await cache.readValid(
        now: DateTime.utc(2026, 10, 3),
      );
      expect(inside.isPro, isTrue, reason: 'inside expiry + grace');
      final Entitlements past = await cache.readValid(
        now: DateTime.utc(2026, 10, 5),
      );
      expect(
        past.isPro,
        isFalse,
        reason: 'past expiry + grace, inside the staleness ceiling',
      );
    });
  });
}
