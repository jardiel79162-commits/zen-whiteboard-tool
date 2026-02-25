import { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { mirrorRepo, type LogEntry } from "@/lib/github";
import { GitBranch, Copy, AlertTriangle, CheckCircle, Info, XCircle, Loader2, Eye, EyeOff } from "lucide-react";

const LogIcon = ({ type }: { type: LogEntry["type"] }) => {
  switch (type) {
    case "success": return <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />;
    case "error": return <XCircle className="h-4 w-4 text-destructive shrink-0" />;
    case "warn": return <AlertTriangle className="h-4 w-4 text-yellow-500 shrink-0" />;
    default: return <Info className="h-4 w-4 text-primary shrink-0" />;
  }
};

const Index = () => {
  const [sourceUrl, setSourceUrl] = useState("");
  const [destUrl, setDestUrl] = useState("");
  const [sourceToken, setSourceToken] = useState("");
  const [destToken, setDestToken] = useState("");
  const [showSourceToken, setShowSourceToken] = useState(false);
  const [showDestToken, setShowDestToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((msg: string, type: LogEntry["type"] = "info") => {
    const time = new Date().toLocaleTimeString("pt-BR");
    setLogs((prev) => [...prev, { msg, type, time }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
  }, []);

  const handleClone = async () => {
    setLogs([]);
    setLoading(true);
    try {
      await mirrorRepo(sourceUrl, destUrl, sourceToken, destToken, addLog);
    } catch (err: any) {
      addLog(err.message || "Erro desconhecido", "error");
    } finally {
      setLoading(false);
    }
  };

  const isValid = sourceUrl.includes("github.com/") && destUrl.includes("github.com/") && sourceToken.length > 0 && destToken.length > 0;

  return (
    <div className="min-h-screen bg-background py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-accent">
              <GitBranch className="h-7 w-7 text-primary" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">GitHub Repo Mirror</h1>
          </div>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Copie todos os arquivos e branches de um repositório GitHub público para outro — 100% online, sem baixar nada.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Configuração</CardTitle>
            <CardDescription>
              Informe os repositórios e tokens de acesso. Ambos devem ser públicos e os tokens precisam da permissão "repo".
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Source */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Origem</h3>
              <div className="space-y-2">
                <Label htmlFor="source-url">URL do Repositório</Label>
                <Input
                  id="source-url"
                  placeholder="https://github.com/usuario/repo-origem"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="source-token">Token de Acesso (PAT)</Label>
                <div className="relative">
                  <Input
                    id="source-token"
                    type={showSourceToken ? "text" : "password"}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={sourceToken}
                    onChange={(e) => setSourceToken(e.target.value)}
                    disabled={loading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSourceToken(!showSourceToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showSourceToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t" />

            {/* Dest */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Destino</h3>
              <div className="space-y-2">
                <Label htmlFor="dest-url">URL do Repositório</Label>
                <Input
                  id="dest-url"
                  placeholder="https://github.com/usuario/repo-destino"
                  value={destUrl}
                  onChange={(e) => setDestUrl(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dest-token">Token de Acesso (PAT)</Label>
                <div className="relative">
                  <Input
                    id="dest-token"
                    type={showDestToken ? "text" : "password"}
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={destToken}
                    onChange={(e) => setDestToken(e.target.value)}
                    disabled={loading}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowDestToken(!showDestToken)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showDestToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Warning */}
            <div className="rounded-lg border border-yellow-300/50 bg-yellow-50 dark:bg-yellow-900/10 dark:border-yellow-700/30 p-3 flex gap-3">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-800 dark:text-yellow-300">
                <strong>Atenção:</strong> Todo o conteúdo do repositório de destino será substituído permanentemente. Esta ação não pode ser desfeita.
              </div>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button className="w-full" size="lg" disabled={!isValid || loading}>
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      Executando mirror...
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4 mr-2" />
                      Iniciar Mirror
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirmar operação de mirror</AlertDialogTitle>
                  <AlertDialogDescription>
                    Todo o conteúdo do repositório de destino será <strong>apagado permanentemente</strong> e substituído pelo conteúdo da origem, incluindo todos os branches. Tem certeza?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleClone}>
                    Sim, continuar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>

        {/* Logs */}
        {logs.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                Log de Execução
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-muted rounded-lg p-4 max-h-80 overflow-y-auto space-y-2 font-mono text-sm">
                {logs.map((log, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground text-xs mt-0.5 shrink-0 w-16">{log.time}</span>
                    <LogIcon type={log.type} />
                    <span className={
                      log.type === "error" ? "text-destructive" :
                      log.type === "success" ? "text-green-600 dark:text-green-400" :
                      log.type === "warn" ? "text-yellow-600 dark:text-yellow-400" :
                      "text-foreground"
                    }>
                      {log.msg}
                    </span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* How it works */}
        <Card className="border-primary/20 bg-accent/30">
          <CardContent className="pt-5">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="text-sm space-y-2 text-muted-foreground">
                <p><strong className="text-foreground">Como funciona:</strong></p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Valida que ambos os repositórios são públicos e os tokens são válidos</li>
                  <li>Apaga todo o conteúdo do repositório de destino</li>
                  <li>Copia todos os arquivos do branch padrão da origem</li>
                  <li>Copia os branches adicionais da origem para o destino</li>
                  <li>O repositório de destino permanece público</li>
                </ol>
                <p className="text-xs mt-2">Os tokens são processados apenas no servidor e nunca são armazenados.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Index;
