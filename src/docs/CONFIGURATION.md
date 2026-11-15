# Configuração

Variáveis de ambiente (arquivo `.env`):

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | 8417 | Porta HTTP (o instalador gera uma aleatória de 4 dígitos) |
| `HOST` | 0.0.0.0 | Endereço de escuta |
| `NODE_ENV` | production | `production` ou `development` |
| `APP_SECRET` | aleatório | Segredo da instalação. Defina sempre em produção |
| `DATABASE_PATH` | storage/database/noxis.db | Arquivo SQLite |
| `COOKIE_SECURE` | false | `true` quando servido por HTTPS |
| `TRUST_PROXY` | 1 | Número de proxies confiáveis à frente (Cloudflare Tunnel, nginx) |
| `MAX_CONCURRENT_CHECKS` | 20 | Verificações executadas em paralelo |
| `DOCKER_SOCKET` | vazio | Socket Docker para monitores Docker (somente leitura) |

Configurações da interface (Configurações → Geral, Monitoramento, Segurança e rede):

- Nome da instalação e fuso horário (padrão `America/Bahia`).
- Intervalo, timeout, tentativas e limite de latência padrão.
- Dias de alerta para certificados SSL.
- Retenção do histórico em dias (checagens e eventos mais antigos são removidos).
- Permitir monitorar redes privadas. Destinos de link-local e metadados de nuvem (169.254.0.0/16) são sempre bloqueados.

## Segurança

- Sessões em cookie `httpOnly` e `SameSite=Lax`; apenas o hash do token é armazenado.
- Proteção CSRF em todas as requisições que alteram estado do painel.
- Rate limit no login (10 tentativas por 15 minutos) e nas rotas de API.
- Cabeçalhos via Helmet com CSP restritiva.
- Segredos de monitores (senhas, tokens, cabeçalhos de autorização) são mascarados nas respostas e nunca gravados em logs de auditoria.
- Validação de destino antes de cada requisição, inclusive em cada redirecionamento.

## Canais de notificação

- **Discord**: URL do webhook (`https://discord.com/api/webhooks/...`). Menções opcionais por usuário ou cargo.
- **ntfy** (self-hosted ou público): endereço do servidor (ex.: `http://ntfy.lan:8080`), tópico, prioridade (1 a 5) e token opcional. Quedas usam prioridade alta; recuperações, prioridade normal.
- **Webhook HTTP**: envia JSON para qualquer serviço (n8n, Home Assistant, scripts). Com segredo configurado, cada envio traz `X-Noxis-Signature: sha256=<hmac>`, calculado sobre o corpo bruto. Para validar no receptor:

```python
import hmac, hashlib
expected = "sha256=" + hmac.new(SEGREDO.encode(), corpo_bruto, hashlib.sha256).hexdigest()
ok = hmac.compare_digest(expected, cabecalho_x_noxis_signature)
```

Destinos em redes privadas são permitidos enquanto "Permitir monitorar redes privadas" estiver ativo. Endereços de metadados de nuvem (169.254.0.0/16) são sempre bloqueados. Redirecionamentos não são seguidos.

Segredos (tokens, segredos de assinatura e URLs de webhook do Discord) nunca são exibidos após salvos.

## Modo de simulação

`NOXIS_NOTIFY_DRY_RUN=true` registra as entregas como "simulado" no histórico do canal, sem contatar nenhum destino. Use em testes ou para validar regras de alerta sem acesso à internet.

## Limiares de SSL

Configurações → Monitoramento → "Alertas de vencimento SSL": lista de dias (padrão `30, 14, 7, 3, 1`). Um alerta é enviado a cada degrau mais urgente. Quando o certificado é renovado, o ciclo recomeça. O controle de degraus fica em memória: após reiniciar o serviço, o degrau atual pode gerar um alerta novamente.

## Backup do banco

Configurações → Sistema → "Criar backup agora". O arquivo é gerado com `VACUUM INTO`, seguro com o sistema em uso, e fica em `storage/backups/`. Os 10 mais recentes são mantidos.

Restauração (com o serviço parado):

```bash
sudo systemctl stop noxis-uptime      # ou: docker compose stop
cp storage/backups/noxis-AAAAMMDD-HHMMSS.db storage/database/noxis.db
sudo systemctl start noxis-uptime     # ou: docker compose start
```

## Discovery de portas

O discovery usa uma conexão TCP simples em portas da sua rede. Ele não envia payloads, não tenta autenticação e não identifica serviços por banner. O nome do serviço vem apenas do número da porta (por exemplo, 22 é SSH e 25565 é Minecraft), por isso é uma estimativa.

A varredura é recusada para endereços públicos. Ela só deve ser usada na sua própria rede. Se a opção "Permitir monitorar redes privadas" estiver desativada, a varredura de redes privadas também é recusada.

## Telegram

Canal do tipo Telegram usa um bot criado com o @BotFather. Informe o token (formato `123456:ABC...`) e o ID do chat ou o @canal. Envie uma mensagem ao bot antes de testar, para que o chat exista.

## Monitor de API

Tipo "API (HTTP avançado)". O corpo da requisição precisa ser JSON válido. Em "Chaves obrigatórias", informe os caminhos que devem existir na resposta (por exemplo, `status, data.id`). A API key é enviada no cabeçalho informado (padrão `X-Api-Key`) e nunca aparece depois de salva.
