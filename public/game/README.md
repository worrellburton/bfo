# The signing game's assets

Everything in this folder is served as-is at the same path (`/game/...`).
`manifest.json` tells the game (app/sign/game) what's here:

- `movie`: the file that plays on the theater screen. When null, the YouTube
  video named by `youtube` is embedded on the screen instead.
- `music`: plays from the start, fades out as the signer walks into the
  auditorium, and comes back for the climb up the staircase at the end.
- `sounds`: short effects, each null until a file is dropped in: `door`
  (the exit door opening), `sit`, `sign` (the pen), `jump`, `land`, `fall`
  (into the pit). `npm run game:sounds` makes them with ElevenLabs
  (scripts/game-sounds.mjs).
- `voice`: Judy's lines (the ticket lady on the plaza), one MP3 per line id
  in `judy.json`. `npm run game:judy` makes them with ElevenLabs
  (scripts/game-judy.mjs); without them she is subtitles only. Edit her
  words in `judy.json` and run the script again with `-- --all`.
- `models`: GLB props by name (`seat`, `plant`, `popcorn`).
  A named prop replaces the blocky placeholder the game draws for it.
  `npm run game:props` makes them with OpenAI and Meshy (scripts/game-props.mjs).

Keep each file under about 25 MB; bigger ones belong in the documents bucket.
