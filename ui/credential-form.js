// site/ui/credential-form.js
// 职责：凭证表单渲染 + 读取
// 无状态视图

import { t } from '../lib/i18n.js';

export function render(container) {
  container.innerHTML = `
    <div class="fg">
      <label>${t('bs.gossip.label')} <span class="hint">(${t('bs.gossip.hint')})</span></label>
      <input type="password" id="cfg-gossip-key" placeholder="${t('bs.gossip.hint')}">
    </div>
    <div class="fg">
      <label>${t('bs.github.label')} <span class="hint">(${t('bs.github.hint')})</span></label>
      <input type="password" id="cfg-github-pat" placeholder="ghp_... 或 github_pat_...">
    </div>
    <div class="fg">
      <label>${t('bs.repo.label')}</label>
      <input type="text" id="cfg-repo" value="k3s-forge/nomad-gitops" placeholder="owner/repo">
    </div>
    <div class="fg">
      <label>${t('bs.branch.label')}</label>
      <input type="text" id="cfg-branch" value="main" placeholder="main">
    </div>`;
}

export function getValues() {
  return {
    gossipKey:  document.getElementById('cfg-gossip-key')?.value.trim() || '',
    githubPat:  document.getElementById('cfg-github-pat')?.value.trim() || '',
    repo:       document.getElementById('cfg-repo')?.value.trim() || 'k3s-forge/nomad-gitops',
    branch:     document.getElementById('cfg-branch')?.value.trim() || 'main',
  };
}
