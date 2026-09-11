// Tests for the WEB transport choice in `TelemetryBootstrap.optionsCallback`
// and for `WebEnvelopeTransport` itself.
//
// ⏱ 2026-09-12 (W5). sentry_flutter injects the Sentry browser SDK from
// browser.sentry-cdn.com on web, from a `const` URL nothing can re-point. The
// bootstrap turns that injection off and, in the same callback, installs a
// transport built on the SDK's public API — because turning it off ALONE
// leaves `JavascriptTransport` in place, handing every event to a JS client
// that never exists. These tests pin both halves and what the transport sends.
// The web branch is driven on the VM through the `isWeb` parameter.
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nikatru_telemetry/src/telemetry_bootstrap.dart';
import 'package:nikatru_telemetry/src/telemetry_config.dart';
import 'package:nikatru_telemetry/src/web_envelope_transport.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

const TelemetryConfig _config = TelemetryConfig(
  dsn: 'https://publickey@glitchtip.example.invalid/7',
  release: 'probe@1.0.0+abc1234',
  environment: 'test',
);

SentryEnvelope _envelope(SentryFlutterOptions options, String marker) =>
    SentryEnvelope.fromEvent(
      SentryEvent(message: SentryMessage(marker)),
      options.sdk,
      dsn: options.dsn,
    );

void main() {
  group('TelemetryBootstrap.optionsCallback — web', () {
    test('stops the browser SDK injection AND installs the web transport',
        () async {
      final options = SentryFlutterOptions();

      await TelemetryBootstrap.optionsCallback(_config, isWeb: true)(options);

      expect(options.autoInitializeNativeSdk, isFalse,
          reason: 'left on, sentry_flutter loads browser.sentry-cdn.com');
      expect(options.transport, isA<WebEnvelopeTransport>(),
          reason: 'with injection off, any other transport drops events');
      expect(options.dsn, _config.dsn);
    });

    test('off the web, neither the injection flag nor the transport is touched',
        () async {
      final options = SentryFlutterOptions();
      final before = options.transport;

      await TelemetryBootstrap.optionsCallback(_config, isWeb: false)(options);

      expect(options.autoInitializeNativeSdk, isTrue);
      expect(identical(options.transport, before), isTrue);
      expect(options.transport, isNot(isA<WebEnvelopeTransport>()));
    });

    test(
        'the installed transport POSTs the envelope to the DSN host, keyed by '
        'the public key', () async {
      http.Request? seen;
      final client = MockClient((request) async {
        seen = request;
        return http.Response('{}', 200);
      });
      final options = SentryFlutterOptions();

      await TelemetryBootstrap.optionsCallback(
        _config,
        isWeb: true,
        webClient: client,
      )(options);
      final id = await options.transport
          .send(_envelope(options, 'w5-web-transport-probe'));

      expect(seen, isNotNull, reason: 'nothing was sent');
      expect(seen!.method, 'POST');
      expect(
        seen!.url.toString(),
        'https://glitchtip.example.invalid/api/7/envelope/',
      );
      expect(seen!.headers['content-type'],
          startsWith('application/x-sentry-envelope'));
      final auth = seen!.headers['x-sentry-auth'];
      expect(auth, contains('sentry_version=7'));
      expect(auth, contains('sentry_key=publickey'));
      expect(auth, contains('sentry_client=${options.sentryClientName}'));
      expect(seen!.body, contains('w5-web-transport-probe'));
      expect(id, isNot(SentryId.empty()));
    });
  });

  group('WebEnvelopeTransport', () {
    test('a 429 opens a quiet window: nothing is sent until Retry-After passes',
        () async {
      var calls = 0;
      var clock = DateTime.utc(2026, 9, 12, 12);
      final client = MockClient((request) async {
        calls++;
        return http.Response('', 429, headers: {'retry-after': '120'});
      });
      final options = SentryFlutterOptions()..dsn = _config.dsn;
      final transport =
          WebEnvelopeTransport(options, client: client, now: () => clock);

      await transport.send(_envelope(options, 'first'));
      expect(calls, 1);

      clock = clock.add(const Duration(seconds: 119));
      await transport.send(_envelope(options, 'inside the window'));
      expect(calls, 1, reason: 'the server asked for quiet for 120 s');

      clock = clock.add(const Duration(seconds: 2));
      await transport.send(_envelope(options, 'after the window'));
      expect(calls, 2);
    });

    test('a failing client never throws out of send', () async {
      final client = MockClient((request) async {
        throw http.ClientException('offline');
      });
      final options = SentryFlutterOptions()..dsn = _config.dsn;
      final transport = WebEnvelopeTransport(options, client: client);

      final id = await transport.send(_envelope(options, 'offline'));

      expect(id, SentryId.empty());
    });
  });
}
