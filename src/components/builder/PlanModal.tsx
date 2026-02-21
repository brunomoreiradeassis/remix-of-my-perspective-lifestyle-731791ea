import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FileText,
  FilePlus,
  FileEdit,
  FileX,
  CheckCircle,
  XCircle,
  Loader2,
  ShieldCheck,
  GitBranch,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Eye,
  RotateCcw,
  Info,
} from "lucide-react";
import { useState } from "react";

interface PlanStep {
  title: string;
  files: string[];
}

interface PlanData {
  raw: string;
  steps: PlanStep[];
  fileOps: { create: string[]; modify: string[]; delete: string[] };
  status?: "idle" | "approved" | "running" | "done" | "error" | "rejected";
  stepStatus?: Array<"pending" | "running" | "done" | "error">;
  impactAnalysis?: {
    cascadeFiles: string[];
    warnings: string[];
  };
  diffSummaries?: string[];
}

interface PlanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanData | null;
  msgIndex: number;
  onApprove: (msgIndex: number) => void;
  onReject: (msgIndex: number) => void;
  isExecuting: boolean;
  isConnected: boolean;
  diagnosticText?: string;
}

export function PlanModal({
  open,
  onOpenChange,
  plan,
  msgIndex,
  onApprove,
  onReject,
  isExecuting,
  isConnected,
  diagnosticText,
}: PlanModalProps) {
  const [showImpact, setShowImpact] = useState(false);

  if (!plan) return null;

  const hasImpact = plan.impactAnalysis && (
    plan.impactAnalysis.cascadeFiles.length > 0 ||
    plan.impactAnalysis.warnings.length > 0
  );

  const totalFiles = plan.fileOps.create.length + plan.fileOps.modify.length + plan.fileOps.delete.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[80vh] flex flex-col p-0 gap-0 bg-[#181825] border-[#313244] text-[#cdd6f4]">
        {/* Header */}
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-[#313244] shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-[#89b4fa15]">
              <FileText className="h-4 w-4 text-[#89b4fa]" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-[#cdd6f4]">Plano de Execução</DialogTitle>
              <p className="text-[10px] text-[#6c7086] mt-0.5">
                {plan.steps.length} passos · {totalFiles} arquivos
                {plan.fileOps.delete.length > 0 && (
                  <span className="text-[#f38ba8] ml-1">({plan.fileOps.delete.length} a excluir)</span>
                )}
              </p>
            </div>
          </div>
        </DialogHeader>

        {/* Body - scrollable */}
        <div className="flex-1 overflow-auto px-5 py-4 space-y-4 min-h-0">
          {/* Diagnostic text */}
          {diagnosticText && (
            <div className="text-[11px] text-[#a6adc8] leading-relaxed whitespace-pre-line">
              {diagnosticText}
            </div>
          )}

          {/* File operations grid */}
          <div className="grid grid-cols-1 gap-2">
            {plan.fileOps.create.length > 0 && (
              <div className="bg-[#a6e3a108] border border-[#a6e3a130] rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#a6e3a1] mb-1.5">
                  <FilePlus className="h-3 w-3" />
                  Criar ({plan.fileOps.create.length})
                </div>
                {plan.fileOps.create.map((f) => (
                  <div key={f} className="text-[10px] font-mono text-[#a6adc8] truncate pl-4" title={f}>{f}</div>
                ))}
              </div>
            )}
            {plan.fileOps.modify.length > 0 && (
              <div className="bg-[#fab38708] border border-[#fab38730] rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#fab387] mb-1.5">
                  <FileEdit className="h-3 w-3" />
                  Modificar ({plan.fileOps.modify.length})
                </div>
                {plan.fileOps.modify.map((f) => (
                  <div key={f} className="text-[10px] font-mono text-[#a6adc8] truncate pl-4" title={f}>{f}</div>
                ))}
              </div>
            )}
            {plan.fileOps.delete.length > 0 && (
              <div className="bg-[#f38ba808] border border-[#f38ba830] rounded-lg px-3 py-2">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-[#f38ba8] mb-1.5">
                  <FileX className="h-3 w-3" />
                  Excluir ({plan.fileOps.delete.length})
                </div>
                {plan.fileOps.delete.map((f) => (
                  <div key={f} className="text-[10px] font-mono text-[#a6adc8] truncate pl-4" title={f}>{f}</div>
                ))}
              </div>
            )}
          </div>

          {/* Impact analysis */}
          {hasImpact && (
            <div>
              <button
                onClick={() => setShowImpact(!showImpact)}
                className="flex items-center gap-1.5 text-[10px] font-medium text-[#fab387] hover:text-[#fab387cc] transition-colors"
              >
                <GitBranch className="h-3 w-3" />
                Análise de Impacto
                {showImpact ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {showImpact && (
                <div className="mt-1.5 bg-[#fab38708] border border-[#fab38720] rounded-lg px-3 py-2 text-[10px] space-y-1">
                  {plan.impactAnalysis!.warnings.map((w, wi) => (
                    <div key={wi} className="flex items-start gap-1 text-[#fab387]">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>{w}</span>
                    </div>
                  ))}
                  {plan.impactAnalysis!.cascadeFiles.length > 0 && (
                    <div className="text-[#6c7086]">
                      <span className="font-semibold">Cascata:</span> {plan.impactAnalysis!.cascadeFiles.join(", ")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Steps */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-[#a6adc8] uppercase tracking-wider mb-1">Passos</div>
            {plan.steps.map((step, si) => (
              <div key={si} className="flex items-start gap-2.5 text-xs py-1.5 px-2.5 rounded-lg bg-[#1e1e2e] border border-[#313244]/50">
                <div className="mt-0.5 shrink-0">
                  {plan.stepStatus?.[si] === "done" && <CheckCircle className="h-3.5 w-3.5 text-[#a6e3a1]" />}
                  {plan.stepStatus?.[si] === "running" && <Loader2 className="h-3.5 w-3.5 text-[#89b4fa] animate-spin" />}
                  {plan.stepStatus?.[si] === "error" && <XCircle className="h-3.5 w-3.5 text-[#f38ba8]" />}
                  {plan.stepStatus?.[si] === "pending" && (
                    <div className="h-3.5 w-3.5 rounded-full border-2 border-[#585b70]" />
                  )}
                </div>
                <div className="min-w-0">
                  <span className="text-[#6c7086] mr-1">{si + 1}.</span>
                  <span className="text-[#cdd6f4]">{step.title}</span>
                  {step.files.length > 0 && (
                    <div className="text-[10px] text-[#6c7086] mt-0.5 truncate">{step.files.join(", ")}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Diff summaries */}
          {plan.diffSummaries && plan.diffSummaries.length > 0 && (
            <div className="bg-[#1e1e2e] border border-[#313244]/50 rounded-lg px-3 py-2 text-[10px] space-y-0.5">
              <div className="font-semibold text-[#6c7086] flex items-center gap-1 mb-1">
                <Eye className="h-3 w-3" />
                Resumo de alterações
              </div>
              {plan.diffSummaries.map((d, di) => (
                <div key={di} className="text-[#a6adc8] font-mono">{d}</div>
              ))}
            </div>
          )}

          {/* Status messages */}
          {plan.status === "running" && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[#89b4fa08] border border-[#89b4fa20] rounded-lg">
              <Loader2 className="h-3.5 w-3.5 text-[#89b4fa] animate-spin" />
              <span className="text-xs text-[#a6adc8] animate-pulse">Executando plano...</span>
            </div>
          )}
          {plan.status === "rejected" && (
            <div className="flex items-center gap-1.5 text-[10px] text-[#fab387] px-3 py-2 bg-[#fab38708] border border-[#fab38720] rounded-lg">
              <Info className="h-3 w-3" />
              Plano rejeitado. Descreva as alterações desejadas na próxima mensagem.
            </div>
          )}
        </div>

        {/* Footer with action buttons */}
        <DialogFooter className="px-5 py-4 border-t border-[#313244] shrink-0">
          {plan.status === "idle" && (
            <div className="flex w-full gap-3">
              <button
                onClick={() => {
                  onReject(msgIndex);
                  onOpenChange(false);
                }}
                disabled={isExecuting}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold border border-[#313244] text-[#a6adc8] hover:bg-[#313244] disabled:opacity-50 transition-all"
              >
                <XCircle className="h-4 w-4" />
                Rejeitar
              </button>
              <button
                onClick={() => {
                  onApprove(msgIndex);
                  onOpenChange(false);
                }}
                disabled={isExecuting || !isConnected}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold bg-[#a6e3a1] text-[#1e1e2e] hover:bg-[#a6e3a1cc] disabled:opacity-50 transition-all shadow-sm"
              >
                <ShieldCheck className="h-4 w-4" />
                Aprovar e Executar
              </button>
            </div>
          )}
          {plan.status === "error" && (
            <button
              onClick={() => {
                onApprove(msgIndex);
                onOpenChange(false);
              }}
              disabled={isExecuting || !isConnected}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-semibold bg-[#89b4fa] text-[#1e1e2e] hover:bg-[#89b4facc] disabled:opacity-50 transition-all"
            >
              <RotateCcw className="h-4 w-4" />
              Re-executar Plano
            </button>
          )}
          {(plan.status === "done" || plan.status === "approved" || plan.status === "running" || plan.status === "rejected") && (
            <button
              onClick={() => onOpenChange(false)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-xs font-medium bg-[#313244] text-[#a6adc8] hover:bg-[#45475a] transition-all"
            >
              Fechar
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
