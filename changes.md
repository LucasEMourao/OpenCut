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
