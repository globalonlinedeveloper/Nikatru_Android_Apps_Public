// 🔴 THE PROOF THAT A TOKEN EXPIRING OFFLINE NO LONGER SIGNS THE USER OUT.
//
// Review item 6: on a 401, `signOutOnlyIfSessionIsGone` signed out whenever
// `currentAccessToken()` answered null — and the production adapter answers
// null when the token is expiring AND the refresh fails, which is exactly what
// happens with no network. Riding a train through a tunnel was a forced
// sign-out.
//
// Driven end to end through the REAL `SupabaseAuthRepository` and the app's
// REAL 401 handler. The only fake is the GoTrue client's network edge, and it
// behaves the way gotrue 2.27.2 does (`gotrue_client.dart:1624-1633`): a
// NON-retryable refresh failure removes the session before rethrowing; an
// `AuthRetryableFetchException` (a transport failure) keeps it.
//
// ⚠️ PROVEN ONLY AGAINST THAT MODEL OF GOTRUE. That the real SDK classifies a
// dead network as `AuthRetryableFetchException` is read from its source, not
// observed on a device with the radio off.
//
// MUTATION PROOF (run and recorded in the PR): put
// `if (await auth.currentAccessToken() == null)` back in
// `signOutOnlyIfSessionIsGone` and the OFFLINE case goes red.
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:subscriptiontracker/state/providers/auth.dart'
    show signOutOnlyIfSessionIsGone;
import 'package:supabase_flutter/supabase_flutter.dart' as sb;

final DateTime _now = DateTime.utc(2026, 9, 11, 9);

/// A session whose access token expired five minutes ago.
sb.Session _expired() {
  String seg(Map<String, Object?> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  final int exp =
      _now.subtract(const Duration(minutes: 5)).millisecondsSinceEpoch ~/ 1000;
  final String jwt =
      '${seg(<String, Object?>{'alg': 'none'})}.'
      '${seg(<String, Object?>{'sub': 'user-1', 'exp': exp})}.sig';
  return sb.Session(
    accessToken: jwt,
    refreshToken: 'refresh-1',
    tokenType: 'bearer',
    user: sb.User(
      id: 'user-1',
      appMetadata: const <String, dynamic>{},
      userMetadata: const <String, dynamic>{},
      aud: 'authenticated',
      email: 'a@b.com',
      createdAt: '2026-08-01T00:00:00Z',
    ),
  );
}

/// GoTrue's network edge, failing a refresh the way the SDK does.
class _GoTrue extends sb.GoTrueClient {
  _GoTrue(this.refreshFailure) : super(autoRefreshToken: false);

  final sb.AuthException refreshFailure;
  sb.Session? session = _expired();
  int signOutCalls = 0;

  @override
  sb.Session? get currentSession => session;

  @override
  sb.User? get currentUser => session?.user;

  @override
  Future<sb.AuthResponse> refreshSession([String? refreshToken]) async {
    if (refreshFailure is! sb.AuthRetryableFetchException) session = null;
    throw refreshFailure;
  }

  @override
  Future<void> signOut({sb.SignOutScope scope = sb.SignOutScope.local}) async {
    signOutCalls++;
    session = null;
  }
}

void main() {
  test('🔴 OFFLINE: an expired token whose refresh cannot reach the server '
      'keeps the user signed in', () async {
    final _GoTrue g = _GoTrue(
      sb.AuthRetryableFetchException(message: 'Failed host lookup'),
    );
    final SupabaseAuthRepository auth = SupabaseAuthRepository(
      client: g,
      clock: () => _now,
    );
    expect(await auth.currentAccessToken(), isNull, reason: 'no usable token');

    await signOutOnlyIfSessionIsGone(auth);

    expect(g.signOutCalls, 0, reason: 'being offline is not being revoked');
    expect(auth.currentUser, isNotNull);
  });

  test(
    'REVOKED: a refresh the server refuses DOES sign the user out',
    () async {
      final _GoTrue g = _GoTrue(
        const sb.AuthApiException(
          'Invalid Refresh Token: Refresh Token Not Found',
          statusCode: '400',
          code: 'refresh_token_not_found',
        ),
      );
      final SupabaseAuthRepository auth = SupabaseAuthRepository(
        client: g,
        clock: () => _now,
      );

      await signOutOnlyIfSessionIsGone(auth);

      expect(g.signOutCalls, 1, reason: 'the session really is gone');
    },
  );
}
