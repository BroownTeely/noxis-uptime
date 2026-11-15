# API

## Painel (sessão)

As rotas `/api/*` exigem o cookie de sessão. Requisições que alteram dados exigem o cabeçalho `X-CSRF-Token`, obtido em `app-data` nas páginas.

Principais rotas: `GET/POST /api/monitors`, `GET/PUT/DELETE /api/monitors/:id`, `POST /api/monitors/test` (executa sem salvar), `POST /api/monitors/:id/{pause,resume,run,duplicate}`, `GET /api/incidents`, `GET /api/dashboard/summary`, `GET /api/reports`, `GET /api/reports/export.csv`, `GET/POST /api/channels`.

## API pública v1 (chave de API)

Crie uma chave em Configurações → API. Envie no cabeçalho `Authorization: Bearer nxu_...`.

```bash
curl -H "Authorization: Bearer nxu_xxx" http://localhost:8417/api/v1/status
curl -H "Authorization: Bearer nxu_xxx" -H "Content-Type: application/json" \
  -X POST http://localhost:8417/api/v1/monitors \
  -d '{"name":"Blog","type":"http","target":"https://blog.local","intervalSeconds":60,"timeoutSeconds":10,"retries":2}'
```

Escopos: `read` (consulta) e `write` (criar, alterar e excluir monitores).

## Heartbeat

```bash
curl -fsS "http://localhost:8417/api/push/TOKEN?status=up&msg=backup+ok"
```

Use `status=down` para sinalizar falha. Sem sinal dentro de `intervalo + 30s`, o monitor entra em DOWN.

## Saúde e métricas

- `GET /health`: estado da aplicação e do banco (sem autenticação).
- `GET /metrics`: formato Prometheus (exige chave com escopo `read`).

## Dependências (sessão)

- `GET /api/monitors/:id/dependencies`: dependências, dependentes, estado derivado, causas raiz e árvore.
- `POST /api/monitors/:id/dependencies` com `{"dependsOnId": 3, "required": true}`: adiciona (recusa ciclos e auto-dependência).
- `DELETE /api/monitors/:id/dependencies/:depId`: remove.

## Status pages

- `GET /api/status-pages` e `GET /api/status-pages/:id`: listagem e detalhe (sessão).
- `POST /api/status-pages`, `PUT /api/status-pages/:id`, `DELETE /api/status-pages/:id`: gerenciamento (admin).

Corpo de criação e atualização: `name`, `slug`, `title`, `description`, `isPublic`, `theme` (`dark`, `light` ou `auto`), `accentColor`, `logoUrl`, `faviconUrl`, `customDomain`, flags `show*` e `items: [{monitorId, groupLabel}]` na ordem de exibição.

Páginas públicas: `GET /status/:slug`. Páginas privadas exigem login. Não expõem endereços, configurações ou mensagens técnicas dos monitores.

## Discovery de portas (editor ou superior)

- `GET /api/discovery/ports/info`: lista de portas comuns com nomes de serviço.
- `POST /api/discovery/ports` com `{"host": "192.168.1.10", "ports": "common" | "22,80,8000-8010", "authorized": true}`.

Regras: apenas endereços de rede privada (LAN e loopback); `authorized` precisa ser `true` (registrado na auditoria); até 200 portas por varredura; faixas de no máximo 1000 portas; uma varredura por vez no servidor; 10 varreduras a cada 10 minutos por usuário; conexão TCP simples, sem envio de dados. O resultado é apenas uma sugestão: monitores só são criados com ação explícita do usuário.

## Status pages: link privado

- `POST /api/status-pages/:id/token` (admin): gera um novo token. O link anterior deixa de funcionar.
- Link: `/status/<slug>?token=<token>`. O token não aparece nas listagens da API.
