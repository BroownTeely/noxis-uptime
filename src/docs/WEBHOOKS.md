# Webhooks Discord

1. Crie um webhook no canal do Discord (Configurações do canal → Integrações → Webhooks).
2. No Noxis Uptime, abra Webhooks → Novo webhook, cole a URL e escolha os eventos.
3. Opcional: informe IDs de usuários ou cargos para menção e escolha em quais eventos mencionar.
4. Use a pré-visualização para conferir o embed e "Enviar teste" para validar a entrega.

Eventos: monitor offline, recuperado, latência elevada, SSL próximo do vencimento, incidente aberto/atualizado/resolvido, início e fim de manutenção, pausado, retomado e falha de heartbeat.

Cores: vermelho (DOWN), verde (recuperação), amarelo (alerta SSL), azul (manutenção), laranja (latência), cinza (informativo).

Entrega: cada evento é publicado uma vez por transição de estado. Enquanto um monitor permanece offline, nenhuma nova mensagem é enviada. Falhas transitórias (5xx, rede) são reenviadas com backoff; HTTP 429 respeita `retry_after`. Erros permanentes (4xx) não são repetidos. O histórico de envios fica no painel do canal.
