ALTER TABLE board_aliases ADD COLUMN IF NOT EXISTS category TEXT;
CREATE INDEX IF NOT EXISTS idx_board_aliases_category ON board_aliases (category);
