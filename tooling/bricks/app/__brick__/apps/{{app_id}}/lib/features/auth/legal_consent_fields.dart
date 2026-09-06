import 'package:flutter/material.dart';
import 'package:nikatru_chassis_screens/auth/legal_consent_fields.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/app_config.dart';

/// The two consent tick boxes — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]), including
/// the whole argument for why terms and marketing are two different legal
/// animals and why neither may ever arrive ticked. What stays here is the ONE
/// thing that could not travel: the URLs and the platform call that opens them.
///
/// 🔴 `url_launcher` IS WHY, AND IT IS A MEASURED BOUNDARY RATHER THAN A
/// PREFERENCE. `assert-package-boundaries.mjs` limb C (`:185-201`) derives the
/// ADAPTER set from the tree — any package under `packages/` that is not `core`
/// or `design_system` and declares a third-party dependency wraps that
/// dependency — and `:288-298` then fails every app importing it directly.
/// `packages/chassis_screens` declares none, so it stays a plain widget
/// library; the launcher call lives here, where the brick already carries the
/// dated `brick|url_launcher` bypass for `AppConfig.privacyUrl` and the support
/// mailto.
class LegalConsentFields extends StatelessWidget {
  const LegalConsentFields({
    super.key,
    required this.termsAccepted,
    required this.marketingAccepted,
    required this.onTermsChanged,
    required this.onMarketingChanged,
    this.enabled = true,
    this.showMarketing = true,
  });

  final bool termsAccepted;
  final bool marketingAccepted;
  final ValueChanged<bool> onTermsChanged;
  final ValueChanged<bool> onMarketingChanged;
  final bool enabled;
  final bool showMarketing;

  static const Key termsCheckbox = LegalConsentFieldsView.termsCheckbox;
  static const Key marketingCheckbox =
      LegalConsentFieldsView.marketingCheckbox;

  /// Opens the LIVE terms page. Best-effort: a link that will not open must
  /// never break sign-up.
  ///
  /// Exposed as a static so `SignUpScreen` and `ReacceptTermsScreen` can hand
  /// it to their own chassis views without a second copy of the launcher.
  static Future<void> openTerms() => _open(AppConfig.termsUrl);

  /// Opens the LIVE privacy page.
  static Future<void> openPrivacy() => _open(AppConfig.privacyUrl);

  static Future<void> _open(String url) async {
    try {
      await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
    } catch (_) {
      // Best-effort — a link that will not open must never break sign-up.
    }
  }

  @override
  Widget build(BuildContext context) => LegalConsentFieldsView(
    termsAccepted: termsAccepted,
    marketingAccepted: marketingAccepted,
    onTermsChanged: onTermsChanged,
    onMarketingChanged: onMarketingChanged,
    onOpenTerms: openTerms,
    onOpenPrivacy: openPrivacy,
    enabled: enabled,
    showMarketing: showMarketing,
  );
}
