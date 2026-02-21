# 🦙 Implementação do Ollama — Guia Completo

Este documento descreve o passo a passo para integrar o **Ollama** (modelos de IA rodando localmente) em cada parte do sistema de criação de sites no-code.

---

## 📋 Índice

1. [Pré-requisitos](#1-pré-requisitos)
2. [Arquitetura da Integração](#2-arquitetura-da-integração)
3. [Configuração do Ollama](#3-configuração-do-ollama)
4. [Serviço de Conexão (OllamaService)](#4-serviço-de-conexão-ollamaservice)
5. [Integração por Componente](#5-integração-por-componente)
6. [Fluxo de Geração de Sites](#6-fluxo-de-geração-de-sites)
7. [Tratamento de Erros](#7-tratamento-de-erros)
8. [Otimizações](#8-otimizações)

---

## 1. Pré-requisitos

- **Ollama instalado** localmente: [https://ollama.ai](https://ollama.ai)
- Modelos recomendados baixados:
  - `codellama:13b` — Geração de código (React/TSX)
  - `llama3:8b` — Chat geral e instruções
  - `deepseek-coder:6.7b` — Alternativa leve para código
  - `mistral:7b` — Bom equilíbrio entre velocidade e qualidade
- Ollama rodando na porta padrão: `http://localhost:11434`

---

## 2. Arquitetura da Integração

```
┌──────────────────────────────────────────────┐
│                  FRONTEND                     │
│                                               │
│  ┌─────────┐  ┌──────────┐  ┌──────────────┐ │
│  │ChatPanel│  │CodeEditor│  │PreviewPanel   │ │
│  └────┬────┘  └────┬─────┘  └──────┬───────┘ │
│       │            │               │          │
│  ┌────▼────────────▼───────────────▼───────┐  │
│  │         OllamaService (Context)         │  │
│  │  - connection status                    │  │
│  │  - model selection                      │  │
│  │  - streaming chat                       │  │
│  │  - code generation                      │  │
│  └────────────────┬────────────────────────┘  │
│                   │                           │
└───────────────────┼───────────────────────────┘
                    │ HTTP (localhost:11434)
┌───────────────────▼───────────────────────────┐
│              OLLAMA (Local)                    │
│  ┌──────────┐ ┌────────┐ ┌──────────────────┐ │
│  │codellama │ │llama3  │ │deepseek-coder    │ │
│  └──────────┘ └────────┘ └──────────────────┘ │
└────────────────────────────────────────────────┘
```

---

## 3. Configuração do Ollama

### 3.1 Habilitar CORS no Ollama

O Ollama precisa aceitar requisições do navegador. Defina a variável de ambiente:

```bash
# Linux/Mac
OLLAMA_ORIGINS="*" ollama serve

# Ou no .bashrc / .zshrc
export OLLAMA_ORIGINS="*"
```

### 3.2 Verificar Conexão

```bash
curl http://localhost:11434/api/tags
```

Deve retornar a lista de modelos instalados.

### 3.3 Baixar Modelos Recomendados

```bash
ollama pull codellama:13b
ollama pull llama3:8b
ollama pull deepseek-coder:6.7b
```

---

## 4. Serviço de Conexão (OllamaService)

### 4.1 Criar `src/services/ollamaService.ts`

**Responsabilidades:**
- Verificar status de conexão (polling)
- Listar modelos disponíveis
- Enviar prompts com streaming
- Gerenciar configurações (URL base, modelo selecionado, temperatura)
✅ Implementado `src/services/ollamaService.ts` com chat/generate em streaming e parser de blocos TSX

**Endpoints do Ollama utilizados:**
| Endpoint | Método | Uso |
|---|---|---|
| `/api/tags` | GET | Listar modelos instalados |
| `/api/generate` | POST | Gerar texto (completion) |
| `/api/chat` | POST | Chat com histórico |
| `/api/show` | POST | Info detalhada do modelo |

### 4.2 Criar `src/contexts/OllamaContext.tsx`

**Estado global gerenciado:**
- `isConnected: boolean` — Status da conexão
- `baseUrl: string` — URL do Ollama (default: `http://localhost:11434`)
- `selectedModel: string` — Modelo ativo
- `availableModels: Model[]` — Lista de modelos
- `temperature: number` — Criatividade (0.0 - 1.0)
- `maxTokens: number` — Limite de tokens por resposta
✅ Expandido com `previewCode` e `lastPrompt` para integração entre Chat e Preview

### 4.3 Criar `src/hooks/useOllama.ts`

**Hook customizado com funções:**
- `checkConnection()` — Verifica se o Ollama está rodando
- `listModels()` — Busca modelos disponíveis
- `generateCode(prompt)` — Gera código React/TSX
- `chat(messages)` — Chat com contexto
- `streamGenerate(prompt, onToken)` — Geração com streaming
✅ Implementado `src/hooks/useOllama.ts` com wrappers e seleção automática de modelo

---

## 5. Integração por Componente

### 5.1 🔧 TopToolbar (`TopToolbar.tsx`)

**O que implementar:**
- [x] Indicador visual de status de conexão (🟢 Conectado / 🔴 Desconectado)
- [x] Botão de configurações do Ollama (abre modal)
- [x] Exibição do modelo ativo selecionado
- [x] Badge com nome do modelo ao lado do logo

**Detalhes:**
- O indicador deve fazer polling a cada 5 segundos
- Ao clicar no indicador, abrir painel de configurações
- Mostrar tooltip com detalhes (URL, modelo, latência)

---

### 5.2 💬 ChatPanel (`ChatPanel.tsx`)

**O que implementar:**
- [x] Conectar input ao endpoint `/api/chat` do Ollama
- [x] Streaming de respostas token a token
- [x] System prompt especializado para geração de sites
- [x] Usar contexto do projeto (arquivos existentes) para orientar a geração
- [x] Seletor de modelo no header do chat
- [x] Histórico de mensagens persistente (localStorage)
- [x] Aplicação automática das respostas com código nos arquivos
- [x] Continuação automática para blocos TSX truncados
- [x] Renderização do código completo no card do assistente

**System Prompt sugerido:**
```
Você é um assistente especializado em React+TypeScript+Tailwind. Siga estritamente:
- Páginas: src/pages/*.tsx
- Componentes: src/components/*.tsx
- Módulos: src/modules/**/*.ts
- Assets: public/*
Inclua um comentário com caminho relativo no topo de cada bloco (ex.: // src/components/ProdutoCard.tsx).
Retorne blocos ```tsx completos, um bloco por arquivo, sem explicações.
```

**Fluxo:**
1. Usuário digita descrição do site
2. Frontend envia para `/api/chat` com system prompt
3. Resposta chega via streaming
4. Código extraído da resposta é parseado
5. Preview é atualizado em tempo real
✅ Implementado fluxo completo de chat com streaming e aplicação no preview

---

### 5.3 👁️ PreviewPanel (`PreviewPanel.tsx`)

**O que implementar:**
- [x] Renderizar código gerado pelo Ollama em tempo real
- [x] Sandbox seguro para execução do código (iframe ou eval controlado)
- [x] Hot-reload quando novo código é gerado
- [x] Fallback visual quando código tem erros
- [x] Botão "Regenerar" que pede ao Ollama uma nova versão
- [x] Botão "Continuar gerando" para finalizar respostas truncadas diretamente no Preview

**Fluxo de renderização:**
1. Receber código TSX do ChatPanel ou CodeEditor
2. Transpilar TSX → JS (usar Babel standalone no browser)
3. Renderizar dentro de iframe sandboxed
4. Capturar erros e exibir de forma amigável
✅ Implementado com Babel Standalone via CDN dentro de iframe sandbox

---

### 5.4 📝 CodeEditor (`CodeEditor.tsx`)

**O que implementar:**
- [x] Botão "Gerar com IA" que envia conteúdo do editor ao Ollama
- [x] Autocomplete de código usando `/api/generate` com fill-in-the-middle
- [x] Botão "Explicar código" que envia trecho selecionado ao Ollama
- [x] Botão "Corrigir erros" que envia erros do console ao Ollama
- [x] Diff view mostrando antes/depois das sugestões da IA
- [x] Botão "Continuar gerando" quando resposta vem truncada

**Prompt para autocomplete:**
```
Complete o seguinte código React/TypeScript. Retorne APENAS o código 
completado, sem explicações:

{código_atual}
```

---

### 5.5 📁 FileSidebar (`FileSidebar.tsx`)

**O que implementar:**
- [x] Botão "Gerar componente" que cria novo arquivo via Ollama
- [x] Contexto dos arquivos existentes enviado ao Ollama para coerência
- [x] Renomear/reorganizar sugerido pela IA
- [x] Indicador de quais arquivos foram gerados por IA
✅ Integração com `src/pages` e `public` para arquivos gerados pela IA

---

### 5.6 ⚙️ OllamaSettings (Novo componente)

**O que implementar:**
- [x] Modal/Drawer de configurações
- [x] Campo para URL base do Ollama
- [x] Dropdown para selecionar modelo
- [x] Slider para temperatura (0.0 - 1.0)
- [x] Input para max tokens
- [x] Botão "Testar Conexão"
- [x] Lista de modelos com tamanho e status
- [x] Botão para baixar novos modelos (via `/api/pull`)
- [x] Persistir configurações no localStorage

---

## 6. Fluxo de Geração de Sites

### 6.1 Fluxo Principal

```
Usuário descreve site → ChatPanel envia ao Ollama
       ↓
Ollama gera código React/TSX com streaming
       ↓
Código é parseado e separado por componente/página/asset
       ↓
Arquivos/páginas/assets são criados/atualizados no FileSidebar
       ↓
Código é transpilado e renderizado no PreviewPanel
       ↓
Usuário pode editar no CodeEditor
       ↓
Alterações manuais são sincronizadas
```

### 6.2 Prompts Especializados por Tarefa

| Tarefa | Modelo Recomendado | Temperatura |
|---|---|---|
| Gerar layout completo | `codellama:13b` | 0.7 |
| Corrigir bug de código | `deepseek-coder:6.7b` | 0.2 |
| Explicar código | `llama3:8b` | 0.5 |
| Gerar variações de design | `codellama:13b` | 0.9 |
| Refatorar componente | `deepseek-coder:6.7b` | 0.3 |
✅ Seleção de modelo conforme escolha do usuário (sem predefinições fixas)

### 6.3 Formato de Resposta Esperado

O Ollama deve retornar código em blocos markdown:

````
```tsx
// NomeDoComponente.tsx
import React from 'react';

export function NomeDoComponente() {
  return (
    <div className="...">
      {/* conteúdo */}
    </div>
  );
}
```
````

**Parser necessário:** Extrair blocos de código da resposta, identificar nome do arquivo pelo comentário, e criar/atualizar arquivos correspondentes.
✅ Parser de blocos TSX implementado no serviço (`extractTsxBlocks`)
✅ Roteamento automático: `src/components/*` para componentes, `src/pages/*` para páginas e `public/*` para assets

---

## 7. Tratamento de Erros

### 7.1 Erros de Conexão
- Ollama não está rodando → Mostrar instrução para iniciar
- CORS bloqueado → Instruir a configurar `OLLAMA_ORIGINS`
- Timeout → Permitir configurar timeout nas settings

### 7.2 Erros de Geração
- Modelo não encontrado → Sugerir download
- [x] Resposta truncada → Botão "Continuar gerando"
- Código inválido gerado → Enviar erro de volta ao Ollama para correção

### 7.3 Estados da UI
| Estado | Indicador |
|---|---|
| Conectado | 🟢 Verde + "Conectado" |
| Desconectado | 🔴 Vermelho + "Desconectado" |
| Gerando | 🟡 Amarelo + spinner + "Gerando..." |
| Erro | 🔴 Vermelho + mensagem de erro |

---

## 8. Otimizações

### 8.1 Performance
- [x] Cache de respostas similares no localStorage
- [x] Debounce no autocomplete (300ms)
- [x] Cancelar requisições anteriores ao enviar nova
- [x] Usar `AbortController` para cancelar streams

### 8.2 Qualidade das Respostas
- [x] Few-shot prompting com exemplos de componentes bons
- [x] Enviar contexto dos componentes existentes
- [x] Template de projeto como contexto base
- [x] Feedback loop: usuário pode avaliar respostas (👍/👎)

### 8.3 UX
- [x] Skeleton loading durante geração
- [x] Indicador de progresso estimado
- [x] Histórico de gerações com undo/redo
- [x] Preview lado a lado (antes/depois)
- [x] Notificações em cards no canto da tela (2s de exibição)

---

## 📌 Ordem de Implementação Sugerida

1. **OllamaService + Context** — Base de tudo
2. **Settings + Status Indicator** — Configurar conexão
3. **ChatPanel integration** — Chat funcional com streaming
4. **PreviewPanel rendering** — Visualizar código gerado
5. **CodeEditor features** — Autocomplete e geração
6. **FileSidebar integration** — Gerenciamento de arquivos
7. **Otimizações** — Cache, performance, UX

---

> **Nota:** Todas as chamadas ao Ollama são feitas diretamente do navegador (localhost), sem necessidade de backend intermediário. Isso simplifica a arquitetura mas requer que o CORS esteja configurado corretamente.
