-- 006_courses.sql
-- Tela "Meus Estudos": catálogo de cursos e estrutura genérica de módulos/aulas.
--
-- Migração aditiva: só cria tabelas novas. Nada do My English Journey (books, units,
-- unit_progress, study_topics ...) é alterado, então todo progresso já salvo continua igual.
--
-- courses é o catálogo (igual para todos os usuários); o progresso de cada usuário fica em
-- tabelas com user_id. Novos cursos entram com um INSERT em courses (ou uma nova migration).
--   kind = 'english_journey': progresso vem das tabelas de livros já existentes.
--   kind = 'lessons':         progresso = aulas concluídas / total de aulas (módulos → aulas).
--
-- Os módulos e aulas do Make 10 Hundred ainda não foram fornecidos e NÃO são cadastrados aqui:
-- sem aulas, o curso aparece como "Não iniciado" (0%).

CREATE TABLE courses (
  id          SMALLINT     PRIMARY KEY,
  slug        VARCHAR(40)  NOT NULL UNIQUE,
  title       VARCHAR(80)  NOT NULL,
  description VARCHAR(200) NOT NULL,
  kind        VARCHAR(20)  NOT NULL CHECK (kind IN ('english_journey', 'lessons')),
  position    SMALLINT     NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE course_modules (
  id        SERIAL       PRIMARY KEY,
  course_id SMALLINT     NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  position  SMALLINT     NOT NULL CHECK (position >= 1),
  title     VARCHAR(160) NOT NULL,
  CONSTRAINT course_modules_position_unique UNIQUE (course_id, position)
);

CREATE TABLE course_lessons (
  id        SERIAL       PRIMARY KEY,
  module_id INTEGER      NOT NULL REFERENCES course_modules (id) ON DELETE CASCADE,
  position  SMALLINT     NOT NULL CHECK (position >= 1),
  title     VARCHAR(200) NOT NULL,
  CONSTRAINT course_lessons_position_unique UNIQUE (module_id, position)
);

CREATE TABLE course_lesson_progress (
  user_id      INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  lesson_id    INTEGER     NOT NULL REFERENCES course_lessons (id) ON DELETE CASCADE,
  completed    BOOLEAN     NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

INSERT INTO courses (id, slug, title, description, kind, position) VALUES
  (1, 'english-journey', 'My English Journey', 'Estudo de Inglês com os livros Cambridge', 'english_journey', 1),
  (2, 'make-10-hundred', 'Make 10 Hundred', 'Curso de Maquiagem Profissional', 'lessons', 2)
ON CONFLICT (id) DO NOTHING;
