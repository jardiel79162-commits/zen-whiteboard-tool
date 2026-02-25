import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.replace(/\.git$/, "").match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new Error(`URL inválida: ${url}`);
  return { owner: match[1], repo: match[2] };
}

async function ghFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function mirrorRepo(
  sourceUrl: string,
  destUrl: string,
  sourceToken: string,
  destToken: string,
): Promise<string[]> {
  const logs: string[] = [];
  const log = (msg: string) => logs.push(msg);

  // 1. Validate source
  log("🔍 Validando repositório de origem...");
  const { owner: sOwner, repo: sRepo } = parseRepoUrl(sourceUrl);
  const sourceData = await ghFetch(`/repos/${sOwner}/${sRepo}`, sourceToken);
  const sBranch = sourceData.default_branch;
  log(`✅ Origem: ${sourceData.full_name} (branch: ${sBranch}, ${sourceData.private ? "privado" : "público"})`);

  // 2. Validate dest
  log("🔍 Validando repositório de destino...");
  const { owner: dOwner, repo: dRepo } = parseRepoUrl(destUrl);
  const destData = await ghFetch(`/repos/${dOwner}/${dRepo}`, destToken);
  const dBranch = destData.default_branch;
  log(`✅ Destino: ${destData.full_name} (branch: ${dBranch}, ${destData.private ? "privado" : "público"})`);

  // 3. Get all branches from source
  log("📋 Obtendo branches da origem...");
  const sourceBranches: any[] = [];
  let page = 1;
  while (true) {
    const branches = await ghFetch(`/repos/${sOwner}/${sRepo}/branches?per_page=100&page=${page}`, sourceToken);
    if (!branches || branches.length === 0) break;
    sourceBranches.push(...branches);
    if (branches.length < 100) break;
    page++;
  }
  log(`📋 ${sourceBranches.length} branch(es) encontrado(s)`);

  // 4. Get source tree for default branch
  log("📂 Obtendo árvore de arquivos da origem...");
  const tree = await ghFetch(`/repos/${sOwner}/${sRepo}/git/trees/${sBranch}?recursive=1`, sourceToken);
  const blobs = tree.tree.filter((e: any) => e.type === "blob");
  log(`📂 ${blobs.length} arquivo(s) encontrado(s)`);

  // 5. Clean dest - create empty tree and force commit
  log("🗑️ Limpando repositório de destino...");
  const destRef = await ghFetch(`/repos/${dOwner}/${dRepo}/git/ref/heads/${dBranch}`, destToken);

  const emptyTree = await ghFetch(`/repos/${dOwner}/${dRepo}/git/trees`, destToken, {
    method: "POST",
    body: JSON.stringify({ tree: [] }),
  });

  const emptyCommit = await ghFetch(`/repos/${dOwner}/${dRepo}/git/commits`, destToken, {
    method: "POST",
    body: JSON.stringify({
      message: "🗑️ Limpar repositório para mirror",
      tree: emptyTree.sha,
      parents: [destRef.object.sha],
    }),
  });

  await ghFetch(`/repos/${dOwner}/${dRepo}/git/refs/heads/${dBranch}`, destToken, {
    method: "PATCH",
    body: JSON.stringify({ sha: emptyCommit.sha, force: true }),
  });
  log("✅ Destino limpo");

  // 6. Copy blobs in batches
  log("📦 Copiando arquivos...");
  const newTreeEntries: any[] = [];
  for (let i = 0; i < blobs.length; i += 10) {
    const batch = blobs.slice(i, i + 10);
    const results = await Promise.all(
      batch.map(async (blob: any) => {
        const blobData = await ghFetch(`/repos/${sOwner}/${sRepo}/git/blobs/${blob.sha}`, sourceToken);
        const newBlob = await ghFetch(`/repos/${dOwner}/${dRepo}/git/blobs`, destToken, {
          method: "POST",
          body: JSON.stringify({ content: blobData.content, encoding: blobData.encoding }),
        });
        return { path: blob.path, mode: blob.mode || "100644", type: "blob", sha: newBlob.sha };
      })
    );
    newTreeEntries.push(...results);
    log(`📦 ${Math.min(i + 10, blobs.length)}/${blobs.length} arquivos copiados`);
  }

  // 7. Create tree + commit in dest
  log("🌳 Criando árvore no destino...");
  const currentDestRef = await ghFetch(`/repos/${dOwner}/${dRepo}/git/ref/heads/${dBranch}`, destToken);

  const newTree = await ghFetch(`/repos/${dOwner}/${dRepo}/git/trees`, destToken, {
    method: "POST",
    body: JSON.stringify({ tree: newTreeEntries }),
  });

  const newCommit = await ghFetch(`/repos/${dOwner}/${dRepo}/git/commits`, destToken, {
    method: "POST",
    body: JSON.stringify({
      message: `📦 Mirror de ${sourceData.full_name}\n\nCopiado via GitHub Repo Mirror`,
      tree: newTree.sha,
      parents: [currentDestRef.object.sha],
    }),
  });

  await ghFetch(`/repos/${dOwner}/${dRepo}/git/refs/heads/${dBranch}`, destToken, {
    method: "PATCH",
    body: JSON.stringify({ sha: newCommit.sha, force: true }),
  });

  // 8. Copy additional branches
  if (sourceBranches.length > 1) {
    log("🔀 Copiando branches adicionais...");
    for (const branch of sourceBranches) {
      if (branch.name === sBranch) continue;
      try {
        // Get branch tree
        const branchTree = await ghFetch(
          `/repos/${sOwner}/${sRepo}/git/trees/${branch.commit.sha}?recursive=1`,
          sourceToken
        );
        const branchBlobs = branchTree.tree.filter((e: any) => e.type === "blob");

        const branchTreeEntries: any[] = [];
        for (let i = 0; i < branchBlobs.length; i += 10) {
          const batch = branchBlobs.slice(i, i + 10);
          const results = await Promise.all(
            batch.map(async (blob: any) => {
              const blobData = await ghFetch(`/repos/${sOwner}/${sRepo}/git/blobs/${blob.sha}`, sourceToken);
              const newBlob = await ghFetch(`/repos/${dOwner}/${dRepo}/git/blobs`, destToken, {
                method: "POST",
                body: JSON.stringify({ content: blobData.content, encoding: blobData.encoding }),
              });
              return { path: blob.path, mode: blob.mode || "100644", type: "blob", sha: newBlob.sha };
            })
          );
          branchTreeEntries.push(...results);
        }

        const bTree = await ghFetch(`/repos/${dOwner}/${dRepo}/git/trees`, destToken, {
          method: "POST",
          body: JSON.stringify({ tree: branchTreeEntries }),
        });

        const bCommit = await ghFetch(`/repos/${dOwner}/${dRepo}/git/commits`, destToken, {
          method: "POST",
          body: JSON.stringify({
            message: `📦 Mirror branch: ${branch.name}`,
            tree: bTree.sha,
            parents: [newCommit.sha],
          }),
        });

        // Create branch ref
        try {
          await ghFetch(`/repos/${dOwner}/${dRepo}/git/refs`, destToken, {
            method: "POST",
            body: JSON.stringify({ ref: `refs/heads/${branch.name}`, sha: bCommit.sha }),
          });
        } catch {
          await ghFetch(`/repos/${dOwner}/${dRepo}/git/refs/heads/${branch.name}`, destToken, {
            method: "PATCH",
            body: JSON.stringify({ sha: bCommit.sha, force: true }),
          });
        }

        log(`🔀 Branch '${branch.name}' copiado`);
      } catch (e: any) {
        log(`⚠️ Erro ao copiar branch '${branch.name}': ${e.message}`);
      }
    }
  }

  log("✅ Mirror concluído com sucesso!");
  log(`📊 Resumo: ${blobs.length} arquivos, ${sourceBranches.length} branch(es) copiado(s)`);

  return logs;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { sourceUrl, destUrl, sourceToken, destToken } = await req.json();

    if (!sourceUrl || !destUrl || !sourceToken || !destToken) {
      return new Response(
        JSON.stringify({ error: "Todos os campos são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const logs = await mirrorRepo(sourceUrl, destUrl, sourceToken, destToken);

    return new Response(
      JSON.stringify({ success: true, logs }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Mirror error:", message);
    return new Response(
      JSON.stringify({ success: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
