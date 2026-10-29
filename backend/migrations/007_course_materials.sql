-- 007_course_materials.sql
-- Materiais de Estudo: links de apoio (vídeos, áudios, materiais complementares ...) de cada
-- curso, cadastrados pelo próprio usuário pela interface.
--
-- Migração aditiva: só cria tabelas novas. A tabela antiga study_materials ("Important links"
-- dentro de cada livro), o progresso de livros/estudo e todo o resto continuam intactos.
--
-- Nenhum material é cadastrado aqui: os links são do usuário. Só as 4 categorias padrão
-- (iguais para todos) são criadas.

-- Categorias. user_id NULL = padrão do sistema (valem para todos os cursos e usuários, não
-- podem ser editadas); com user_id = categoria personalizada de um usuário em um curso.
CREATE TABLE material_categories (
  id         SERIAL      PRIMARY KEY,
  user_id    INTEGER     REFERENCES users (id) ON DELETE CASCADE,
  course_id  SMALLINT    REFERENCES courses (id) ON DELETE CASCADE,
  name       VARCHAR(60) NOT NULL,
  position   SMALLINT    NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT material_categories_scope_check CHECK ((user_id IS NULL) = (course_id IS NULL)),
  CONSTRAINT material_categories_unique UNIQUE (user_id, course_id, name)
);

CREATE INDEX material_categories_user_course_idx ON material_categories (user_id, course_id);

-- Materiais. book_id = nível (só no My English Journey: Intro, 1, 2, 3) e unit_number = Unit 1..16,
-- ambos opcionais no banco; a API exige o nível nos cursos que têm níveis.
CREATE TABLE course_materials (
  id          SERIAL        PRIMARY KEY,
  user_id     INTEGER       NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  course_id   SMALLINT      NOT NULL REFERENCES courses (id) ON DELETE CASCADE,
  book_id     SMALLINT      REFERENCES books (id) ON DELETE CASCADE,
  unit_number SMALLINT      CHECK (unit_number BETWEEN 1 AND 16),
  category_id INTEGER       NOT NULL REFERENCES material_categories (id) ON DELETE RESTRICT,
  title       VARCHAR(160)  NOT NULL,
  url         VARCHAR(2048) NOT NULL,
  description VARCHAR(500),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  CONSTRAINT course_materials_unit_needs_level CHECK (unit_number IS NULL OR book_id IS NOT NULL)
);

CREATE INDEX course_materials_user_course_idx ON course_materials (user_id, course_id);

INSERT INTO material_categories (name, position) VALUES
  ('Vídeos', 1),
  ('Áudios', 2),
  ('Materiais complementares', 3),
  ('Links úteis', 4);
