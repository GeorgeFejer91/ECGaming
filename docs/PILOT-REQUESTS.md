# Pilot requests

Ground Control asks for a session callsign, such as `Major Tom`, before it
announces itself. A direct visit to `/controller/` asks for a pilot name,
discovers open Ground Control pages, displays their callsigns, and sends a
request to the chosen tower. External cockpit requests ask for a cockpit name.
With multiple towers, the phone asks which one to join by callsign. Direct links
can still include `?tower=<id>` to choose a particular hidden route, plus
`towerName=<callsign>` for readable feedback.

Ground Control can accept or decline. Only acceptance replaces the current
phone and supplies the new pilot with a fresh private invitation. The phone
then opens its yoke automatically. Existing QR invitations still pair directly.
Chrome instructions sit beside the QR code, stacking below it on narrow screens.
The controller name-entry screen includes a compact troubleshooting checklist
showing the current site host, target tower, HTTPS state, tower discovery,
request-channel state, and whether the request has been sent. If Ground Control
does not show the approval dialog, the checklist distinguishes "target tower not
found" from "request sent; check Ground Control". When no tower is discovered
after a few seconds, the phone keeps the request form open and reports the
website host it is scanning, with "Request: Not sent" so a stale tab, mixed
domain, or closed Ground Control window is easier to spot.
Ground Control acknowledges receipt as soon as the request dialog is created. If
the request channel opens but the phone does not receive that acknowledgement,
the phone resends the request before reporting failure. If the request channel
drops before Ground Control answers, the phone automatically retries twice. The
checklist reports the retry count first, then "Connection closed before answer"
only after all attempts fail.

## Transport and authority

The public rendezvous uses pinned VDO.Ninja SDK 1.5.5 and a reliable ordered
`ecg_pilot_request_v1` channel, in a room scoped to the website host. Discovery
uses a hidden random stream ID for routing and a user-entered Ground Control
callsign for display. Pilot and cockpit names travel only in point-to-point
requests. Names are display labels, not verified identities.

This rendezvous is separate from BRSP/1 flight control. It accepts only bounded
request, cancel, declined and accepted messages. Requests expire after 60 seconds;
there are at most eight application request peers, one request per peer, and
messages are limited to 1,024 UTF-8 bytes. Accepted invitations use the existing
random room/secret format and are sent only to the approved peer. No raw ECG,
flight inputs, executable code or arbitrary URLs cross the public channel.

After approval, existing BRSP/1 authentication, ECGaming tilt/companion scopes,
state acknowledgements and target-enforced input freshness apply. A pending,
declined or cancelled pilot has no flight authority. The selected ECG source
continues to use the existing flight session router.

## Validation

Parser tests cover malformed, oversized and unexpected payloads. Browser tests
cover named approval, pending authority, decline without replacing the current
pilot, cancellation, accepted handover, multiple towers and responsive QR copy.
An additional Chromium smoke test used the pinned SDK with real public signaling
and WebRTC: direct URL, name request, approval, automatic yoke and acknowledged
steering all passed without page errors. Sensor readings were injected for that
test; it does not establish physical Motorola sensor or Bluetooth behavior.
