// site/ui/credential-form.js
// 职责：凭证表单渲染 + 读取
// 无状态视图

export function render(container) {
  container.innerHTML = `
    <div class="fg">
      <label>Gossip 加密密钥 <span class="hint">(留空自动生成，永不离开浏览器)</span></label>
      <input type="password" id="cfg-gossip-key" placeholder="留空自动生成 32 字节随机密钥">
    </div>
    <div class="fg">
      <label>GitHub PAT <span class="hint">(Contents: Read & Write)</span></label>
      <input type="password" id="cfg-github-pat" placeholder="ghp_... 或 github_pat_...">
    </div>
    <div class="fg">
      <label>仓库</label>
      <input type="text" id="cfg-repo" value="k3s-forge/nomad-gitops" placeholder="owner/repo">
    </div>
    <div class="fg">
      <label>分支</label>
      <input type="text" id="cfg-branch" value="main" placeholder="main">
    </div>
    <div class="fg">
      <label>Nomad API <span class="hint">(种子机 Nginx 反代端口)</span></label>
      <input type="text" id="cfg-nomad-url" placeholder="http://<seed-ip>:4647">
    </div>`;
}

export function getValues() {
  return {
    gossipKey:  document.getElementById('cfg-gossip-key')?.value.trim() || '',
    githubPat:  document.getElementById('cfg-github-pat')?.value.trim() || '',
    repo:       document.getElementById('cfg-repo')?.value.trim() || 'k3s-forge/nomad-gitops',
    branch:     document.getElementById('cfg-branch')?.value.trim() || 'main',
    nomadUrl:   document.getElementById('cfg-nomad-url')?.value.trim() || '',
  };
}
