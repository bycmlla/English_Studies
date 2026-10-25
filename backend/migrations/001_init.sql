-- 001_init.sql
-- Esquema inicial do My English Journey.
-- Todo progresso, material e anotação pertence a um usuário (user_id), o que
-- mantém o modelo correto mesmo sendo uma aplicação de uso pessoal.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS books (
  id         SMALLINT PRIMARY KEY,
  slug       VARCHAR(40)  NOT NULL UNIQUE,
  title      VARCHAR(80)  NOT NULL,
  level      VARCHAR(10)  NOT NULL,
  color      VARCHAR(10)  NOT NULL CHECK (color IN ('yellow', 'red', 'blue', 'green')),
  position   SMALLINT     NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- O id da unidade é determinístico (livro * 100 + número): 101..116, 201..216 ...
CREATE TABLE IF NOT EXISTS units (
  id      INTEGER  PRIMARY KEY,
  book_id SMALLINT NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  number  SMALLINT NOT NULL CHECK (number BETWEEN 1 AND 16),
  CONSTRAINT units_book_number_unique UNIQUE (book_id, number),
  CONSTRAINT units_id_consistent CHECK (id = book_id * 100 + number)
);

CREATE TABLE IF NOT EXISTS unit_progress (
  user_id      INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  unit_id      INTEGER     NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  completed    BOOLEAN     NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, unit_id)
);

CREATE TABLE IF NOT EXISTS study_materials (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id    SMALLINT      NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  kind       VARCHAR(20)   NOT NULL CHECK (kind IN ('student_book', 'workbook', 'audio')),
  title      VARCHAR(120),
  url        VARCHAR(2048) NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS study_materials_user_book_idx
  ON study_materials (user_id, book_id);

CREATE TABLE IF NOT EXISTS book_notes (
  user_id    INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  book_id    SMALLINT    NOT NULL REFERENCES books (id) ON DELETE CASCADE,
  content    TEXT        NOT NULL DEFAULT '' CHECK (char_length(content) <= 20000),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, book_id)
);
