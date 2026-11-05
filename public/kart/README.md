# The racetrack game's assets

The second signing game (app/sign/kart): Sam races Judy, two laps of about
a minute each, while she rams him; in the final stretch her kart flips, Sam
tapes her arm back on, she wins, and the signing page opens. `manifest.json`
names what's here, and the game studio on /sign/preview?game=race makes the
rest on the server (api/game-assets.ts), stored in the public brand bucket,
which wins over anything named here:

- `music`: the track for the first lap (the theater's song as a fallback;
  the server's `kart-laps`, made with ElevenLabs Music, wins).
  `musicFinal`: the track that takes over on the last lap (the server's
  `kart-final`); the game crossfades to it as lap two begins.
- `sounds`: `kart-engine` (a loop whose pitch follows the speed), `kart-drift`,
  `kart-jump` (Space), `kart-land`, `kart-lap`, `kart-finish`, `kart-bump`,
  `kart-count`, `kart-go`, `kart-boost`, `kart-crash` (Judy's flip),
  `kart-pop` (her arm), `kart-tape`. Each null until made; the game
  synthesizes stand-ins with Web Audio so it is always playable.
- `voice`: Judy's lines by id in `judy.json` (all begin `k-`), voiced with the
  same voice as the theater's Judy. Each line has a `cue`: when the race
  plays it.
