# The signing game's assets

The easy way to make the generated ones (Judy's voice, the sound effects,
the props) is the "Game studio" panel on /sign/preview: it runs on the
server with the keys Vercel holds and stores the files in the public brand
bucket, which the game uses over anything named here. The scripts below do
the same from a machine that has the keys, writing into this folder.

Everything in this folder is served as-is at the same path (`/game/...`).
`manifest.json` tells the game (app/sign/game) what's here:

- `movie`: the file that plays on the theater screen. When null, the YouTube
  video named by `youtube` is embedded on the screen instead.
- `music`: plays from the start, fades out as the signer walks into the
  auditorium, and comes back during the film on `musicCue`: at `at` seconds
  into the film it starts from `from` seconds into the track, easing in over
  `fadeIn` seconds, then plays on through the exit and swells up the
  staircase. Without a cue it comes back when the signer stands up.
- `sounds`: short effects, each null until a file is dropped in: `door`
  (the exit door opening), `sit`, `sign` (the pen), `jump`, `land`, `fall`
  (into the pit). `npm run game:sounds` makes them with ElevenLabs
  (scripts/game-sounds.mjs).
- `voice`: Judy's lines (the ticket lady on the plaza), one MP3 per line id
  in `judy.json`. `npm run game:judy` makes them with ElevenLabs
  (scripts/game-judy.mjs); without them she is subtitles only. Edit her
  words in `judy.json` and run the script again with `-- --all`.
- `models`: GLB props by name (`seat`, `plant`, `popcorn`, `judy`).
  A named prop replaces the blocky placeholder the game draws for it.
  `npm run game:props` makes them with OpenAI and Meshy (scripts/game-props.mjs).

Keep each file under about 25 MB; bigger ones belong in the documents bucket.
