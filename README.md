# sprint version manager

CLI interativa para fechar uma versão: marca o campo `versão` em tarefas de uma sprint do ClickUp e troca o base branch de PRs do GitHub para `release/{versão}`.

## Setup

```bash
cp .env.example .env   # preencha CLICKUP_TOKEN, CLICKUP_TEAM_ID, CLICKUP_SPACE_ID, GITHUB_TOKEN
npm install
npm start
```

## Fluxo

1. Escolha interativa da pasta de sprint (filtro por nome).
2. Lista tarefas com tag `story`, sem `versão`, em status: `completed`, `testing`, `validated code`, `code review`.
3. Você desmarca o que não entra na versão.
4. Informa a versão (ex.: `1.42.0`) — opção deve já existir no dropdown `versão` do ClickUp.
5. Para as selecionadas em `code review`/`validated code`, extrai PRs do GitHub citadas nos comentários (apenas abertas, não draft/merged).
6. Você escolhe quais PRs ter base alterado para `release/{versão}`. Se a branch não existe, oferece criar a partir da default.
