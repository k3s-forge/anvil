// site/lib/github-client.js
// 职责：GitHub API 封装 —— 推送文件 + 轮询 CI
// 输入：token, repo, branch, files / commitSha
// 输出：pushResult / ciResult
// 副作用：fetch（网络）

const API = 'https://api.github.com';

async function gh(token, method, path, body) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'anvil/1.0',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${data.message}`);
  return data;
}

// 推送文件到仓库（Git Data API: Blob → Tree → Commit → Ref）
export async function pushFiles(token, repo, branch, files, message) {
  // 1. HEAD
  const ref = await gh(token, 'GET', `/repos/${repo}/git/ref/heads/${branch}`);

  // 2. Blobs
  const blobs = [];
  for (const f of files) {
    const blob = await gh(token, 'POST', `/repos/${repo}/git/blobs`, {
      content: f.content,
      encoding: 'utf-8',
    });
    blobs.push({ path: f.path, sha: blob.sha, mode: f.mode || '100644' });
  }

  // 3. Tree
  const tree = await gh(token, 'POST', `/repos/${repo}/git/trees`, {
    base_tree: ref.object.sha,
    tree: blobs.map(b => ({ path: b.path, mode: b.mode, type: 'blob', sha: b.sha })),
  });

  // 4. Commit
  const commit = await gh(token, 'POST', `/repos/${repo}/git/commits`, {
    message,
    tree: tree.sha,
    parents: [ref.object.sha],
  });

  // 5. Ref
  await gh(token, 'PATCH', `/repos/${repo}/git/refs/heads/${branch}`, {
    sha: commit.sha,
    force: false,
  });

  return { sha: commit.sha, url: commit.html_url };
}

// 轮询 CI 直到完成
export async function pollCI(token, repo, sha, timeoutMs = 300000) {
  const start = Date.now();
  let attempt = 0;

  while (Date.now() - start < timeoutMs) {
    attempt++;
    // Use Actions API (not check-runs which requires Checks API)
    const data = await gh(token, 'GET', `/repos/${repo}/actions/runs?head_sha=${sha}&per_page=5`);
    const runs = data.workflow_runs || [];

    if (runs.length === 0) {
      await sleep(3000);
      continue;
    }

    const completed = runs.filter(r => r.status === 'completed');
    if (completed.length === runs.length) {
      const failed = completed.filter(r => r.conclusion !== 'success');
      return {
        done: true,
        success: failed.length === 0,
        runs: completed,
        attempts: attempt,
      };
    }

    const running = runs.filter(r => r.status !== 'completed');
    const names = running.map(r => r.name).join(', ');
    console.log(`CI polling #${attempt}: ${names} still running`);
    await sleep(8000);
  }

  throw new Error(`CI poll timeout (${timeoutMs / 1000}s)`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
