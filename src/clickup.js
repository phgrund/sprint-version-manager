const BASE = 'https://api.clickup.com/api/v2';

function client(token) {
  if (!token) throw new Error('CLICKUP_TOKEN não definido');
  return async function request(path, { method = 'GET', body, query } = {}) {
    const url = new URL(BASE + path);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k + '[]', x));
      else url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ClickUp ${method} ${path} ${res.status}: ${text}`);
    }
    if (res.status === 204) return null;
    return res.json();
  };
}

export function createClickUp(token) {
  const req = client(token);

  return {
    async listFolders(spaceId) {
      const data = await req(`/space/${spaceId}/folder`, { query: { archived: false } });
      return data.folders ?? [];
    },

    async listListsInFolder(folderId) {
      const data = await req(`/folder/${folderId}/list`, { query: { archived: false } });
      return data.lists ?? [];
    },

    async listTasksInList(listId) {
      const all = [];
      let page = 0;
      while (true) {
        const data = await req(`/list/${listId}/task`, {
          query: {
            archived: false,
            include_closed: true,
            subtasks: true,
            page,
          },
        });
        const tasks = data.tasks ?? [];
        all.push(...tasks);
        if (tasks.length < 100) break;
        page += 1;
      }
      return all;
    },

    async getListViews(listId) {
      const data = await req(`/list/${listId}/view`);
      return data.views ?? [];
    },

    async listTasksInView(viewId) {
      const all = [];
      let page = 0;
      while (true) {
        const data = await req(`/view/${viewId}/task`, { query: { page } });
        const tasks = data.tasks ?? [];
        all.push(...tasks);
        if (data.last_page || tasks.length < 30) break;
        page += 1;
      }
      return all;
    },

    async listTasksVisibleInList(listId) {
      const views = await this.getListViews(listId);
      // ClickUp default list view is usually the first "list" type view
      const view =
        views.find((v) => v.type === 'list') ?? views[0];
      if (!view) return [];
      return this.listTasksInView(view.id);
    },

    async listAccessibleCustomFields(listId) {
      const data = await req(`/list/${listId}/field`);
      return data.fields ?? [];
    },

    async setCustomField(taskId, fieldId, value) {
      return req(`/task/${taskId}/field/${fieldId}`, {
        method: 'POST',
        body: { value },
      });
    },

    async removeCustomField(taskId, fieldId) {
      return req(`/task/${taskId}/field/${fieldId}`, { method: 'DELETE' });
    },

    async getTaskComments(taskId) {
      const data = await req(`/task/${taskId}/comment`);
      return data.comments ?? [];
    },

    async getTask(taskId) {
      return req(`/task/${taskId}`);
    },
  };
}
