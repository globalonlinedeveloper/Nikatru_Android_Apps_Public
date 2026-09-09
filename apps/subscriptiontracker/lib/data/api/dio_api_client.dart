import 'package:dio/dio.dart';
import 'package:nikatru_api_client/nikatru_api_client.dart';
import 'package:nikatru_core/nikatru_core.dart' show Entitlements;

import '../models/budget_info.dart';
import '../models/payment_record.dart';
import '../models/subscription.dart';
import 'api_client.dart';

/// Live Subly client against the Cloudflare Worker. All HTTP goes through the
/// shared generic [RestClient] (bearer auth, 401 handling, transport-error →
/// ApiException); this class maps Subly's endpoints to its domain models, and
/// routes every parse through `_rest.decode` so a malformed 2xx body also
/// surfaces as an ApiException (single failure contract).
class DioApiClient implements ApiClient {
  DioApiClient({
    required String baseUrl,
    required Future<String?> Function() tokenProvider,
    Future<void> Function()? onUnauthorized,
    Dio? httpClient,
  }) : _rest = RestClient(
         baseUrl: baseUrl,
         tokenProvider: tokenProvider,
         onUnauthorized: onUnauthorized,
         httpClient: httpClient,
       );

  final RestClient _rest;

  @override
  Future<List<Subscription>> getSubscriptions() async {
    final Object? data = await _rest.get('/subscriptions');
    return _rest.decode(
      data,
      (Object? b) => (b! as List<dynamic>)
          .map((dynamic e) => Subscription.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }

  @override
  Future<Subscription> createSubscription(Subscription draft) async {
    final Object? data = await _rest.post(
      '/subscriptions',
      body: draft.toJson(),
    );
    return _rest.decode(
      data,
      (Object? b) => Subscription.fromJson(b! as Map<String, dynamic>),
    );
  }

  @override
  Future<Subscription> getSubscription(String id) async {
    final Object? data = await _rest.get('/subscriptions/$id');
    return _rest.decode(data, (Object? b) {
      final Map<String, dynamic> m = b! as Map<String, dynamic>;
      final Map<String, dynamic> sub = m.containsKey('subscription')
          ? m['subscription'] as Map<String, dynamic>
          : m;
      return Subscription.fromJson(sub);
    });
  }

  @override
  Future<Subscription> updateSubscription(
    String id,
    Map<String, dynamic> changes,
  ) async {
    final Object? data = await _rest.patch('/subscriptions/$id', body: changes);
    return _rest.decode(
      data,
      (Object? b) => Subscription.fromJson(b! as Map<String, dynamic>),
    );
  }

  @override
  Future<void> deleteSubscription(String id) =>
      _rest.delete('/subscriptions/$id');

  @override
  Future<List<PaymentRecord>> getPaymentHistory(String id) async {
    final Object? data = await _rest.get('/subscriptions/$id');
    return _rest.decode(data, (Object? b) {
      final Map<String, dynamic> m = b! as Map<String, dynamic>;
      final List<dynamic> hist =
          (m['payment_history'] as List<dynamic>?) ?? <dynamic>[];
      return hist
          .map((dynamic e) => PaymentRecord.fromJson(e as Map<String, dynamic>))
          .toList();
    });
  }

  @override
  Future<BudgetInfo> getBudget() async {
    final Object? data = await _rest.get('/budget');
    return _rest.decode(
      data,
      (Object? b) => BudgetInfo.fromJson(b! as Map<String, dynamic>),
    );
  }

  @override
  Future<BudgetInfo> updateBudget(BudgetInfo budget) async {
    final Object? data = await _rest.put('/budget', body: budget.toJson());
    return _rest.decode(
      data,
      (Object? b) => BudgetInfo.fromJson(b! as Map<String, dynamic>),
    );
  }

  @override
  Future<Entitlements> getEntitlements() async {
    final Object? data = await _rest.get('/entitlements');
    return _rest.decode(
      data,
      (Object? b) => Entitlements.fromJson(b! as Map<String, dynamic>),
    );
  }
}
