/// Where a password-reset mail should send this build back to, and how to
/// recognise the arrival when it lands.
///
/// BOTH HALVES LIVE IN ONE FILE ON PURPOSE. The URL that is SENT and the parser
/// that READS it back are one contract with two ends; split across files they
/// drift, and the drift is invisible — a mail still sends, a link still
/// resolves, and only the person who followed it ever finds out.
///
/// PURE FUNCTIONS taking their inputs, rather than reading `kIsWeb` and
/// `Uri.base` themselves, for the reason `AuthCapabilities.forPlatform` is
/// written the same way: a value that can only be computed on the host it
/// describes is a value five of six platforms never check. Here it is worse than
/// that — the web arm is the ONLY arm that returns anything today, so a
/// self-reading version would be untestable on the one lane where the tests run.
library;

import 'package:nikatru_core/nikatru_core.dart' as core;

// 🔴 `PasswordResetArrival` AND ITS REPORT LIVE IN `packages/core`, NOT HERE.
// The router and the screen read them, and everything above the data layer
// programs against the seam rather than against whichever adapter is wired
// ([pipeline C-15]). What belongs in THIS package is the part that knows
// gotrue's redirect shape: the URL that is sent, and the parse that reads it
// back.
export 'package:nikatru_core/nikatru_core.dart'
    show PasswordResetArrival, PasswordResetArrivalReport;

/// The query parameter that marks a URL as OUR reset arrival.
///
/// 🔴 IT IS NOT DECORATION — IT IS WHAT KEEPS THIS OFF EVERY OTHER CALLBACK.
/// `?code=` is the shape of EVERY PKCE arrival, OAuth included, so a parser that
/// keyed on it alone would send somebody returning from Google sign-in to the
/// reset-password screen. gotrue preserves the query on both the success and the
/// failure redirect (measured live, 2026-08-11: `redirect_to=…/?nk_auth=reset`
/// with an invalid token answered `303` to
/// `…/?nk_auth=reset#error=access_denied&error_code=otp_expired`), and
/// `supabase_flutter`'s `removeAuthParametersFromUrl` strips only its own twelve
/// auth parameters and "preserv[es] any unrelated parameters" — so this survives
/// the SDK cleaning the URL after a successful exchange too.
const String kPasswordResetMarkerKey = 'nk_auth';
const String kPasswordResetMarkerValue = 'reset';

/// The URL to hand gotrue as `redirect_to`, or null to leave it to the project's
/// Site URL.
///
/// 🔴 THE ORIGIN, THE BASE PATH, THE MARKER AND THE ROUTE — ALL FOUR, AND EACH
/// ONE IS LOAD-BEARING. The shape is
/// `https://host/<base path>/?nk_auth=reset#/reset-password`.
///
///   · THE BASE PATH, because this build is NOT served at the origin root. The
///     web bundle is built with `--base-href /<app id>/`, so the app's home is
///     `https://<apex>/<app id>/` and the apex itself is a DIFFERENT document.
///     A redirect composed from `origin` alone lands there: a reset link that
///     opens the wrong site, with a `?code=` no app on that page will ever
///     exchange. It is DERIVED here and never named — the app id is the `id` in
///     `apps/<id>/app.yaml`, it has already been renamed once, and a literal in
///     this file would be one more place to forget.
///   · THE TRAILING `/` AND THE QUERY AFTER IT, because gotrue appends `code=…`
///     to the QUERY. Flutter web here is on the HASH strategy (nothing in this
///     repository calls `usePathUrlStrategy`), so a bare `…/#/reset-password`
///     would put the code inside the fragment where `detectSessionInUri` never
///     looks — a reset link that quietly does nothing.
///   · THE FRAGMENT, because with hash routing the fragment IS the route. On the
///     success redirect gotrue keeps it (it sets the query and leaves the
///     fragment alone), so the user lands ON this screen rather than on home and
///     then being moved.
///   · THE MARKER, because the fragment is the one part that does NOT survive a
///     FAILURE. Measured live rather than reasoned about: an expired link
///     answers `303` with a `Location:` of the redirect it was handed, suffixed
///     `#error=access_denied&error_code=otp_expired&…` — the query intact, the
///     fragment REPLACED by the error parameters. So on the commonest real
///     failure the route is gone and only the query can say what this was.
///     [passwordResetArrivalOf] reads it.
///
/// ⚠️ THIS EXACT PREFIX MUST BE ON THE SUPABASE REDIRECT ALLOW-LIST, AND SCOPED
/// TO THE APP'S BASE PATH — `https://<apex>/<app id>/**`, never
/// `https://<apex>/**`. One Supabase project authenticates the whole portfolio
/// and every app now shares ONE origin, so the apex wildcard would make every
/// path on the site a legal post-auth landing place, this app's users included.
///
/// 🔴 AND THE LIST CANNOT BE CHECKED BY USING THE FEATURE. A `redirect_to` that
/// is not allow-listed does not error: gotrue SILENTLY SUBSTITUTES the project's
/// Site URL, so a wrong entry and a right one both produce mail that sends, a
/// link that resolves and a page that loads. The only way to know is to read the
/// list back from `GET /v1/projects/{ref}/config/auth` after every change and
/// compare it — "the flow works" is never the evidence. (Measured live on
/// 2026-08-11 against project `lcrkiurkvzhkonjwhpiv`, under the per-app
/// subdomain this build has since left: an ACCEPTED redirect came back still
/// carrying the marker and the fragment, a SUBSTITUTED one came back as the bare
/// Site URL. That difference is the whole of the observable.) The target
/// configuration is `docs/platform/supabase/README.md`.
///
/// [baseHref] is the resolved `<base href>` of the document — `document.baseURI`
/// on web — and is the AUTHORITATIVE base path when the caller can supply it.
/// Left null, the base path is derived from [base] (`Uri.base`), which is exact
/// under the hash strategy because the route lives in the fragment and the path
/// is therefore the deployment's own directory. 🔴 IF THIS APP EVER ADOPTS
/// `usePathUrlStrategy`, THAT DERIVATION STOPS BEING TRUE — a deep link's path
/// then carries the route as well — and the caller MUST pass [baseHref].
///
/// [isWeb] false ⇒ null. No native target in this repository registers a custom
/// URI scheme yet (no `CFBundleURLTypes`, no `<data android:scheme>`, no
/// `.desktop` handler), so there is no address a native build could give that
/// would resolve. Returning the file: URI `Uri.base` reports off-web would be
/// worse than saying nothing.
String? passwordResetRedirectUrl({
  required bool isWeb,
  required Uri base,
  String? baseHref,
}) {
  if (!isWeb) return null;
  // A `<base href>` is ordinarily relative (`/<app id>/`), so it is RESOLVED
  // against the running URL rather than parsed alone — that is what turns it
  // into an origin plus a path. `tryParse` because this value crosses in from
  // the DOM: a malformed one must degrade to the derivation, not throw out of
  // the provider that builds the auth repository.
  final Uri? href = baseHref == null || baseHref.isEmpty
      ? null
      : Uri.tryParse(baseHref);
  final Uri deployed = href == null ? base : base.resolveUri(href);
  // `Uri.origin` THROWS on anything that is not http(s) with a host — which is
  // exactly what `Uri.base` is under a VM test runner. Guarded rather than
  // caught, so the refusal is a decision and not an exception path.
  if (!deployed.isScheme('http') && !deployed.isScheme('https')) return null;
  if (deployed.host.isEmpty) return null;
  return '${deployed.origin}${_deployedBasePath(deployed.path)}'
      '?$kPasswordResetMarkerKey=$kPasswordResetMarkerValue'
      '#/reset-password';
}

/// The DIRECTORY [path] is served from, always leading- and trailing-slashed.
///
/// The three shapes one deployment really produces, and why each is treated the
/// way it is:
///
///   · `/<app id>/` — the address bar under a base href. Already the directory.
///   · `/<app id>` — the same deployment before the server's directory redirect
///     has run, or a link written without the slash. Stripping the last segment
///     here is the bug this whole unit exists to prevent, so a final segment
///     that names no FILE is treated as the directory it is.
///   · `/<app id>/index.html` — what `document.baseURI` reports when the document
///     carries no `<base>` tag at all. The file is dropped.
///
/// A segment counts as a file when it carries a dot, which is also why a
/// path-strategy route (`/<app id>/reset-password`) would be misread as a
/// directory — see the [baseHref] escape hatch on [passwordResetRedirectUrl].
String _deployedBasePath(String path) {
  if (path.isEmpty) return '/';
  final String rooted = path.startsWith('/') ? path : '/$path';
  final int lastSlash = rooted.lastIndexOf('/');
  final String last = rooted.substring(lastSlash + 1);
  if (last.isEmpty) return rooted;
  if (last.contains('.')) return rooted.substring(0, lastSlash + 1);
  return '$rooted/';
}

/// Classify the URL this app was launched with.
///
/// 🔴 READS THE FRAGMENT AS WELL AS THE QUERY, and both are necessary rather
/// than belt-and-braces. gotrue puts the SUCCESS parameters in the query
/// (`?code=`) and the FAILURE parameters in the fragment
/// (`#error=access_denied&error_code=otp_expired`) — the same split
/// `supabase_flutter`'s own `_isAuthCallbackDeeplink` reads both sides for
/// (`supabase_auth.dart:203-213`).
///
/// 🔴 AND IT REFUSES ANY URL WITHOUT OUR MARKER. See [kPasswordResetMarkerKey]:
/// `?code=` is every PKCE arrival, so keying on it alone would route somebody
/// coming back from an OAuth sign-in to the reset screen.
core.PasswordResetArrivalReport passwordResetArrivalOf(Uri url) {
  Map<String, String> fragmentParams;
  try {
    fragmentParams = Uri.splitQueryString(url.fragment);
  } catch (_) {
    // A fragment that is a ROUTE rather than a parameter list is the ordinary
    // case here (`#/reset-password`), and `splitQueryString` is total over it —
    // but a percent-decoding failure is not, and this parser deciding the
    // app's first route must not be able to throw.
    fragmentParams = const <String, String>{};
  }
  final Map<String, String> query = url.queryParameters;
  String? param(String key) => query[key] ?? fragmentParams[key];

  if (param(kPasswordResetMarkerKey) != kPasswordResetMarkerValue) {
    return core.PasswordResetArrivalReport.none;
  }
  final String? error =
      param('error') ?? param('error_code') ?? param('error_description');
  if (error != null) {
    return core.PasswordResetArrivalReport(
      core.PasswordResetArrival.unusable,
      // The SAME classifier the seam runs over an exception message, given the
      // three error parameters joined. `error_code=otp_expired` is what gotrue
      // really sends for an expired or already-spent link (measured live), and
      // it reaches `expiredOrUsed` through the `otp_expired` arm — so the URL
      // path and the exception path cannot disagree about what to tell the user.
      problem: core.authLinkProblemOf(
        <String?>[
          param('error'),
          param('error_code'),
          param('error_description'),
        ].whereType<String>().join(' '),
      ),
    );
  }
  // `code` present ⇒ the exchange is about to run. `code` ABSENT with the marker
  // still there ⇒ the SDK has already exchanged it and cleaned its own
  // parameters out of the URL, leaving ours behind. Both are "a reset is in
  // flight"; neither is a failure.
  return const core.PasswordResetArrivalReport(
    core.PasswordResetArrival.pending,
  );
}
