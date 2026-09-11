import 'dart:async';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:sentry_flutter/sentry_flutter.dart';

/// Sends Sentry envelopes over HTTP from a web build, using only the SDK's
/// PUBLIC API.
///
/// ⏱ 2026-09-12 (W5). Why this exists, briefly (the full account is on
/// `TelemetryBootstrap.useHttpTransportOnWeb`): on web, sentry_flutter otherwise
/// loads the Sentry browser SDK from browser.sentry-cdn.com and routes every
/// envelope through it. With that injection turned off, a transport has to be
/// installed or every event is dropped silently.
///
/// Why not the SDK's own `HttpTransport`: it is not exported from
/// `package:sentry/sentry.dart`, and reaching it means an
/// `implementation_imports` suppression in a package every app links, which
/// `tooling/ci/assert-no-gate-weakening.mjs` rightly refuses. Everything used
/// here — `Dsn.parse`, `Dsn.postUri`, `Dsn.publicKey`,
/// `SentryEnvelope.envelopeStream`, `SentryOptions.sentryClientName` — is public
/// and not `@internal`.
///
/// Behaviour, all of it tested in `test/telemetry_web_transport_test.dart`:
/// * POSTs the envelope bytes to the DSN's envelope endpoint with the
///   `X-Sentry-Auth` header (protocol version 7, client name, public key). The
///   header is the same one the SDK builds; GlitchTip answers its CORS preflight.
/// * Honours HTTP 429: envelopes are DROPPED until `Retry-After` (seconds;
///   60 when absent or unreadable) has passed, instead of hammering a server
///   that asked for quiet.
/// * Never throws. A crash reporter that crashes the app it reports on is worse
///   than one that loses an event; failures return [SentryId.empty].
class WebEnvelopeTransport implements Transport {
  /// [client] and [now] exist for tests; production passes neither.
  WebEnvelopeTransport(
    this._options, {
    http.Client? client,
    DateTime Function()? now,
  })  : _client = client ?? http.Client(),
        _now = now ?? DateTime.now;

  final SentryOptions _options;
  final http.Client _client;
  final DateTime Function() _now;
  DateTime? _quietUntil;

  /// Protocol version of the `X-Sentry-Auth` header.
  static const int protocolVersion = 7;

  /// Used when a 429 carries no readable `Retry-After`.
  static const Duration defaultRetryAfter = Duration(seconds: 60);

  @override
  Future<SentryId?> send(SentryEnvelope envelope) async {
    final quietUntil = _quietUntil;
    if (quietUntil != null && _now().isBefore(quietUntil)) {
      return SentryId.empty();
    }
    final dsnText = _options.dsn;
    if (dsnText == null || dsnText.isEmpty) {
      return SentryId.empty();
    }
    try {
      final dsn = Dsn.parse(dsnText);
      final bytes = BytesBuilder(copy: false);
      await for (final chunk in envelope.envelopeStream(_options)) {
        bytes.add(chunk);
      }
      final response = await _client.post(
        dsn.postUri,
        headers: <String, String>{
          'content-type': 'application/x-sentry-envelope',
          'x-sentry-auth': 'Sentry sentry_version=$protocolVersion, '
              'sentry_client=${_options.sentryClientName}, '
              'sentry_key=${dsn.publicKey}',
        },
        body: bytes.takeBytes(),
      );
      if (response.statusCode == 429) {
        final seconds = int.tryParse(response.headers['retry-after'] ?? '');
        _quietUntil = _now().add(
          seconds != null && seconds > 0
              ? Duration(seconds: seconds)
              : defaultRetryAfter,
        );
        return SentryId.empty();
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return SentryId.empty();
      }
      return envelope.header.eventId ?? SentryId.empty();
    } catch (_) {
      return SentryId.empty();
    }
  }
}
