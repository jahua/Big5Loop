# Debug Chat with curl

## N8N direct

```bash
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:5678/webhook/careloop-turn \
  -H "Content-Type: application/json" \
  -d '{"session_id":"550e8400-e29b-41d4-a716-446655440000","turn_index":1,"message":"hello","context":{"language":"en","canton":"ZH"}}'
```

## Via Next.js API

```bash
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:3003/api/chat \
  -H "Content-Type: application/json" \
  -d '{"session_id":"550e8400-e29b-41d4-a716-446655440000","turn_index":1,"message":"hello","context":{"language":"en","canton":"ZH"}}'
```

## Hybrid memory quick check (PostgreSQL + pgvector)

```bash
docker exec -it docker-db-1 psql -U careloop -d careloop -c "SELECT COUNT(*) AS rows FROM personality_memory_embeddings;"
```
