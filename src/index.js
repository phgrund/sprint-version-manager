#!/usr/bin/env node
import 'dotenv/config';
import { checkbox, input, confirm } from '@inquirer/prompts';
import pLimit from 'p-limit';
import { createClickUp } from './clickup.js';
import { createGitHub } from './github.js';

const PR_SKIP_STATUSES = new Set(['testing', 'completed']);
const ACCEPTED_TAGS = new Set(['📝 story', '🔧 ajuste previsto']);
const VERSION_FIELD_NAME = '🚀 versão';
const PR_REGEX = /(?:https?:\/\/)?github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/gi;

function normStatus(s) {
  return (s ?? '').toString().trim().toLowerCase();
}

function colorize(text, hex) {
  if (!hex) return text;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return text;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function findVersionField(task) {
  return (task.custom_fields ?? []).find(
    (f) => (f.name ?? '').toLowerCase() === VERSION_FIELD_NAME,
  );
}

function isVersionEmpty(field) {
  if (!field) return true;
  const v = field.value;
  if (v === undefined || v === null) return true;
  if (Array.isArray(v) && v.length === 0) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

function versionMatches(field, option) {
  if (!field) return false;
  const v = field.value;
  if (v === undefined || v === null) return false;
  const candidates = [option.id, option.orderindex, String(option.orderindex)];
  if (typeof v === 'object' && v !== null) {
    return candidates.includes(v.id) || candidates.includes(v.orderindex);
  }
  return candidates.includes(v);
}

function hasAcceptedTag(task) {
  return (task.tags ?? []).some((t) => ACCEPTED_TAGS.has((t.name ?? '').toLowerCase()));
}

function sortSprintListsDesc(lists) {
  return [...lists]
    .map((l) => {
      const m = (l.name ?? '').match(/Sprint\s+(\d+)/i);
      return { l, n: m ? parseInt(m[1], 10) : -1 };
    })
    .sort((a, b) => b.n - a.n)
    .map((x) => x.l);
}

function findCurrentSprintListId(lists) {
  const today = new Date().toISOString().slice(0, 10);
  for (const l of lists) {
    const range = (l.name ?? '').match(/(\d{4}-\d{2}-\d{2})\s*[-–]\s*(\d{4}-\d{2}-\d{2})/);
    if (range && today >= range[1] && today <= range[2]) return l.id;
  }
  return null;
}

async function main() {
  const {
    CLICKUP_TOKEN,
    CLICKUP_SPRINTS_FOLDER_ID,
    GITHUB_TOKEN,
    GITHUB_RELEASE_REPOS,
  } = process.env;

  if (!CLICKUP_TOKEN || !CLICKUP_SPRINTS_FOLDER_ID || !GITHUB_TOKEN) {
    console.error('Faltam variáveis: CLICKUP_TOKEN, CLICKUP_SPRINTS_FOLDER_ID, GITHUB_TOKEN.');
    process.exit(1);
  }

  const releaseRepos = (GITHUB_RELEASE_REPOS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const cu = createClickUp(CLICKUP_TOKEN);
  const gh = createGitHub(GITHUB_TOKEN);
  const limit = pLimit(5);

  // Etapa 0 — versão (perguntada logo no início) + garantir branch release/X.Y
  const version = await input({
    message: 'Versão (ex.: 1.60):',
    validate: (v) => /^\d+\.\d+$/.test(v.trim()) || 'Use formato MAJOR.MINOR (ex.: 1.60)',
  });
  const versionTrim = version.trim();
  const releaseBranch = `release/${versionTrim}`;

  if (!releaseRepos.length) {
    console.log('GITHUB_RELEASE_REPOS não definido — pulando verificação da branch de release.');
  } else {
    console.log(`\nVerificando branch "${releaseBranch}" nos repos de release...`);
    for (const key of releaseRepos) {
      const [owner, repo] = key.split('/');
      if (!owner || !repo) {
        console.log(`  ⚠ entrada inválida em GITHUB_RELEASE_REPOS: "${key}" (use owner/repo)`);
        continue;
      }
      try {
        if (await gh.branchExists(owner, repo, releaseBranch)) {
          console.log(`  ✓ ${key}: ${releaseBranch} já existe`);
          continue;
        }
      } catch (err) {
        console.log(`  ✗ ${key}: falha ao verificar branch — ${err.message}`);
        continue;
      }
      const create = await confirm({
        message: `Branch "${releaseBranch}" não existe em ${key}. Criar a partir de develop?`,
        default: true,
      });
      if (!create) continue;
      try {
        const sha = await gh.getBranchSha(owner, repo, 'develop');
        await gh.createBranch(owner, repo, releaseBranch, sha);
        console.log(`  criada ${releaseBranch} em ${key} a partir de develop`);
      } catch (err) {
        console.log(`  ✗ ${key}: falha ao criar branch — ${err.message}`);
      }
    }
  }

  // Etapa 1 — escolher sprint(s) = list(s) da pasta Sprints
  console.log('Carregando sprints...');
  const sprintLists = sortSprintListsDesc(
    await cu.listListsInFolder(CLICKUP_SPRINTS_FOLDER_ID),
  );
  if (!sprintLists.length) {
    console.error('Nenhuma sprint encontrada na pasta.');
    process.exit(1);
  }
  const currentSprintId = findCurrentSprintListId(sprintLists);
  const defaultSprintId = currentSprintId ?? sprintLists[0].id;

  const selectedSprintListIds = await checkbox({
    message: 'Sprints (em andamento vem pré-marcada):',
    pageSize: 20,
    required: true,
    choices: sprintLists.map((l) => ({
      name: l.name,
      value: l.id,
      checked: l.id === defaultSprintId,
    })),
  });

  // Etapa 2 — resolver opção do dropdown da versão (já informada na Etapa 0)
  const fields = await cu.listAccessibleCustomFields(selectedSprintListIds[0]);
  const versionField = fields.find(
    (f) => (f.name ?? '').toLowerCase() === VERSION_FIELD_NAME,
  );
  if (!versionField) {
    console.error(`Campo "${VERSION_FIELD_NAME}" não encontrado na list.`);
    process.exit(1);
  }
  const options = versionField.type_config?.options ?? [];
  const option = options.find((o) => (o.name ?? '').trim() === versionTrim);
  if (!option) {
    console.error(
      `Opção "${versionTrim}" não existe no dropdown "${VERSION_FIELD_NAME}". ` +
        `Crie a opção no ClickUp e rode novamente.`,
    );
    process.exit(1);
  }

  // Etapa 3 — buscar tarefas das sprints selecionadas (via view da list,
  // que inclui tarefas adicionadas pelo "Add to List")
  console.log(`Carregando tarefas de ${selectedSprintListIds.length} sprint(s)...`);
  const tasksBySprint = await Promise.all(
    selectedSprintListIds.map((id) => limit(() => cu.listTasksVisibleInList(id))),
  );
  // Dedup por id (tarefa pode estar em mais de uma sprint via Add to List)
  const tasksById = new Map();
  for (const arr of tasksBySprint) for (const t of arr) tasksById.set(t.id, t);
  const allTasks = [...tasksById.values()];

  // Sem filtro por status: todo story (com tag aceita e versão vazia ou já igual)
  // é candidato, independente do status.
  const candidates = allTasks.filter((t) => {
    if (!hasAcceptedTag(t)) return false;
    const vf = findVersionField(t);
    if (!isVersionEmpty(vf) && !versionMatches(vf, option)) return false;
    return true;
  });

  if (!candidates.length) {
    console.log('Nenhuma tarefa candidata encontrada.');
    return;
  }

  // Etapa 3 — agrupar por status (todos os status presentes, ordenados pelo
  // orderindex do status) e selecionar status por status, acumulando.
  const statusMeta = new Map(); // normStatus -> { color, orderindex }
  for (const t of candidates) {
    const s = normStatus(t.status?.status);
    if (!statusMeta.has(s)) {
      statusMeta.set(s, {
        color: t.status?.color,
        orderindex: Number(t.status?.orderindex ?? Number.MAX_SAFE_INTEGER),
      });
    }
  }
  const orderedStatuses = [...statusMeta.keys()].sort(
    (a, b) => statusMeta.get(a).orderindex - statusMeta.get(b).orderindex,
  );

  const grouped = new Map(orderedStatuses.map((s) => [s, []]));
  for (const t of candidates) grouped.get(normStatus(t.status.status)).push(t);

  console.log('\nResumo por status:');
  for (const s of orderedStatuses) {
    console.log(`  [${colorize(s, statusMeta.get(s).color)}] ${grouped.get(s).length}`);
  }
  console.log('');

  const orderedTasks = orderedStatuses.flatMap((s) => grouped.get(s));
  const selectedIds = [];
  for (const s of orderedStatuses) {
    const arr = grouped.get(s);
    const picked = await checkbox({
      message: `[${colorize(s, statusMeta.get(s).color)}] (${arr.length}) — quais entram na versão ${versionTrim}?`,
      pageSize: 20,
      choices: arr.map((t) => ({
        name: `${t.id} — ${t.name}`,
        value: t.id,
        checked: versionMatches(findVersionField(t), option),
      })),
    });
    selectedIds.push(...picked);
  }

  if (!selectedIds.length) {
    console.log('Nada selecionado. Abortando.');
    return;
  }
  const selectedSet = new Set(selectedIds);
  const selectedTasks = orderedTasks.filter((t) => selectedSet.has(t.id));

  // Diff:
  //  - selecionadas sem versão → SET
  //  - selecionadas com a versão correta → noop
  //  - não-selecionadas que tinham a versão → CLEAR
  //  - não-selecionadas que estavam vazias → noop
  const unselected = orderedTasks.filter((t) => !selectedSet.has(t.id));
  const toSet = selectedTasks.filter((t) => !versionMatches(findVersionField(t), option));
  const toClear = unselected.filter((t) => versionMatches(findVersionField(t), option));

  if (toSet.length) {
    console.log(`Aplicando versão ${versionTrim} em ${toSet.length} tarefa(s)...`);
    const setResults = await Promise.all(
      toSet.map((t) =>
        limit(async () => {
          try {
            await cu.setCustomField(t.id, versionField.id, option.id);
            return { t, ok: true };
          } catch (err) {
            return { t, ok: false, err };
          }
        }),
      ),
    );
    const setFailed = setResults.filter((r) => !r.ok);
    console.log(`  ✓ ${setResults.length - setFailed.length}   ✗ ${setFailed.length}`);
    for (const f of setFailed) console.log(`    falhou: ${f.t.id} — ${f.err.message}`);
  }

  if (toClear.length) {
    console.log(`Limpando versão de ${toClear.length} tarefa(s) desmarcada(s)...`);
    const clearResults = await Promise.all(
      toClear.map((t) =>
        limit(async () => {
          try {
            await cu.removeCustomField(t.id, versionField.id);
            return { t, ok: true };
          } catch (err) {
            return { t, ok: false, err };
          }
        }),
      ),
    );
    const clearFailed = clearResults.filter((r) => !r.ok);
    console.log(`  ✓ ${clearResults.length - clearFailed.length}   ✗ ${clearFailed.length}`);
    for (const f of clearFailed) console.log(`    falhou: ${f.t.id} — ${f.err.message}`);
  }

  if (!toSet.length && !toClear.length) {
    console.log('Nada a alterar — estado já corresponde à seleção.');
  }

  // Etapa 5 — extrair PRs dos comentários
  const prTasks = selectedTasks.filter((t) => !PR_SKIP_STATUSES.has(normStatus(t.status.status)));
  if (!prTasks.length) {
    console.log('Nenhuma tarefa fora de testing/completed. Concluído.');
    return;
  }

  // PRs costumam estar nas subtarefas das stories, não na story em si.
  // Para cada story, varremos a própria + todas as subtarefas.
  console.log(`\nColetando subtarefas de ${prTasks.length} tarefa(s)...`);
  const scanTargets = []; // { id, storyId }
  await Promise.all(
    prTasks.map((t) =>
      limit(async () => {
        scanTargets.push({ id: t.id, storyId: t.id });
        try {
          const subs = await cu.getTaskSubtasks(t.id);
          for (const st of subs) scanTargets.push({ id: st.id, storyId: t.id });
        } catch (err) {
          console.log(`  falhou subtarefas de ${t.id}: ${err.message}`);
        }
      }),
    ),
  );

  console.log(`Varrendo comentários de ${scanTargets.length} tarefa(s)/subtarefa(s) por PRs...`);
  const prRefs = new Map(); // key=owner/repo#n -> { owner, repo, number, taskIds:[] }
  await Promise.all(
    scanTargets.map(({ id, storyId }) =>
      limit(async () => {
        const comments = await cu.getTaskComments(id);
        const parts = [];
        for (const c of comments) {
          parts.push(c.comment_text ?? '');
          for (const block of c.comment ?? []) {
            if (block.text) parts.push(block.text);
            const link = block.attributes?.link;
            if (link) parts.push(link);
            const bmUrl = block.bookmark?.url ?? block.bookmark?.id;
            if (bmUrl) parts.push(bmUrl);
          }
        }
        const text = parts.join('\n');
        for (const m of text.matchAll(PR_REGEX)) {
          const [, owner, repo, num] = m;
          const repoClean = repo.replace(/\.git$/, '');
          const key = `${owner}/${repoClean}#${num}`;
          if (!prRefs.has(key)) {
            prRefs.set(key, {
              owner,
              repo: repoClean,
              number: parseInt(num, 10),
              taskIds: [],
            });
          }
          if (!prRefs.get(key).taskIds.includes(storyId)) {
            prRefs.get(key).taskIds.push(storyId);
          }
        }
      }),
    ),
  );

  if (!prRefs.size) {
    console.log('Nenhuma PR encontrada nos comentários.');
    return;
  }

  console.log(`Verificando estado de ${prRefs.size} PR(s) no GitHub...`);
  const prInfos = [];
  await Promise.all(
    [...prRefs.values()].map((ref) =>
      limit(async () => {
        try {
          const pr = await gh.getPR(ref.owner, ref.repo, ref.number);
          if (
            pr.state === 'open' &&
            !pr.merged &&
            !pr.draft &&
            pr.base.ref === 'develop'
          ) {
            prInfos.push({ ref, pr });
          }
        } catch (err) {
          console.log(`  falhou PR ${ref.owner}/${ref.repo}#${ref.number}: ${err.message}`);
        }
      }),
    ),
  );

  if (!prInfos.length) {
    console.log('Nenhuma PR ativa com base = develop (aberta, não draft, não merged).');
    return;
  }

  // Etapa 6 — selecionar PRs e trocar base
  const selectedPRKeys = await checkbox({
    message: `PRs para mudar base para "${releaseBranch}":`,
    pageSize: 20,
    choices: prInfos.map(({ ref, pr }) => ({
      name: `${ref.owner}/${ref.repo}#${ref.number} — ${pr.title} (base atual: ${pr.base.ref})`,
      value: `${ref.owner}/${ref.repo}#${ref.number}`,
      checked: true,
    })),
  });

  if (!selectedPRKeys.length) {
    console.log('Nenhuma PR selecionada. Concluído.');
    return;
  }

  const selectedPRSet = new Set(selectedPRKeys);
  const chosen = prInfos.filter(
    ({ ref }) => selectedPRSet.has(`${ref.owner}/${ref.repo}#${ref.number}`),
  );

  // Garantir branch release/X.Y.Z em cada repo
  const repoBranchOk = new Map(); // key=owner/repo -> bool
  const uniqueRepos = [...new Set(chosen.map(({ ref }) => `${ref.owner}/${ref.repo}`))];
  for (const key of uniqueRepos) {
    const [owner, repo] = key.split('/');
    const exists = await gh.branchExists(owner, repo, releaseBranch);
    if (exists) {
      repoBranchOk.set(key, true);
      continue;
    }
    const create = await confirm({
      message: `Branch "${releaseBranch}" não existe em ${key}. Criar a partir de develop?`,
      default: true,
    });
    if (!create) {
      repoBranchOk.set(key, false);
      continue;
    }
    try {
      const sha = await gh.getBranchSha(owner, repo, 'develop');
      await gh.createBranch(owner, repo, releaseBranch, sha);
      console.log(`  criada ${releaseBranch} em ${key} a partir de develop`);
      repoBranchOk.set(key, true);
    } catch (err) {
      console.log(`  falhou criar branch em ${key}: ${err.message}`);
      repoBranchOk.set(key, false);
    }
  }

  console.log(`\nAlterando base de ${chosen.length} PR(s)...`);
  const updateResults = await Promise.all(
    chosen.map(({ ref, pr }) =>
      limit(async () => {
        const repoKey = `${ref.owner}/${ref.repo}`;
        if (!repoBranchOk.get(repoKey)) {
          return { ref, ok: false, skipped: true, reason: 'branch ausente' };
        }
        if (pr.base.ref === releaseBranch) {
          return { ref, ok: true, noop: true };
        }
        try {
          await gh.updatePRBase(ref.owner, ref.repo, ref.number, releaseBranch);
          return { ref, ok: true };
        } catch (err) {
          return { ref, ok: false, err };
        }
      }),
    ),
  );

  console.log('\nResultado:');
  for (const r of updateResults) {
    const tag = `${r.ref.owner}/${r.ref.repo}#${r.ref.number}`;
    if (r.skipped) console.log(`  ⏭  ${tag} (${r.reason})`);
    else if (r.noop) console.log(`  =  ${tag} já em ${releaseBranch}`);
    else if (r.ok) console.log(`  ✓  ${tag}`);
    else console.log(`  ✗  ${tag} — ${r.err?.message ?? 'erro'}`);
  }
}

main().catch((err) => {
  console.error('\nErro:', err.message);
  process.exit(1);
});
