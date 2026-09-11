// Tests for the WEB transport choice in `TelemetryBootstrap.optionsCallback`.
//
// ⏱ 2026-09-12 (W5). sentry_flutter injects the Sentry browser SDK from
// browser.sentry-cdn.com on web, from a `const` URL nothing can re-point. The
// bootstrap turns that injection off and, in the same callback, installs the
// SDK's own HTTP transport — because turning it off ALONE leaves
// `JavascriptTransport` in place, handing every event to a JS client that never
// exists. These tests pin both halves and the request the transport sends.
// Each drives the web branch on the VM through the `isWeb` parameter.
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:nikatru_telemetry/src/telemetry_bootstrap.dart';
import 'package:nikatru_telemetry/src/telemetry_config.dart';
// ignore: implementation_imports
import 'package:sentry/src/transport/http_transport.dart';
import 'package:sentry_flutter/sentry_flutter.dart';

const TelemetryConfig _config = TelemetryConfig(
  dsn: 'https://publickey@glitchtip.example.invalid/7',
  release: 'probe@1.0.0+abc1234',
  environment: 'test',
);

void main() {
  group('TelemetryBootstrap.optionsCallback — web', () {
    test('stops the browser SDK injection AND installs the HTTP transport',
        () async {
      final options = SentryFlutterOptions();

      await TelemetryBootstrap.optionsCallback(_config, isWeb: true)(options);

      expect(options.autoInitializeNativeSdk, isFalse,
          reason: 'left on, sentry_flutter loads browser.sentry-cdn.com');
      expect(options.transport, isA<HttpTransport>(),
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
      expect(options.transport, isNot(isA<HttpTransport>()));
    });

    test(
        'the web transport POSTs the envelope to the DSN host, keyed by the '
        'public key', () async {
      http.Request? seen;
      final options = SentryFlutterOptions()
        ..compressPayload = false
        ..httpClient = MockClient((request) async {
          seen = request;
          return http.Response('{}', 200);
        });

      await TelemetryBootstrap.optionsCallback(_config, isWeb: true)(options);
      final envelope = SentryEnvelope.fromEvent(
        SentryEvent(message: SentryMessage('w5-web-transport-probe')),
        options.sdk,
        dsn: options.dsn,
      );
      await options.transport.send(envelope);

      expect(seen, isNotNull, reason: 'nothing was sent');
      expect(seen!.method, 'POST');
      expect(
        seen!.url.toString(),
        'https://glitchtip.example.invalid/api/7/envelope/',
      );
      expect(seen!.headers['x-sentry-auth'], contains('sentry_key=publickey'));
      expect(seen!.body, contains('w5-web-transport-probe'));
    });
  });
}
