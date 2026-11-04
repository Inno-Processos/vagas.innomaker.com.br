# Planilha de Registros — preenchimento automático na admissão

Quando o RH clica em **Aprovar cadastro** numa admissão, o sistema:

1. pergunta à planilha qual é a **próxima matrícula** (maior número da coluna A da aba *Registros* + 1) — assim
   a matrícula do sistema, dos documentos e do e-mail é a mesma da planilha;
2. cria o funcionário e os documentos com essa matrícula;
3. envia a linha do funcionário para a aba *Registros* (64 colunas, na ordem da planilha);
4. a planilha roda o `main()` dela (pasta no Drive, Programação Semanal, Planilha Individual, formatação).

Se a planilha não responder no passo 1, **nada é gravado** e o RH vê o motivo (tente de novo). Se falhar no passo 3,
a admissão fica aprovada e a tela do funcionário mostra **Planilha de Registros: Falhou**, com o motivo e o botão
**Enviar para a planilha**. Reenviar só completa células vazias: nada que já está na planilha é apagado.

Planilha: https://docs.google.com/spreadsheets/d/1_gZ9iK6feO4mrlGL6ZwP2b7LyiS8MSZeYO-FvMiQTHY

## Configurar (uma vez)

**1. Colar o script na planilha**

1. Abra a planilha → **Extensões → Apps Script**.
2. Clique em **+ → Script**, dê o nome `VagasIntegracao` e cole todo o conteúdo de [planilha-registros.gs](planilha-registros.gs).
3. No arquivo antigo, **apague a função `doPost`** (a que chama `processarRegistroAprovado_`). O `doPost` novo já faz o que
   ela fazia para pedidos que não vêm do sistema de vagas. Não pode haver dois `doPost`.
4. Salve (Ctrl+S).

**2. Gerar o token**

1. No editor, escolha a função **`vagasGerarToken`** na barra de cima e clique em **Executar** (autorize na primeira vez).
2. Abra **Registro de execução**: aparece `VAGAS_TOKEN = …`. Copie esse valor.

**3. Publicar como app da Web**

1. **Implantar → Nova implantação → tipo: App da Web**.
2. *Executar como:* **Eu** (a conta dona da planilha). *Quem pode acessar:* **Qualquer pessoa**.
   (O acesso é protegido pelo token: sem ele o script recusa tudo.)
3. Clique em **Implantar**, autorize o acesso ao Drive e à planilha e copie a **URL do app da Web** (termina em `/exec`).

> Se depois você mudar o script, use **Implantar → Gerenciar implantações → editar → Nova versão**,
> para a URL continuar a mesma.

**4. Configurar o backend**

No servidor, em `~/apps/vagas/backend/.env`:

```
PLANILHA_REGISTROS_URL=https://script.google.com/macros/s/…/exec
PLANILHA_REGISTROS_TOKEN=o valor de VAGAS_TOKEN
```

e reinicie: `cd ~/apps/vagas && docker compose up -d`.

**5. Testar**

Painel → **Configurações → Planilha de Registros → Testar planilha**. Deve aparecer
"Conectado à aba Registros: N registro(s). Próxima matrícula: X."

## O que vai em cada coluna

| Coluna | Vem de |
|---|---|
| Matricula | próxima da planilha (passo 1) |
| Situação, Função, Departamento, Setor, Horário de trabalho, Auxílio, Bolsa - Valor, Responsável, Entidade Vinculada | proposta enviada ao candidato |
| Nome Completo, Sexo, Data Nascimento, Mês de aniversário, Idade, CPF, RG, CNH, CTPS, Telefone, E-mail, CEP, Endereço, Bairro, Cidade, Estado | cadastro do candidato |
| Data da matrícula* | dia da aprovação |
| Data Inicial / Final Bolsa, Data de Efetivação, Data Final Contrato | data de início da proposta e fim (ou início + 1 ano) |
| Currículo lattes, Grau de instrução, Área de Formação, Instituição de ensino, CR, Matrícula - UFF, Email innomaker, Nº do PIX, Banco do pix | cadastro do candidato |
| Termo de Compromisso, Direito de Imagem | link do documento gerado no sistema (se foi gerado) |
| Principais funções | vaga |
| Observação do Funcionário | "Admitido pelo sistema de vagas (ADM-…)" e o tipo de contratação |
| DRIVE, Planilha de Horário, Planilha de Registro | criadas pelo `main()` da planilha |
| Bolsa - Innomaker, SALÁRIO BRUTO | calculadas pela planilha (`somarAAeAFSeAGVazio`) |
| ORGÃO EXP/UF (RG, CNH, CTPS), Observação do Salário, Foto, Aumento, Mudança da Forma de Pagamento, Divisão Salário, Resumo, employeeIdChronos, Data do Último termo assinado | ficam vazias (o sistema não coleta); preencha na planilha |

Se as colunas da aba mudarem de ordem, ajuste `COLUNAS` em `backend/src/lib/planilha.js`.
