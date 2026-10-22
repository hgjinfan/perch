import { notifyConfigChange } from '../core/config-events.js';
import { requestJson, readConfigVersion } from '../core/api.js';
import { node } from '../core/dom.js';
const MAX_BYTES = 1024 * 1024;
export function mountBackups(root, { onRestored = () => {} } = {}) {
  const file = root.querySelector('#backup-file'),
    history = root.querySelector('#backup-history'),
    status = root.querySelector('#backup-message'),
    summary = root.querySelector('#backup-summary'),
    confirm = root.querySelector('#backup-confirm'),
    restore = root.querySelector('#backup-restore'),
    refresh = root.querySelector('#backup-refresh');
  let pending,
    version,
    epoch = 0,
    busy = false,
    listing = false;
  function invalidate() {
    epoch++;
    pending = null;
    version = null;
    confirm.checked = false;
    confirm.disabled = true;
    restore.disabled = true;
    summary.hidden = true;
  }
  function say(message, error = false) {
    status.textContent = message;
    status.classList.toggle('error', error);
  }
  async function preview(read) {
    if (busy) return;
    invalidate();
    const current = epoch;
    say('正在检查备份…');
    try {
      const backup = await read();
      if (current !== epoch) return;
      let nextVersion;
      const info = await requestJson('/api/admin/backup/preview', {
        method: 'POST',
        body: backup,
        onResponse: (r) => (nextVersion = readConfigVersion(r)),
      });
      if (current !== epoch) return;
      pending = backup;
      version = nextVersion;
      summary.textContent = `首页「${info.title}」 · ${info.groups} 个分组 · ${info.services} 个服务 · ${info.feeds} 个订阅 · ${info.widgets} 个自定义磁块 · ${info.bookmarks} 个书签 · ${info.projects} 个项目`;
      summary.hidden = false;
      confirm.disabled = false;
      say('检查通过。确认后会替换已保存配置，并重新加载管理页；当前未保存的编辑也会被清除。');
    } catch (error) {
      if (current === epoch) say(error.message, true);
    }
  }
  file.onchange = () =>
    preview(async () => {
      const selected = file.files?.[0];
      if (!selected) throw new Error('请选择 JSON 备份文件');
      if (selected.size > MAX_BYTES) throw new Error('备份文件不能超过 1 MiB');
      try {
        return JSON.parse(await selected.text());
      } catch {
        throw new Error('文件不是有效的 JSON');
      }
    });
  confirm.onchange = () => (restore.disabled = busy || !pending || !confirm.checked);
  restore.onclick = async () => {
    if (busy || !pending || !confirm.checked) return;
    busy = true;
    restore.disabled = true;
    file.disabled = true;
    confirm.disabled = true;
    refresh.disabled = true;
    const backup = pending,
      expected = version;
    say('正在保存恢复前快照并恢复配置…');
    try {
      await requestJson('/api/admin/backup/restore', {
        method: 'POST',
        body: backup,
        headers: { 'If-Match': expected },
      });
      say('恢复完成，正在重新加载…');
      notifyConfigChange();
      onRestored();
      window.location.reload();
    } catch (error) {
      busy = false;
      file.disabled = false;
      refresh.disabled = false;
      invalidate();
      say(
        error.status === 409
          ? '配置已被其他页面修改，请重新选择备份、检查后再恢复。'
          : `${error.message}。请刷新确认当前配置后重试。`,
        true,
      );
      loadHistory();
    }
  };
  async function loadHistory() {
    if (listing || busy) return;
    listing = true;
    refresh.disabled = true;
    try {
      const items = await requestJson('/api/admin/backups');
      history.replaceChildren();
      if (!items.length)
        history.append(node('p', '还没有配置历史；保存修改或恢复配置前会自动记录上一版。'));
      for (const item of items) {
        const row = node('div');
        row.className = 'backup-history-row';
        row.append(
          node(
            'span',
            `${new Date(item.createdAt).toLocaleString('zh-CN')} · ${item.reason === 'save' ? '保存前' : '恢复前'} · ${item.title}`,
          ),
        );
        const select = node('button', '检查并恢复');
        select.type = 'button';
        select.onclick = () =>
          preview(() => requestJson(`/api/admin/backups/${encodeURIComponent(item.id)}`));
        const download = node('a', '下载');
        download.href = `/api/admin/backups/${encodeURIComponent(item.id)}`;
        download.download = `perch-recovery-${item.id}`;
        row.append(select, download);
        history.append(row);
      }
    } catch (error) {
      history.textContent = `读取配置历史失败：${error.message}`;
    } finally {
      listing = false;
      refresh.disabled = busy;
    }
  }
  refresh.onclick = loadHistory;
  invalidate();
  loadHistory();
}
