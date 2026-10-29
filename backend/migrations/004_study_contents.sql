-- 004_study_contents.sql
-- Conteúdos de Estudo: assuntos de cada unidade e o progresso de estudo de cada usuário.
--
-- Migração aditiva: só cria tabelas novas e adiciona uma coluna opcional (title) em units.
-- unit_progress (Student's Book / Workbook) não é tocada, então o progresso dos livros
-- continua independente e nada do que já foi salvo é alterado ou apagado.

ALTER TABLE units ADD COLUMN title VARCHAR(120);

-- id do assunto = id da unidade * 100 + posição (ids estáveis, usados também nos backups).
CREATE TABLE study_topics (
  id       INTEGER      PRIMARY KEY,
  unit_id  INTEGER      NOT NULL REFERENCES units (id) ON DELETE CASCADE,
  category VARCHAR(20)  NOT NULL
    CHECK (category IN ('grammar', 'vocabulary', 'communication', 'listening', 'reading', 'writing', 'pronunciation')),
  position SMALLINT     NOT NULL CHECK (position BETWEEN 1 AND 99),
  title    VARCHAR(200) NOT NULL,
  CONSTRAINT study_topics_unit_position_unique UNIQUE (unit_id, position),
  CONSTRAINT study_topics_id_consistent CHECK (id = unit_id * 100 + position)
);

CREATE INDEX study_topics_unit_idx ON study_topics (unit_id);

CREATE TABLE study_topic_progress (
  user_id      INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  topic_id     INTEGER     NOT NULL REFERENCES study_topics (id) ON DELETE CASCADE,
  completed    BOOLEAN     NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_id)
);
