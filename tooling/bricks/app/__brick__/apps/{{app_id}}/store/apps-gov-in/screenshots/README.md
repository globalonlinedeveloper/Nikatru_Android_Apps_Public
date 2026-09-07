# Screenshots — {{{short_name}}} · `apps-gov-in`

**This directory is stamped EMPTY on purpose, and that is not the same as
forgotten.** Every other field in this tree is derived from the app spec by
`tooling/bricks/app`. Screenshots are the one listing input that cannot be:
they are photographs of a build that does not exist at stamp time.

The Mobile Seva AppStore's upload form is behind an authenticated login and
nobody has read it, so **how many screenshots it asks for, and at what
dimensions, is UNVERIFIED** (`O-APPS-GOV-IN-SBOM` — the same unread form). No
dimension is declared in `tooling/channel-register.json` for this channel and
none is enforced. Do not guess one: an invented limit fires on correct input.

## How to fill it

1. Build and run the app for Android. This channel takes the same `.apk` the
   `android-play` lane already produces — see
   `Private/runbooks/store-submission-apps-gov-in.md`.
2. Capture the frames. `tooling/store/capture-play-screenshots.mjs` does it for
   Play against a live build and writes `CAPTURE.json` recording which build was
   photographed — a screenshot with no provenance is evidence about nothing. The
   Play captures are the right starting set here; whether the portal accepts
   them is part of the unread form.
3. Commit the PNGs here.

## What must NOT be captured

A DEMO build. A demo build is a different app on screen — seeded sample data,
and in this chassis a banner saying so. A listing built from one advertises a
product nobody can install.

## ⏳ And this is the channel with a deadline

The developer profile is suspended if no app is uploaded within two months of
approval (approved 2026-08-31 → about 2026-10-31). Screenshots are the standing
blocker under every store in this portfolio (`O-STORE-SCREENSHOTS`), and this is
the one store where that blocker has a date attached to it.
