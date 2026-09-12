# Consumer Agent Map Pins

The consumer agent finder now creates an interactive marker for every visible town returned by the approved public-agent directory. A marker represents one or more approved profiles at **town-level precision only**; it never uses an agent’s address or postcode.

When a visitor selects a marker, the finder reveals the approved public profiles in that town and provides direct links to their public pages. The same interaction is available through keyboard-accessible town buttons beneath the map, so the expert directory remains usable if map services are unavailable.

## Verification note

The development preview currently has no approved-directory and showcase fixture data, so it displays the existing loading or empty states rather than live marker and gallery content. The rendered map and gallery behaviour is therefore covered by the source accessibility contract and focused API/payload regression tests; final visual verification will use a populated approved profile or an authenticated Orbit test snapshot after the Railway migration is applied.
