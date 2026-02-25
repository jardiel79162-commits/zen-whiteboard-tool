export interface RepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  isPublic: boolean;
  defaultBranch: string;
}

export interface FileEntry {
  path: string;
  sha: string;
  type: "blob" | "tree";
  content?: string;
  encoding?: string;
}

export type LogFn = (msg: string, type?: "info" | "success" | "error" | "warn") => void;

function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url
    .replace(/\.git$/, "")
    .match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) throw new Error(`URL inválida: ${url}`);
  return { owner: match[1], repo: match[2] };
}

async function ghFetch(
  path: string,
  token: string,
  options: RequestInit = {}
) {
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

export async function validateRepo(
  url: string,
  token: string
): Promise<RepoInfo> {
  const { owner, repo } = parseRepoUrl(url);
  const data = await ghFetch(`/repos/${owner}/${repo}`, token);
  return {
    owner,
    repo,
    fullName: data.full_name,
    isPublic: !data.private,
    defaultBranch: data.default_branch,
  };
}

export async function validateToken(token: string): Promise<string> {
  const data = await ghFetch("/user", token);
  return data.login;
}

async function getTree(
  owner: string,
  repo: string,
  branch: string,
  token: string
): Promise<FileEntry[]> {
  const data = await ghFetch(
    `/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    token
  );
  return data.tree;
}

async function getBlob(
  owner: string,
  repo: string,
  sha: string,
  token: string
): Promise<{ content: string; encoding: string }> {
  const data = await ghFetch(
    `/repos/${owner}/${repo}/git/blobs/${sha}`,
    token
  );
  return { content: data.content, encoding: data.encoding };
}

async function deleteAllContents(
  owner: string,
  repo: string,
  token: string,
  branch: string,
  log: LogFn
) {
  log("Obtendo referência do branch de destino...");
  
  // Get the current commit
  const refData = await ghFetch(
    `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    token
  );
  
  // Create an empty tree
  const emptyTree = await ghFetch(
    `/repos/${owner}/${repo}/git/trees`,
    token,
    {
      method: "POST",
      body: JSON.stringify({ tree: [] }),
    }
  );

  // Create a commit with the empty tree
  const emptyCommit = await ghFetch(
    `/repos/${owner}/${repo}/git/commits`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        message: "🗑️ Limpar repositório para mirror",
        tree: emptyTree.sha,
        parents: [refData.object.sha],
      }),
    }
  );

  // Update the reference
  await ghFetch(
    `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    token,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: emptyCommit.sha, force: true }),
    }
  );

  log("Conteúdo do destino removido ✓", "success");
}

export async function cloneRepo(
  sourceUrl: string,
  destUrl: string,
  sourceToken: string,
  destToken: string,
  log: LogFn
) {
  // Step 1: Validate
  log("Validando repositório de origem...");
  const source = await validateRepo(sourceUrl, sourceToken);
  if (!source.isPublic) throw new Error("O repositório de origem deve ser público.");
  log(`Origem: ${source.fullName} (branch: ${source.defaultBranch}) ✓`, "success");

  log("Validando repositório de destino...");
  const dest = await validateRepo(destUrl, destToken);
  if (!dest.isPublic) throw new Error("O repositório de destino deve ser público.");
  log(`Destino: ${dest.fullName} (branch: ${dest.defaultBranch}) ✓`, "success");

  // Step 2: Delete dest contents
  log("Limpando repositório de destino...");
  await deleteAllContents(dest.owner, dest.repo, destToken, dest.defaultBranch, log);

  // Step 3: Get source tree
  log("Obtendo árvore de arquivos da origem...");
  const tree = await getTree(source.owner, source.repo, source.defaultBranch, sourceToken);
  const blobs = tree.filter((e) => e.type === "blob");
  log(`${blobs.length} arquivo(s) encontrado(s)`, "info");

  // Step 4: Copy blobs to dest
  log("Copiando arquivos para o destino...");
  const newTreeEntries: any[] = [];
  
  // Process in batches of 5
  for (let i = 0; i < blobs.length; i += 5) {
    const batch = blobs.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (blob) => {
        const blobData = await getBlob(source.owner, source.repo, blob.sha, sourceToken);
        // Create blob in dest
        const newBlob = await ghFetch(
          `/repos/${dest.owner}/${dest.repo}/git/blobs`,
          destToken,
          {
            method: "POST",
            body: JSON.stringify({
              content: blobData.content,
              encoding: blobData.encoding,
            }),
          }
        );
        return {
          path: blob.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: newBlob.sha,
        };
      })
    );
    newTreeEntries.push(...results);
    log(`Copiados ${Math.min(i + 5, blobs.length)}/${blobs.length} arquivos...`);
  }

  // Step 5: Create tree in dest
  log("Criando nova árvore no destino...");
  const destRef = await ghFetch(
    `/repos/${dest.owner}/${dest.repo}/git/ref/heads/${dest.defaultBranch}`,
    destToken
  );

  const newTree = await ghFetch(
    `/repos/${dest.owner}/${dest.repo}/git/trees`,
    destToken,
    {
      method: "POST",
      body: JSON.stringify({ tree: newTreeEntries }),
    }
  );

  // Step 6: Create commit
  log("Criando commit no destino...");
  const newCommit = await ghFetch(
    `/repos/${dest.owner}/${dest.repo}/git/commits`,
    destToken,
    {
      method: "POST",
      body: JSON.stringify({
        message: `📦 Mirror de ${source.fullName}`,
        tree: newTree.sha,
        parents: [destRef.object.sha],
      }),
    }
  );

  // Step 7: Update ref
  await ghFetch(
    `/repos/${dest.owner}/${dest.repo}/git/refs/heads/${dest.defaultBranch}`,
    destToken,
    {
      method: "PATCH",
      body: JSON.stringify({ sha: newCommit.sha, force: true }),
    }
  );

  log("✅ Mirror concluído com sucesso!", "success");
  log(
    `Nota: Este método copia apenas os arquivos do branch padrão. Para mirror completo (todos os branches, commits e histórico), use o script Python disponível na aba "Script Python".`,
    "warn"
  );
}

export function generatePythonScript(
  sourceUrl: string,
  destUrl: string
): string {
  return `#!/usr/bin/env python3
"""
GitHub Repository Mirror Script
================================
Clona integralmente um repositório GitHub (todos os branches, commits, tags e histórico)
e substitui o conteúdo de outro repositório.

⚠️  ATENÇÃO: Todo o conteúdo do repositório de destino será APAGADO permanentemente!

Requisitos:
  - Python 3.7+
  - Git instalado e acessível no PATH
  - Tokens de acesso pessoal (PAT) com permissão "repo"

Instalação:
  pip install PyGithub requests

Uso:
  python mirror_repo.py
"""

import subprocess
import sys
import os
import shutil
import tempfile

try:
    from github import Github, GithubException
except ImportError:
    print("❌ Instale PyGithub: pip install PyGithub")
    sys.exit(1)

# ═══════════════════════════════════════════════
# CONFIGURAÇÃO - Preencha com seus dados
# ═══════════════════════════════════════════════
SOURCE_URL = "${sourceUrl || 'https://github.com/usuario/origem-repo'}"
DEST_URL = "${destUrl || 'https://github.com/usuario/destino-repo'}"
SOURCE_TOKEN = os.environ.get("SOURCE_GITHUB_TOKEN", "")
DEST_TOKEN = os.environ.get("DEST_GITHUB_TOKEN", "")

# ═══════════════════════════════════════════════


def parse_repo(url: str) -> str:
    """Extrai owner/repo da URL."""
    url = url.rstrip("/").replace(".git", "")
    parts = url.split("github.com/")
    if len(parts) != 2:
        raise ValueError(f"URL inválida: {url}")
    return parts[1]


def validate_repo(gh: Github, full_name: str, label: str):
    """Valida que o repositório existe e é público."""
    try:
        repo = gh.get_repo(full_name)
    except GithubException as e:
        raise RuntimeError(f"❌ Não foi possível acessar {label} ({full_name}): {e}")
    
    if repo.private:
        raise RuntimeError(f"❌ O repositório {label} ({full_name}) é privado. Ambos devem ser públicos.")
    
    print(f"  ✅ {label}: {full_name} (público, branch padrão: {repo.default_branch})")
    return repo


def run_git(*args, cwd=None):
    """Executa comando Git e retorna o resultado."""
    result = subprocess.run(
        ["git"] + list(args),
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Git error: {result.stderr.strip()}")
    return result.stdout.strip()


def main():
    if not SOURCE_TOKEN or not DEST_TOKEN:
        print("❌ Configure os tokens de acesso!")
        print("   export SOURCE_GITHUB_TOKEN='ghp_...'")
        print("   export DEST_GITHUB_TOKEN='ghp_...'")
        sys.exit(1)

    source_name = parse_repo(SOURCE_URL)
    dest_name = parse_repo(DEST_URL)

    print("\\n🔍 Validando repositórios...\\n")
    
    gh_source = Github(SOURCE_TOKEN)
    gh_dest = Github(DEST_TOKEN)
    
    source_repo = validate_repo(gh_source, source_name, "Origem")
    dest_repo = validate_repo(gh_dest, dest_name, "Destino")

    print(f"\\n⚠️  ATENÇÃO: Todo o conteúdo de '{dest_name}' será APAGADO!")
    confirm = input("   Deseja continuar? (sim/não): ").strip().lower()
    if confirm not in ("sim", "s", "yes", "y"):
        print("   Operação cancelada.")
        sys.exit(0)

    tmpdir = tempfile.mkdtemp(prefix="gh_mirror_")
    
    try:
        # Clone mirror da origem
        print(f"\\n📥 Clonando origem (mirror)...")
        source_auth_url = f"https://{SOURCE_TOKEN}@github.com/{source_name}.git"
        run_git("clone", "--mirror", source_auth_url, os.path.join(tmpdir, "repo.git"))
        
        repo_dir = os.path.join(tmpdir, "repo.git")
        
        # Push mirror para o destino
        print(f"📤 Enviando para destino (force push)...")
        dest_auth_url = f"https://{DEST_TOKEN}@github.com/{dest_name}.git"
        run_git("remote", "set-url", "origin", dest_auth_url, cwd=repo_dir)
        run_git("push", "--mirror", "--force", cwd=repo_dir)
        
        print(f"\\n✅ Mirror concluído com sucesso!")
        print(f"   {source_name} → {dest_name}")
        print(f"   Todos os branches, tags, commits e histórico foram copiados.")
        
        # Verificar que o destino continua público
        dest_repo_check = gh_dest.get_repo(dest_name)
        if dest_repo_check.private:
            print("\\n⚠️  O repositório de destino ficou privado. Tornando público novamente...")
            dest_repo_check.edit(private=False)
            print("   ✅ Repositório de destino é público novamente.")
        else:
            print(f"   ✅ Repositório de destino continua público.")
            
    except Exception as e:
        print(f"\\n❌ Erro: {e}")
        sys.exit(1)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


if __name__ == "__main__":
    main()
`;
}
