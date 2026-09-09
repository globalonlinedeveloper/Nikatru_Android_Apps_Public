import 'dart:convert';

import 'package:flutter/foundation.dart' show visibleForTesting;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_core/nikatru_core.dart' as core;

import 'analytics_providers.dart';
import 'providers.dart' show subscriptiontrackerNotificationServiceProvider;

/// Where the settings live on disk — the same [core.KeyValueStore] seam the
/// consent decision and the install id use ([ADR 005]). Namespaced like
/// [kInstallIdKey] so a stamped app's stores stay mutually legible.
const String kSettingsKey = 'nikatru.settings';

class SettingsState {
  const SettingsState({
    this.currencySymbol = r'$',
    this.prefs = const <String, bool>{
      'alerts': true,
      'priceHike': true,
      'unused': true,
      'weekly': false,
    },
  });

  /// What the picker in Settings writes: one of four glyphs.
  final String currencySymbol;

  final Map<String, bool> prefs;

  /// The chosen currency as an ISO 4217 code — the unit a NEW subscription is
  /// entered in, and the unit a stored figure that never carried a currency
  /// (the budget, a pre-migration row) is read under.
  ///
  /// 🔴 THE PICKER STORES A GLYPH, AND THIS IS THE BOUNDED MAP BACK. A symbol
  /// is not a currency in general — a bare dollar sign is written by the US,
  /// Australia and Canada among others — so a reverse lookup would be a guess
  /// on an open set. It is not an open set here: `settings_screen.dart` offers
  /// EXACTLY these four chips, so the mapping is a statement of what this app's
  /// dollar chip MEANS, not an inference from the glyph. A symbol that is not
  /// one of the four (an older or corrupted store) falls back rather than
  /// picking a currency nobody chose.
  ///
  /// ⚠️ Adding a fifth chip means adding a row here. Anything else silently
  /// spends the new chip's money in dollars.
  String get currencyCode => codeForSymbol(currencySymbol);

  static const Map<String, String> _codeBySymbol = <String, String>{
    r'$': 'USD',
    '€': 'EUR',
    '£': 'GBP',
    '₹': 'INR',
  };

  static String codeForSymbol(String symbol) =>
      _codeBySymbol[symbol] ?? core.Money.fallbackCurrencyCode;

  SettingsState copyWith({String? currencySymbol, Map<String, bool>? prefs}) =>
      SettingsState(
        currencySymbol: currencySymbol ?? this.currencySymbol,
        prefs: prefs ?? this.prefs,
      );

  Map<String, Object?> toJson() => <String, Object?>{
    'currencySymbol': currencySymbol,
    'prefs': prefs,
  };

  /// Merges the persisted values OVER the compiled-in defaults, so a pref key
  /// added in a later release still gets its default on old installs — the
  /// same "a missing key can never silently flip a user's notifications"
  /// rule ReminderPlan.from enforces. Non-bool junk is dropped, not trusted.
  factory SettingsState.fromJson(Map<String, Object?> json) {
    const SettingsState defaults = SettingsState();
    final Object? symbol = json['currencySymbol'];
    final Object? prefs = json['prefs'];
    return SettingsState(
      currencySymbol: symbol is String && symbol.isNotEmpty
          ? symbol
          : defaults.currencySymbol,
      prefs: <String, bool>{
        ...defaults.prefs,
        if (prefs is Map<String, Object?>)
          for (final MapEntry<String, Object?> e in prefs.entries)
            if (e.value is bool) e.key: e.value! as bool,
      },
    );
  }
}

/// Owns the user's preferences and — since 2026-08-01 — actually keeps them.
///
/// Before this, `build()` returned defaults and the toggles wrote nowhere, so
/// every launch reset the prefs — and worse than mere amnesia: the reset
/// `weekly: false` made SubscriptionsController's launch-time `_syncReminders`
/// CANCEL the Sunday digest the user had switched on last session. The exact
/// defect class this codebase's own comments condemn ("a switch that promises
/// a feature and delivers none"), now closed with the [ADR 005] store: hydrate
/// on build, write on every change, round-trip proven by
/// test/settings_wiring_test.dart.
class SettingsController extends Notifier<SettingsState> {
  /// Latched by the first user mutation. Hydration only applies the persisted
  /// state while this is false — a user who toggles faster than the disk read
  /// resolves must never have that choice overwritten by last session's state.
  bool _touched = false;

  late Future<void> _hydration;

  @override
  SettingsState build() {
    _touched = false;
    _hydration = _hydrate();
    return const SettingsState();
  }

  /// Completes when the persisted state (if any) has been applied. Tests await
  /// this instead of guessing at pump counts; production code never needs it —
  /// the state simply updates and listeners react.
  @visibleForTesting
  Future<void> get hydration => _hydration;

  Future<void> _hydrate() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      final String? raw = await kv.read(kSettingsKey);
      if (raw == null || _touched) return;
      final Object? decoded = jsonDecode(raw);
      if (decoded is Map<String, Object?> && !_touched) {
        state = SettingsState.fromJson(decoded);
      }
    } catch (_) {
      // Unreadable or corrupt store — keep the compiled-in defaults. Settings
      // must never be able to break launch.
    }
  }

  Future<void> setCurrency(String symbol) {
    _touched = true;
    state = state.copyWith(currencySymbol: symbol);
    return _persist();
  }

  /// The prefs that cause something to be posted to the OS notification centre.
  /// `unused` only changes what the app draws for itself, so switching it on is
  /// not the user asking for notifications and must not spend the prompt.
  static const Set<String> _reminderBearing = <String>{'alerts', 'weekly'};

  Future<void> toggle(String key) async {
    _touched = true;
    final Map<String, bool> next = Map<String, bool>.of(state.prefs);
    final bool on = !(next[key] ?? false);
    next[key] = on;
    state = state.copyWith(prefs: next);
    await _persist();

    // 🔴 [pipeline 13]T-4 — THE IN-CONTEXT ASK. This is one of the only two
    // places in the app allowed to reach `requestPermissions()`, and it is
    // reachable ONLY from `SwitchListTile`'s callback: a real user gesture, on
    // the switch that names the feature being enabled. That gesture requirement
    // is not just good manners — on Web the permission request is REFUSED
    // outright unless it happens inside a user-gesture handler.
    //
    // Off is never an ask: turning a feature OFF cannot be a reason to prompt.
    if (on && _reminderBearing.contains(key)) {
      await ref
          .read(subscriptiontrackerNotificationServiceProvider)
          .requestPermissions();
    }
  }

  /// Fire-and-forget from the UI's point of view (the callbacks are
  /// VoidCallbacks), awaitable from tests. State is already updated when this
  /// runs, so a failed write costs persistence, never the current session.
  Future<void> _persist() async {
    try {
      final core.KeyValueStore kv = await ref.read(
        keyValueStoreProvider.future,
      );
      await kv.write(kSettingsKey, jsonEncode(state.toJson()));
    } catch (_) {
      // Same contract as _hydrate: a broken store degrades to the pre-fix
      // in-memory behaviour rather than surfacing an error for a toggle.
    }
  }
}

final NotifierProvider<SettingsController, SettingsState>
settingsControllerProvider =
    NotifierProvider<SettingsController, SettingsState>(SettingsController.new);

/// The user's chosen currency, as an ISO 4217 code.
///
/// 🔴 THIS REPLACED A `Provider<Currency>` THAT WAS A FORMATTER. That shape
/// hardcoded `en_US` grouping into every figure in the app and glued a bare
/// glyph to the front of it, because a provider has no `BuildContext` and so no
/// locale. Formatting now happens where the reader's locale is known and takes
/// a `MoneyFormatter(l10n.localeName)`; what a provider can honestly answer is
/// which currency the user picked, which is this.
final Provider<String> currencyCodeProvider = Provider<String>(
  (ref) => ref.watch(settingsControllerProvider).currencyCode,
);
