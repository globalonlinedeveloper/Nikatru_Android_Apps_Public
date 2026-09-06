import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:nikatru_chassis_screens/auth/reaccept_terms_screen.dart';

import '../../state/providers.dart';
import 'legal_consent_fields.dart';

/// The MATERIAL-CHANGE re-acceptance interstitial — the ADAPTER half.
///
/// 🏗️ THE BODY IS IN `package:nikatru_chassis_screens` ([ADR 071]), and the
/// consent flag went with the box: `assert-signup-consent-shape.mjs` reads this
/// surface as its own code UNIONED with the chassis file it delegates to, so
/// `bool _accepted = false;` is still asserted, where it now lives.
///
/// 🔴 THE DECLINE PATH GOES THROUGH [signOutAndForgetUser], AND THAT IS WHY IT
/// STAYED HERE. This was `ref.read(authRepositoryProvider).signOut()`, so the
/// entitlement cache and the notification schedule survived it — and this is
/// the sign-out a PAYING user is most likely to reach, because a `kTermsVersion`
/// bump puts this interstitial in front of every signed-in account in the world
/// and Decline is the only way past it that is not "agree".
class ReacceptTermsScreen extends ConsumerWidget {
  const ReacceptTermsScreen({super.key});

  static const Key acceptButton = ReacceptTermsView.acceptButton;
  static const Key signOutButton = ReacceptTermsView.signOutButton;
  static const Key statusLine = ReacceptTermsView.statusLine;

  @override
  Widget build(BuildContext context, WidgetRef ref) => ReacceptTermsView(
    // `acceptTermsOnly`, never `accept(marketingEmail: false)`: this screen
    // shows no marketing box, so it must not speak for that decision.
    // Recording a fresh `granted: false` marketing artifact would silently
    // unsubscribe somebody for accepting a terms change.
    onAccept: () =>
        ref.read(legalAcceptanceProvider.notifier).acceptTermsOnly(),
    onSignOut: () => signOutAndForgetUser(ref),
    onOpenTerms: LegalConsentFields.openTerms,
    onOpenPrivacy: LegalConsentFields.openPrivacy,
  );
}
