# sprint version manager

CLI interativa para fechar uma versão: marca o campo `versão` em tarefas de uma sprint do ClickUp e troca o base branch de PRs do GitHub para `release/{versão}`.

## Setup

```bash
cp .env.example .env   # preencha CLICKUP_TOKEN, CLICKUP_SPRINTS_FOLDER_ID, GITHUB_TOKEN, GITHUB_RELEASE_REPOS
yarn install
yarn start
```

## Fluxo

1. Informa a versão (ex.: `1.60`, formato `MAJOR.MINOR`). Verifica em cada repo de `GITHUB_RELEASE_REPOS` se a branch `release/{versão}` existe; se não, oferece criá-la a partir de `develop`.
2. Escolha interativa das sprints (a em andamento vem pré-marcada).
3. Resolve a opção `versão` no dropdown do ClickUp (a opção deve já existir lá).
4. Lista todos os stories (tag `story`/`ajuste previsto`, com `versão` vazia ou já igual), **sem filtro por status**. A seleção é feita status por status, acumulando o que entra na versão.
5. Aplica/limpa o campo `versão` conforme a seleção.
6. Para as selecionadas em `code review`/`validated code`, extrai PRs do GitHub citadas nos comentários (apenas abertas, não draft/merged).
7. Você escolhe quais PRs ter base alterado para `release/{versão}`. Se a branch não existe, oferece criar a partir de `develop`.
