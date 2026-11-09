-- Bolsa Innomaker separada da outra bolsa (entidade vinculada) e salário bruto = soma das duas
ALTER TABLE funcionarios ADD COLUMN bolsa_innomaker TEXT NOT NULL DEFAULT '';
ALTER TABLE funcionarios ADD COLUMN salario_bruto TEXT NOT NULL DEFAULT '';
ALTER TABLE funcionarios ADD COLUMN data_inicial_bolsa TEXT NOT NULL DEFAULT '';
ALTER TABLE funcionarios ADD COLUMN data_final_bolsa TEXT NOT NULL DEFAULT '';
