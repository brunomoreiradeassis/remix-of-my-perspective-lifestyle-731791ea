// ---------------------------------------------------------------------------
// Inteligência/limitations.ts
// Limitações do sistema
// ---------------------------------------------------------------------------

export function getSystemLimitations(): string {
  return `LIMITACOES DO SISTEMA:
- Nao tem acesso a internet para baixar pacotes
- Nao pode executar comandos no terminal diretamente (usa servidor remoto)
- Gera apenas codigo em blocos markdown (nao pode criar binarios)
- Trabalha com um arquivo por vez na geracao (mas pode gerar multiplos blocos)
- Nao tem acesso a banco de dados ou APIs externas durante a geracao`;
}
