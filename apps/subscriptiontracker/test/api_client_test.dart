import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:subscriptiontracker/data/api/api_client.dart' show ApiException;
import 'package:subscriptiontracker/data/api/dio_api_client.dart';
import 'package:subscriptiontracker/data/models/subscription.dart';

/// A dio adapter returning a fixed body/status and recording the last request.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.body, {this.status = 200});

  final String body;
  final int status;
  RequestOptions? lastRequest;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    lastRequest = options;
    return ResponseBody.fromString(
      body,
      status,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>['application/json'],
      },
    );
  }
}

void main() {
  test('attaches the bearer token and parses subscriptions', () async {
    final _FakeAdapter adapter = _FakeAdapter(
      jsonEncode(<dynamic>[
        <String, dynamic>{
          'id': '1',
          'name': 'Netflix',
          'category': 'Streaming',
          'price': 15.0,
          'cycle': 'monthly',
          'next_renewal': '2026-08-01',
        },
      ]),
    );
    final Dio dio = Dio()..httpClientAdapter = adapter;
    final DioApiClient client = DioApiClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => 'tok123',
      httpClient: dio,
    );

    final List<Subscription> subs = await client.getSubscriptions();
    expect(subs, hasLength(1));
    expect(subs.first.name, 'Netflix');
    expect(adapter.lastRequest!.headers['Authorization'], 'Bearer tok123');
  });

  test('maps error responses to ApiException', () {
    final Dio dio = Dio()
      ..httpClientAdapter = _FakeAdapter(
        jsonEncode(<String, dynamic>{'error': 'nope'}),
        status: 400,
      );
    final DioApiClient client = DioApiClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => null,
      httpClient: dio,
    );
    expect(client.getSubscriptions(), throwsA(isA<ApiException>()));
  });

  test('maps a malformed 2xx body to ApiException (not a raw TypeError)', () {
    // Server returns 200 with an object where a list is expected.
    final Dio dio = Dio()
      ..httpClientAdapter = _FakeAdapter(
        jsonEncode(<String, dynamic>{'unexpected': true}),
      );
    final DioApiClient client = DioApiClient(
      baseUrl: 'https://example.test/v1',
      tokenProvider: () async => null,
      httpClient: dio,
    );
    expect(client.getSubscriptions(), throwsA(isA<ApiException>()));
  });
}
