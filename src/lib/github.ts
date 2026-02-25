import { supabase } from "@/integrations/supabase/client";

export type LogEntry = {
  msg: string;
  type: "info" | "success" | "error" | "warn";
  time: string;
};

export type LogFn = (msg: string, type?: LogEntry["type"]) => void;

function parseIcon(msg: string): LogEntry["type"] {
  if (msg.startsWith("✅")) return "success";
  if (msg.startsWith("⚠️")) return "warn";
  if (msg.startsWith("❌")) return "error";
  return "info";
}

export async function mirrorRepo(
  sourceUrl: string,
  destUrl: string,
  sourceToken: string,
  destToken: string,
  log: LogFn
): Promise<void> {
  log("Iniciando mirror via servidor...", "info");

  const { data, error } = await supabase.functions.invoke("github-mirror", {
    body: { sourceUrl, destUrl, sourceToken, destToken },
  });

  if (error) {
    throw new Error(error.message || "Erro ao chamar a função de mirror");
  }

  if (!data.success) {
    throw new Error(data.error || "Erro desconhecido no servidor");
  }

  // Replay server logs
  for (const logMsg of data.logs || []) {
    const type = parseIcon(logMsg);
    log(logMsg, type);
  }
}
