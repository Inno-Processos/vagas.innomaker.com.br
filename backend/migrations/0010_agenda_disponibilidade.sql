-- Agenda de horários no estilo "agenda de agendamentos" do Google Agenda:
-- título, descrição, disponibilidade semanal, período, intervalo entre entrevistas e antecedência mínima.

ALTER TABLE agendas ADD COLUMN titulo TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN intervalo_min INTEGER NOT NULL DEFAULT 0;        -- folga entre uma entrevista e outra
ALTER TABLE agendas ADD COLUMN antecedencia_horas INTEGER NOT NULL DEFAULT 12;  -- não mostra horários que começam antes disso
ALTER TABLE agendas ADD COLUMN disponibilidade TEXT NOT NULL DEFAULT '{}';      -- { "1": [["09:00","12:00"],["14:00","17:00"]], … } (0 = domingo)
ALTER TABLE agendas ADD COLUMN data_inicio TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN data_fim TEXT NOT NULL DEFAULT '';
ALTER TABLE agendas ADD COLUMN excluidos TEXT NOT NULL DEFAULT '[]';            -- horários da disponibilidade que o RH tirou à mão

-- 1 = criado à mão (fica mesmo se a disponibilidade mudar); 0 = gerado pela disponibilidade
ALTER TABLE agenda_horarios ADD COLUMN manual INTEGER NOT NULL DEFAULT 1;

UPDATE agendas SET titulo = etapa_nome WHERE titulo = '';
