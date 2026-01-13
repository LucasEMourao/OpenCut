# 🎬 OpenCut - AI Enhanced Edition

[![Bun](https://img.shields.io/badge/Bun-%23000000.svg?style=for-the-badge&logo=bun&logoColor=white)](https://bun.sh/)
[![Next.js](https://img.shields.io/badge/Next.js-black?style=for-the-badge&logo=next.js&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-%23007ACC.svg?style=for-the-badge&logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)

O **OpenCut (AI Edition)** é um editor de vídeo web de alto desempenho que utiliza Inteligência Artificial para automatizar o processo de decupagem e edição. Este projeto é um fork aprimorado do OpenCut original, onde reconstruí o núcleo de processamento para transformar a ferramenta em um assistente de edição inteligente e autônomo.

---

## 🌟 O Diferencial: Inteligência Artificial no Core

O grande destaque deste fork é a camada de **Automação de Cortes**. Diferente de editores tradicionais, aqui a IA assume o papel de assistente de direção, poupando horas de trabalho manual.

### 🤖 Pipeline de Corte Inteligente
1.  **Extração de Áudio:** O sistema isola o áudio do vídeo original via FFmpeg.
2.  **Análise Semântica (Gemini 2.5-Flash):** A IA analisa o conteúdo, identificando pausas desnecessárias, erros de fala e momentos de maior relevância.
3.  **Orquestração de Mídia:** Traduzi o retorno da IA (JSON de timestamps) em comandos complexos de filtragem e concatenação para o motor do **FFmpeg**, garantindo cortes fluidos sem perda de sincronia.

---

## 🛠️ Stack Tecnológica

* **Runtime:** [Bun](https://bun.sh/) (Foco em performance de I/O e execução de subprocessos rápida).
* **Frontend:** [Next.js 15](https://nextjs.org/) (App Router & TypeScript).
* **Gerenciamento de Monorepo:** [Turborepo](https://turbo.build/).
* **Inteligência Artificial:** [Google Gemini 2.5-Flash](https://ai.google.dev/) (Processamento de contexto e detecção de cortes).
* **Engine de Vídeo:** [FFmpeg](https://ffmpeg.org/) (Executado nativamente em ambiente Linux/WSL2).
* **Autenticação & DB:** Better Auth + PostgreSQL (Prisma) + Upstash Redis.

---

## 🚀 Minhas Contribuições (Destaques Técnicos)

Como desenvolvedor deste fork, implementei melhorias críticas para transformar a experiência de edição:

* **Integração IA-Engine:** Desenvolvimento do pipeline que conecta a Gemini 2.5-Flash ao processamento de vídeo real.
* **Refatoração da Timeline:** Reconstrução da lógica de renderização para suportar múltiplos cortes e overlays de forma fluida.
* **UX de Processamento:** Implementação de feedbacks visuais (loading states) e barras de progresso reais para operações pesadas de exportação.
* **Otimização de Infra:** Migração e ajuste do ecossistema para rodar em **WSL2/Ubuntu**, garantindo que o Bun orquestre o FFmpeg com latência mínima de disco.

---

## 💻 Configuração do Ambiente

### Pré-requisitos
* **Bun** (Runtime oficial do projeto).
* **FFmpeg** instalado e acessível via terminal.
* **Chave de API do Google Gemini** (Para as funções de IA).

### Instalação

1.  **Clone o repositório:**
    ```bash
    git clone [https://github.com/LucasEMourao/OpenCut.git](https://github.com/LucasEMourao/OpenCut.git)
    cd OpenCut
    ```

2.  **Instale as dependências:**
    ```bash
    bun install
    ```

3.  **Configuração de Variáveis de Ambiente:**
    Crie um arquivo `.env` dentro de `apps/web` seguindo o modelo das chaves necessárias (API Keys, Database URL e Auth Secret).

4.  **Inicie o servidor de desenvolvimento:**
    ```bash
    bun dev
    ```

---

## 🛠️ Atribuição e Créditos

Este projeto é um fork aprimorado do [OpenCut](https://github.com/OpenCut-app/OpenCut) original, um editor de vídeo open-source de alta performance.

**Créditos à equipe original:**
- Desenvolvido por [OpenCut-app Team](https://github.com/OpenCut-app).
- Mantenedores principais: [Johnny Chan](https://github.com/tsjohnnychan) e [mazeincoding](https://github.com/mazeincoding).

**Minhas modificações e implementações específicas nesta versão:**
- **AI-Powered Cuts:** Implementação total do módulo de inteligência artificial (Gemini 2.5-flash) para detecção e automação de cortes.
- **Media Engine:** Integração dinâmica com comandos FFmpeg para exportação e processamento.
- **UX/UI Improvements:** Refatoração da Timeline, Galeria de Mídia, e adição de indicadores de carregamento (loading states).