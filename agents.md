# Status do Projeto: Editor Simplificado

Este arquivo rastreia o progresso do desenvolvimento do editor de vídeo simplificado.

## Histórico de Alterações

- **Branch Criada:** `simplified-editor` foi criada a partir da `staging` para isolar nosso trabalho.
- **Plano de Ação:** O plano de desenvolvimento foi detalhado e salvo em `passoapasso.md`.
- **Passo 1 (Autenticação):** Determinado como não aplicável para a versão atual do código.
- **Passo 2 (Redis):** A dependência do Redis para limitação de requisições foi removida com sucesso. A lógica foi substituída por uma implementação "falsa" que sempre permite as requisições.
- **Passo 3 (Extração de Áudio - Lógica):** A lógica principal de extração de áudio foi implementada:
    - A estrutura de dados `MediaItem` (em `media-store.ts`) foi atualizada para incluir um campo `extractedAudioUrl`.
    - A função `processMediaFiles` (em `media-processing.ts`) foi modificada para, ao receber um vídeo, chamar a função `extractAudio` e popular o novo campo `extractedAudioUrl`.
- **Passo 3 (Extração de Áudio - UI):** A interface do editor foi modificada para exibir o resultado da extração de áudio.
    - O componente `<AudioWaveform />` foi adicionado à página do editor.
    - A lógica foi implementada para obter a `extractedAudioUrl` do vídeo carregado e passá-la para o componente de forma de onda.
- **Passo 4 (Detecção Automática de Cortes com IA):** Implementada funcionalidade avançada de edição assistida por IA:
    - Criado módulo `apps/web/src/lib/ai/autoCut.ts` com a função principal `detectAutomaticCuts()`.
    - Implementada integração com API do Gemini para análise de áudio e identificação de cortes ideais.
    - Adicionado botão "Detect Automatic Cuts" à barra de ferramentas do timeline.
    - Implementada lógica para extrair áudio dos elementos selecionados e aplicar os cortes identificados pela IA ao timeline.
    - Garantida manutenção do histórico de desfazer/refazer e limpeza adequada de recursos.
- **Passo 4 (Refatoração Timeline - Movimento):** A lógica de Drag & Drop foi totalmente reescrita.
    - Criado hook `useTimelineDrag` para gerenciar o "Ghost" (visual) separadamente da lógica de drop.
    - Criado hook `useInternalDrag` para mover clipes existentes.
    - Implementado **Magnetic Snap Suave**: Clipes são atraídos por bordas próximas (15px).
    - Implementado **Prevenção de Colisão**: "Free Drag, Strict Drop". Se soltar em cima de outro, o movimento é revertido.
- **Passo 5 (Refatoração Timeline - Redimensionamento):** A lógica de Trim foi modernizada.
    - Criado hook `useTimelineResize` substituindo a lógica antiga.
    - Implementado **Wall Clamping**: O redimensionamento "bate na parede" do clipe vizinho e para.
    - Corrigido bug visual onde a linha guia azul (Snap Line) ficava invisível devido a `overflow: hidden`.
- **Passo 6 (Otimização Inicial):** Limpeza massiva de logs.
    - Removidos logs de debug (`mousemove`, `PLAYHEAD DEBUG`) que causavam gargalo na thread principal durante a rolagem.

## Status Atual

**Próximo Passo:** Teste de Usuário (Beta). A refatoração do Core da Timeline (Mover/Cortar) está concluída e estável. Otimizações avançadas de performance (Direct DOM) foram postergadas para manter a estabilidade do código.

- **Passo 7 (UI Polish):** Corrigida a barra de progresso de upload (adicionados marcos intermediários em `processMediaFiles`).
- **Passo 8 (Auto-Cut Strategy Pivot):** Refatorado o Auto-Cut para adicionar clipes à **Galeria de Mídia** em vez do Timeline. Isso previne bugs de sobreposição e travamentos do navegador.

**Status:** Refatoração Completa. Pronto para Teste Beta.

Finalizamos a implementação da extração de áudio, exibição da forma de onda e detecção automática de cortes com IA. O próximo passo é executar a aplicação e testar o fluxo completo: selecionar elementos de mídia, aplicar a detecção automática de cortes com IA e verificar se os trechos otimizados são adicionados corretamente ao timeline.

## AI Feature Guidelines (Automatic Cut Detection)
- **System Prompt Integrity**: The `systemPrompt` variable in `autoCut.ts` is highly tuned. **DO NOT** shorten, optimize, or modify it without an explicit user request.
- **API Endpoint**: The project relies on **Google Gemini `v1beta`**. Do NOT switch to `v1` (stable) as it does not support the required multimodal audio input for the `gemini-2.5-flash` model.
- **Frontend Logic**: When modifying `applyCutsToTimeline`, always check for **stale state**. Use `useTimelineStore.getState()` inside async flows instead of capturing the store variable at the beginning.

## Export & Rendering Guidelines
- **Gap Handling**: FFmpeg is extremely sensitive to gaps. Any export logic MUST sanitize the timeline by forcing `startTime = previousEndTime` for all sequential clips. Never rely on raw user placement for the final render.
- **FFmpeg Concatenation**: Do NOT use the `concat` demuxer (text file list). ALWAYS use `filter_complex` to ensure audio/video synchronization and rotation metadata preservation.

## Backend Architecture Guidelines
- **Upload Logic**: NEVER use `fileManager.uploadFile` in this Bun environment. ALWAYS use the manual `fetch` implementation with `X-Goog-Upload-Command`.
- **MIME Types**: The frontend extracts audio, so the backend MUST treat inputs as `audio/mpeg` for the AI, even if the original file was `.mp4`.

## Timeline Architecture Guidelines
- **Virtualization**: The `TimelineCanvas` uses windowing to render only visible clips. Any changes to rendering logic MUST preserve this optimization. `TimelineTrackContent` receives a `visibleWindow` prop and filters elements accordingly.
- **Ghost Dragging**: Dragging logic is split between `DraggableMediaItem` (sets `externalDragItem` in store) and `TimelineCanvas` (renders the ghost). Do NOT rely on the browser's default drag image for timeline items.