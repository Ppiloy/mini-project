# Honest logout failure recovery

Type: task
Status: claimed
Blocked by: 04

Additional independent session review reproduced a failed logout returning 503, followed by silent local identity clearing and navigation to login. The still-valid server session then restored private access on reload. Evidence is the external `ftc-extra-session-review.md` at integration `0a27ac829062f168fb4963bfb2e690a4c0ce5f51`.

Repair the public hosted logout flow so it shows a useful failure and retry action until server termination is confirmed. If a failed response is ambiguous, a successful anonymous session lookup may confirm logout; a still-authenticated or unavailable lookup must not report success. Keep fixture sign-out straightforward. Test through browser journeys: failed logout, ambiguous response after committed logout, successful retry and private access after completed logout. Independently adversarially review the exact clean candidate before merger integration.

The same independent review confirmed the adjacent wrong-role entry path: officer login changes the server session but failed cleanup logout leaves the previous taxpayer identity and pending cache in the SPA. Include account-switch consistency and honest cleanup failure/retry in this unit. A successful server login must not leave the previous account rendered or cached merely because it used the wrong entry screen.
