## Diário de mudanças da sessão atual

### 1. Corrigindo a importação do FFmpeg
- O `ffmpeg.wasm` não carregava por causa do bundle UMD antigo; trocamos para a versão compatível e servimos via `/public/ffmpeg`, convertendo em `Blob` com `toBlobURL`. 
- Adicionamos um carregamento com mutex (`ffmpegLoadingPromise`) para evitar `setLogger` undefined quando dois componentes chamam `initFFmpeg` ao mesmo tempo.
- O worker agora recebe os assets via URL absoluta (com `window.location.origin`) e todos os arquivos temporários são gravados na trail do ffmpeg (sem depender da rede).

### 2. Exportação do timeline (vídeo + áudio + texto)
- Substituímos o antigo botão de exportar (que abria o Rickroll) por um modal com confirmação e progresso.
- Renderizamos todos os clipes de vídeo sequenciais, redimensionando e centralizando para caber no canvas do projeto.
- Faixa de áudio opcional: corta cada trecho, concatena e mistura com o vídeo final.
- Cada caixa de texto vira um PNG transparente, fica em loop no tempo certo e entra no `filter_complex` do FFmpeg.
- Baixamos o MP4 final com `downloadBlob` e limpamos os arquivos temporários dos processos.

### 3. Melhorias secundárias
- Exportar MP3 (botão "Separate audio") adiciona o arquivo automaticamente à biblioteca.
- WaveSurfer ignora `AbortError` quando o preview do áudio é destruído.
- Criamos utilitário `timeline-export.ts` com validações (apenas uma faixa de vídeo/audio sem gaps) e mensagens claras.

Tudo isso está em TypeScript no app Next.js (ramo `simplified-editor`).

### 4. Detecção Automática de Cortes com IA
- Criado módulo `apps/web/src/lib/ai/autoCut.ts` com funcionalidades de análise automática de áudio.
- Implementada integração com API do Gemini para identificação de segmentos de áudio de alta qualidade.
- Adicionado botão "Detect Automatic Cuts" ao toolbar do timeline para ativar a funcionalidade.
- Implementada lógica para extrair áudio de elementos selecionados e aplicar cortes sugeridos pela IA ao timeline.
- Adicionada lógica para processar e inserir automaticamente os trechos otimizados na linha do tempo.
- Garantida compatibilidade com sistema de desfazer/refazer e limpeza adequada de recursos.

### Added
- **AI Auto-Cut Feature**: Integrated Google Gemini API (`v1beta`) to analyze audio and detect optimal video cuts.
- **Robust API Handler**: Implemented `/api/gemini` with proper error handling, markdown cleaning, and JSON parsing.

### Fixed
- **Timeline Rendering Bug**: Fixed a critical logic error in `applyCutsToTimeline` where a "falsy" filter (`.filter(el => el.startTime)`) incorrectly removed the first clip (at 0s), causing all subsequent clips to stack on top of each other.
- **State Management**: Fixed `stale state` and `null object` (ts:2531) errors by accessing `useTimelineStore.getState()` directly at the moment of insertion.
- **AI Hallucination**: Fixed a bug where the AI was ignoring real files and using example filenames (`take_1.mp3`) by injecting real filenames into the prompt.
- **API Reliability**: Solved 404/400/503 errors by enforcing the `gemini-2.5-flash` model on the `v1beta` endpoint.
