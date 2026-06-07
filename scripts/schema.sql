CREATE TABLE IF NOT EXISTS scrobbles (
  id          BIGSERIAL PRIMARY KEY,
  track_name  TEXT NOT NULL,
  artist_name TEXT NOT NULL,
  album_name  TEXT,
  played_at   TIMESTAMPTZ NOT NULL,
  date        DATE NOT NULL,
  season      TEXT NOT NULL,
  season_year TEXT NOT NULL,
  UNIQUE (track_name, artist_name, played_at)
);

CREATE INDEX IF NOT EXISTS idx_scrobbles_season_year ON scrobbles (season_year);
CREATE INDEX IF NOT EXISTS idx_scrobbles_date ON scrobbles (date);
