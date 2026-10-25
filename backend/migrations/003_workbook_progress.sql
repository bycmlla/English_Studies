-- 003_workbook_progress.sql
-- Passa a acompanhar separadamente o Student's Book e o Workbook de cada unidade.
--
-- Migração compatível com os dados existentes: todo registro que já existe em
-- unit_progress era o progresso do Student's Book, então a nova coluna recebe
-- 'student_book' por padrão. Nenhuma linha é apagada ou alterada.

ALTER TABLE unit_progress
  ADD COLUMN book_type VARCHAR(20) NOT NULL DEFAULT 'student_book';

ALTER TABLE unit_progress
  ADD CONSTRAINT unit_progress_book_type_check CHECK (book_type IN ('student_book', 'workbook'));

-- A chave passa a incluir o tipo: a mesma unidade pode ter um registro por material.
ALTER TABLE unit_progress DROP CONSTRAINT unit_progress_pkey;
ALTER TABLE unit_progress ADD PRIMARY KEY (user_id, unit_id, book_type);
