# Melhorias no command-server.cjs e Auto-Fix de Erros

## Resumo

Tres grandes melhorias no sistema BuilderAI:

1. **Servir arquivos estaticos da raiz do projeto** (`/project-assets/{projectName} ) referente ao projeto aberto`
2. **Validacao e auto-fix universal de arquivos** (nao apenas CSS listados manualmente)
3. **Monitoramento continuo do Vite com auto-fix e modal de erros automatico**

---

## 1. Servir arquivos da raiz do projeto corretamente

**Problema atual**: O endpoint `/project-assets` aponta para `PROJECTS_ROOT` mas a URL de asset gerada no `read-project` usa `path.basename(path.dirname(projectDir))` que gera caminhos incorretos.

**Solucao**:

- Corrigir a URL de assets para usar `projectName` diretamente: `/project-assets/{projectName}/{filePath}`
- O middleware `express.static` ja serve de `PROJECTS_ROOT` (`./Projetos/`), entao a estrutura `./Projetos/[nome-do-projeto]/` ja esta correta
- Basta corrigir a geracao da URL na rota `/read-project`

---

## 2. Validacao universal de arquivos (nao apenas CSS hardcoded)

**Problema atual**: `validateAndFixProject` so verifica `src/index.css`, `src/styles.css`, `src/globals.css`, `src/app.css`.

**Solucao**: Escanear recursivamente TODOS os arquivos `.css` do projeto e aplicar as mesmas verificacoes:

- `@layer` sem `@tailwind` directives
- `@import` depois de `@tailwind`
- Adicionar tambem validacao de arquivos `.tsx/.ts/.jsx/.js` para problemas comuns:
  - Imports de modulos inexistentes (paths relativos quebrados)
  - Imports duplicados
  - Verificar se `postcss.config` e `tailwind.config` existem quando Tailwind e usado

---

## 3. Monitoramento continuo do Vite com Auto-Fix automatico

**Problema atual**: Erros do Vite so sao capturados quando o usuario recarrega manualmente. Nao ha auto-fix automatico.

**Solucao em duas partes**:

### 3a. No `command-server.cjs` - Nova rota `/watch-errors`

Criar uma rota que monitora a saida do processo Vite periodicamente (a cada 3 segundos) e retorna erros novos detectados via Server-Sent Events (SSE):

```text
GET /watch-errors -> SSE stream
  - Analisa stderr do processo dev atual
  - Detecta padroes de erro do Vite/PostCSS/TypeScript
  - Tenta auto-fix quando possivel (mesma logica do validateAndFixProject expandida)
  - Emite eventos: { type: "error", message, autoFixed: boolean }
```

Padroes de erro que serao auto-corrigidos:

- `@layer base` sem `@tailwind base` -> inserir directives
- `@import` apos `@tailwind` -> reordenar
- Porta em conflito (8080) -> trocar para 8081
- `export default` faltando em App -> adicionar
- PostCSS errors relacionados a Tailwind -> corrigir config

### 3b. No frontend - Monitoramento e modal automatico

**Alteracoes no `OllamaContext.tsx**`:

- Adicionar listener SSE para `/watch-errors`
- Quando erros sao detectados, adicionar ao `buildErrors`
- Se auto-fix foi aplicado, mostrar toast de sucesso
- Se nao foi possivel auto-fix, abrir o `ErrorDiagnosticModal` automaticamente

**Alteracoes no `PreviewPanel.tsx**`:

- Abrir modal de erros automaticamente quando novos erros de build sao detectados
- Mostrar indicador visual de "auto-fix em andamento"

**Alteracoes no `ErrorDiagnosticModal.tsx**`:

- Adicionar categoria "Auto-Fix" para erros que foram corrigidos automaticamente
- Mostrar log de correcoes aplicadas
- Exibir em um badge o arquivo que está sendo modificado como: Modificando/Criando/Excluindo src/foldername/filename.ext

---

## Detalhes Tecnicos

### Arquivos a modificar:

1. `**scripts/command-server.cjs**`:
  - Linha 29: Manter `/project-assets` como esta (ja funciona)
  - Linha 511: Corrigir URL de asset para usar `projectName` corretamente
  - Linhas 216-276: Expandir `validateAndFixProject` para escanear todos `.css` recursivamente
  - Adicionar validacao de imports em arquivos `.ts/.tsx/.js/.jsx`
  - Adicionar rota SSE `/watch-errors` que monitora stderr do processo dev
  - Adicionar funcao `autoFixViteError(errorMessage, projectDir)` com padroes de correcao
2. `**src/contexts/OllamaContext.tsx**`:
  - Adicionar state `autoFixLog` para registro de correcoes
  - Adicionar `useEffect` com EventSource para `/watch-errors`
  - Disparar auto-fix via Ollama quando erro nao e corrigivel automaticamente
3. `**src/components/builder/PreviewPanel.tsx**`:
  - Auto-abrir `ErrorDiagnosticModal` quando `buildErrors` muda e tem erros novos
4. `**src/components/builder/ErrorDiagnosticModal.tsx**`:
  - Adicionar secao de "Correcoes automaticas aplicadas"
  - Melhorar deteccao de pacotes faltando

### Fluxo do monitoramento:

```text
Vite stderr -> command-server captura -> tenta auto-fix local
  |-> Se corrigiu: notifica frontend via SSE (toast de sucesso)
  |-> Se nao corrigiu: notifica frontend via SSE (adiciona ao buildErrors)
      |-> Modal abre automaticamente
      |-> Usuario pode clicar "Fixar com IA" (Ollama)
      |-> Ou sistema tenta auto-fix via Ollama automaticamente
```

### Intervalo de monitoramento:

- Verificacao a cada 3 segundos (nao trava o sistema)
- Debounce para evitar multiplas correcoes do mesmo erro
- Cache de erros ja processados para nao repetir

Fazer os ajustes para que o Visualizador web renderize corretamente qualquer projeto Vite React + TypeScript + shadcn + tailwindcss