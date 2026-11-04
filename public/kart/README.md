# The racetrack game's assets

The second signing game (app/sign/kart): Sam races Judy, three laps of about
a minute each, and the signing page opens at the finish. `manifest.json`
names what's here, and the game studio on /sign/preview?game=race makes the
rest on the server (api/game-assets.ts), stored in the public brand bucket,
which wins over anything named here:

- `music`: the track for laps one and two (the same song as the theater by
  default). `musicFinal`: the track that takes over on the last lap; null
  until the studio makes one (ElevenLabs Music, key `kart-final` in the
  bucket's music list), when the game crossfades to it at the start of lap
  three.
- `sounds`: `kart-engine` (a loop whose pitch follows the speed), `kart-drift`,
  `kart-jump` (Space), `kart-land`, `kart-lap`, `kart-finish`, `kart-bump`,
  `kart-count`, `kart-go`, `kart-boost`. Each null until made; the game
  synthesizes stand-ins with Web Audio so it is always playable.
- `voice`: Judy's lines by id in `judy.json` (all begin `k-`), voiced with the
  same voice as the theater's Judy. Each line has a `cue`: when the race
  plays it.
