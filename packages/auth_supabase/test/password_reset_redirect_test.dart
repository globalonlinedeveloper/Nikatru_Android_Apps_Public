// ─────────────────────────────────────────────────────────────────────────────
// WHERE THE RECOVERY MAIL SENDS PEOPLE BACK TO.
//
// 🔴 THE FAILURE THIS RULES OUT IS INVISIBLE FROM INSIDE THE APP. gotrue does
// not reject a `redirect_to` it dislikes and does not error on a null one — it
// silently substitutes the PROJECT's Site URL. So a wrong value, an absent
// value and a correct value all produce mail that sends, a link that resolves
// and a page that loads. The only observable difference is which app the user
// ends up in, and one Supabase project authenticates the whole portfolio.
//
// 🔴 AND SINCE THE MOVE TO PATH ROUTING THAT IS NO LONGER A DIFFERENT HOST — IT
// IS A DIFFERENT PATH ON THE SAME ONE. The web bundle is built with
// `--base-href /<app id>/`, so this app lives at `https://<apex>/<app id>/` and
// the apex is the marketing site. A redirect composed from the ORIGIN alone is
// still a perfectly valid URL, still resolves, still returns 200 — and lands
// the user on a page that has no idea what the `?code=` in its query is for.
// That is the regression every case in the first group exists to catch.
//
// ⚠️ THE BASE PATH ENDS IN `/`, AND THE ROUTE STAYS IN THE FRAGMENT. Nothing in
// this repository calls `usePathUrlStrategy`, so Flutter web is on the HASH
// strategy and the reset screen's real address is
// `https://<apex>/<app id>/#/reset-password` — the route is in the FRAGMENT.
// gotrue appends `?code=…` to whatever it is handed; append it to that and the
// code lands inside the fragment, where `detectSessionInUri` never looks. No
// error, no session, no screen: a reset link that quietly does nothing. Landing
// on the app's OWN ROOT and letting the SDK read `?code=` off the query is what
// makes the flow work at all — and it is why the app has to learn "this is a
// recovery" from the EVENT rather than from the URL.
//
// The `/subly/` in these fixtures is DATA, not a contract: `app.yaml`'s `id`
// today, renamed once already. The last case in the first group proves nothing
// in the composition knows it.
// ─────────────────────────────────────────────────────────────────────────────
import 'package:flutter_test/flutter_test.dart';
import 'package:nikatru_auth_supabase/nikatru_auth_supabase.dart';
import 'package:nikatru_core/nikatru_core.dart' show AuthLinkProblem;

void main() {
  group('passwordResetRedirectUrl', () {
    // ALL FOUR PARTS ASSERTED TOGETHER, because each one is load-bearing for a
    // different failure: the ORIGIN sends a preview deployment's users back to
    // itself; the BASE PATH keeps them inside this app rather than on the apex;
    // the `/` at its end keeps gotrue's `?code=` in the real query where the SDK
    // reads it (with hash routing a bare `.../#/reset-password` would bury it in
    // the fragment); the FRAGMENT is the route, so a SUCCESSFUL link lands on
    // this screen rather than on home; and the MARKER is the part that survives
    // a FAILURE, where gotrue replaces the fragment with its own error
    // parameters — measured live, not assumed.
    test('on web it is the ORIGIN, the BASE PATH, the MARKER and the ROUTE', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://nikatru.com/subly/#/settings'),
        ),
        'https://nikatru.com/subly/?nk_auth=reset#/reset-password',
      );
    });

    // 🔴 THE REGRESSION THIS UNIT EXISTS FOR, ASSERTED AS ITS OWN CASE SO THE
    // FAILURE NAMES ITSELF. The previous composition was `'${base.origin}/'` —
    // correct while the app owned a whole subdomain, and silently wrong the
    // moment it moved under a path. Every expectation below reds against that
    // exact code, which is the property the group's first case only implies.
    test('the BASE PATH is never dropped for the bare origin', () {
      final String? sent = passwordResetRedirectUrl(
        isWeb: true,
        base: Uri.parse('https://nikatru.com/subly/#/settings'),
      );
      expect(sent, isNotNull);
      expect(
        sent,
        startsWith('https://nikatru.com/subly/'),
        reason: 'composed from the origin alone this would be '
            'https://nikatru.com/?nk_auth=reset#/reset-password — the apex, '
            'which is a different document that will never exchange the code',
      );
      expect(
        Uri.parse(sent!).path,
        '/subly/',
        reason: 'the path IS the app on a shared origin; an empty one is the '
            'marketing site',
      );
      expect(sent, isNot(contains('nikatru.com/?')));
    });

    // `document.baseURI` on a document carrying no `<base>` tag is the DOCUMENT
    // URL, file and all. The file is not part of the base path.
    test('an index.html base URL yields the directory, not the file', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://nikatru.com/subly/index.html'),
        ),
        'https://nikatru.com/subly/?nk_auth=reset#/reset-password',
      );
    });

    // The window between a link written without the trailing slash and the
    // server's directory redirect. Treating `/subly` as a file and stripping it
    // would be the dropped-base-path bug wearing a different hat.
    test('a base path with no trailing slash is still the base path', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://nikatru.com/subly'),
        ),
        'https://nikatru.com/subly/?nk_auth=reset#/reset-password',
      );
    });

    // 🔴 THE ESCAPE HATCH, AND THE ONE SITUATION THAT NEEDS IT. Under
    // `usePathUrlStrategy` the running URL's path carries the ROUTE as well as
    // the base path, and no amount of string work can tell the two apart. The
    // document's `<base href>` can, so the caller may hand it over and it WINS.
    test('an explicit base href beats the running URL', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://nikatru.com/subly/settings/notifications'),
          baseHref: '/subly/',
        ),
        'https://nikatru.com/subly/?nk_auth=reset#/reset-password',
        reason: 'a path-strategy deep link would otherwise send the reset mail '
            'to the screen the user happened to be standing on',
      );
    });

    // `document.baseURI` is absolute in every browser; a hand-written `<base
    // href>` is usually relative. Both have to work, and a broken one must
    // degrade to the derivation rather than throw out of the provider that
    // builds the auth repository.
    test('an absolute base href is honoured and a malformed one degrades', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://nikatru.com/subly/#/settings'),
          baseHref: 'https://nikatru.com/subly/',
        ),
        'https://nikatru.com/subly/?nk_auth=reset#/reset-password',
      );
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://nikatru.com/subly/#/settings'),
          baseHref: '',
        ),
        'https://nikatru.com/subly/?nk_auth=reset#/reset-password',
        reason: 'an empty base href is no information, not a reason to lose '
            'the path the running URL already carries',
      );
    });

    // 🔴 NOTHING HERE KNOWS THE APP ID. It is `apps/<id>/app.yaml`'s `id`, it
    // has been renamed once already, and the day it is renamed again this file
    // must not be one of the places that has to be found. A literal would pass
    // every case above and fail only in production, on one app.
    test('the base path is DERIVED — no app id is written into the rule', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://nikatru.com/some-other-app/#/home'),
        ),
        'https://nikatru.com/some-other-app/?nk_auth=reset#/reset-password',
      );
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('https://subly-9cp.pages.dev/#/home'),
        ),
        'https://subly-9cp.pages.dev/?nk_auth=reset#/reset-password',
        reason: 'a build served at the ORIGIN ROOT has an empty base path, and '
            'a rule that INSISTED on a path segment would break every one of '
            'those — a localhost run, a Pages preview alias — as surely as one '
            'that ignores the path breaks production',
      );
    });

    test('the port is carried — localhost dev is a different origin', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('http://localhost:8080/'),
        ),
        'http://localhost:8080/?nk_auth=reset#/reset-password',
        reason: 'an origin that dropped the port would send every local run to '
            'the production site, which is a reset link that works and takes '
            'the developer somewhere else entirely',
      );
    });

    // THE ROUND TRIP, which is the property that actually matters: whatever this
    // function SENDS must be recognised by the parser that READS it back. They
    // are one contract with two ends, and the way they come apart is silent.
    test('what it sends is what the arrival parser recognises', () {
      final String sent = passwordResetRedirectUrl(
        isWeb: true,
        base: Uri.parse('https://nikatru.com/subly/'),
      )!;
      expect(
        passwordResetArrivalOf(Uri.parse(sent)).arrival,
        PasswordResetArrival.pending,
      );
    });

    // 🔴 NULL, NOT A FABRICATED SCHEME. No native target in this repository
    // registers a URI scheme yet — no CFBundleURLTypes, no <data android:scheme>,
    // no .desktop handler — so there is no address a native build could give
    // that would resolve. Returning the `file:` URI `Uri.base` reports off-web
    // would be worse than saying nothing: it is not on any allow-list, so gotrue
    // falls back to the Site URL anyway, with the reason hidden.
    test('off web it declines rather than inventing an address', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: false,
          base: Uri.parse('https://nikatru.com/subly/'),
        ),
        isNull,
        reason: 'isWeb wins over the URI — a web build still reports a host '
            'TargetPlatform, and a desktop build handed a plausible https URI '
            'still has nothing registered to receive it',
      );
    });

    // The VM's `Uri.base` is a `file:` directory URI, and `Uri.origin` THROWS on
    // one. Guarded rather than caught: the refusal is a decision this function
    // makes, not an exception path it survives.
    test('a non-http base is refused instead of throwing', () {
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('file:///C:/src/app/'),
        ),
        isNull,
      );
      expect(
        passwordResetRedirectUrl(isWeb: true, base: Uri.parse('https:///path')),
        isNull,
        reason: 'no host is no origin',
      );
      expect(
        passwordResetRedirectUrl(
          isWeb: true,
          base: Uri.parse('file:///C:/src/app/'),
          baseHref: '/subly/',
        ),
        isNull,
        reason: 'a base href is a PATH — resolved against a file: URI it is '
            'still a file: URI, and no allow-list entry can ever match one',
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // THE PARSER, AGAINST URLS MEASURED OFF THE LIVE PROJECT — not invented.
  //
  // Every URL below is the shape of a real `Location:` answered by the real
  // gotrue instance (project lcrkiurkvzhkonjwhpiv) on 2026-08-11, by handing
  // `/auth/v1/verify?type=recovery` a deliberately invalid token with each
  // `redirect_to` in turn; the host and path are the post-move deployment's,
  // since gotrue echoes whatever `redirect_to` it accepted. A fixture written
  // from the documentation would encode what the docs say; these encode what the
  // server does — including the part that decided this design, which is that the
  // FRAGMENT does not survive a failure and the QUERY does.
  group('passwordResetArrivalOf', () {
    test('an EXPIRED link is unusable, and typed as expired', () {
      final report = passwordResetArrivalOf(
        Uri.parse(
          'https://nikatru.com/subly/?nk_auth=reset'
          '#error=access_denied&error_code=otp_expired'
          '&error_description=Email+link+is+invalid+or+has+expired&sb=',
        ),
      );
      expect(report.arrival, PasswordResetArrival.unusable);
      expect(
        report.problem,
        AuthLinkProblem.expiredOrUsed,
        reason:
            'the same classifier the seam runs over an exception message, so '
            'the URL path and the exception path cannot tell the user two '
            'different things about one situation',
      );
    });

    test('a link still carrying its code is PENDING', () {
      expect(
        passwordResetArrivalOf(
          Uri.parse(
            'https://nikatru.com/subly/?nk_auth=reset&code=abc123'
            '#/reset-password',
          ),
        ).arrival,
        PasswordResetArrival.pending,
      );
    });

    test('the marker alone is still PENDING — the SDK cleaned up after itself',
        () {
      // `removeAuthParametersFromUrl` strips the SDK's own twelve auth
      // parameters and preserves everything else, so after a SUCCESSFUL
      // exchange the URL is exactly this. Reading it as `none` would drop the
      // user off the screen they are standing on.
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://nikatru.com/subly/?nk_auth=reset#/reset-password'),
        ).arrival,
        PasswordResetArrival.pending,
      );
    });

    // 🔴 THE PARSER READS THE QUERY AND THE FRAGMENT AND NOTHING ELSE, which is
    // why the move under a path prefix did not have to touch it — and this case
    // is what says so out loud. Any future "does this URL belong to us?" check
    // added here on the PATH would red it, and that is a check nobody should
    // write: the same build serves preview deployments at the origin root.
    test('the base path is not part of the contract the parser reads', () {
      for (final String url in <String>[
        'https://nikatru.com/subly/?nk_auth=reset&code=abc123',
        'https://nikatru.com/some-other-app/?nk_auth=reset&code=abc123',
        'https://subly-9cp.pages.dev/?nk_auth=reset&code=abc123',
        'http://localhost:8080/?nk_auth=reset&code=abc123',
      ]) {
        expect(
          passwordResetArrivalOf(Uri.parse(url)).arrival,
          PasswordResetArrival.pending,
          reason: '$url is the same arrival wherever it is served from',
        );
      }
    });

    // THE CASE THE MARKER EXISTS FOR. `?code=` is the shape of EVERY PKCE
    // arrival, OAuth included. Without the marker this parser would route
    // somebody returning from a Google sign-in to the reset-password screen — a
    // defect strictly worse than the one it fixes, because it would hit users
    // who never asked for a reset at all.
    test('an OAuth callback with a code is NOT a reset arrival', () {
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://nikatru.com/subly/?code=oauth-code-here'),
        ).arrival,
        PasswordResetArrival.none,
      );
      expect(
        passwordResetArrivalOf(
          Uri.parse(
            'https://nikatru.com/subly/'
            '#error=access_denied&error_code=otp_expired',
          ),
        ).arrival,
        PasswordResetArrival.none,
        reason: 'an error with no marker belongs to some other flow — a signup '
            'confirmation, a magic link — and this screen has nothing to say '
            'about it',
      );
    });

    test('an ordinary launch is none, and a route fragment does not confuse it',
        () {
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://nikatru.com/subly/'),
        ).arrival,
        PasswordResetArrival.none,
      );
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://nikatru.com/subly/#/budget'),
        ).arrival,
        PasswordResetArrival.none,
        reason:
            'the fragment is a ROUTE here rather than a parameter list, and '
            'this parser decides the first screen of the app — it must not '
            'throw on one',
      );
    });

    test('a wrong marker VALUE is not a reset arrival', () {
      expect(
        passwordResetArrivalOf(
          Uri.parse('https://nikatru.com/subly/?nk_auth=signup&code=x'),
        ).arrival,
        PasswordResetArrival.none,
        reason:
            'the key alone is not the contract — a future flow reusing the key '
            'with its own value must not land on this screen',
      );
    });
  });
}
