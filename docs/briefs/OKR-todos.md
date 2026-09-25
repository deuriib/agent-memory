# OKRs: Todos — follow-ups para agentes

**Period:** Q4 2026
**Owner:** orchestrator

## Objective 1: Follow-ups no se pierden entre sesiones

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-1.1 Crear todo por 3 vías | 0 vías | 3 vías (MCP curl Hooks) | `memory_todo_create` 201, `POST /memory/todos` 201 + alias `/agentmemory/todos` 201, hook Stop auto-extract ≥1 en cuerpo ≥400 |
| KR-1.2 Listar/buscar/frontier | 0 | `GET /memory/todos?search=ship` hit + `GET /memory/frontier` = pending∪active priority-ordered | curl + store listTodos |
| KR-1.3 Status flow pedido en screenshot | 0 | pending→active→done/blocked cierra y frontier excluye done/blocked | PATCH status + frontier count |

## Objective 2: Jerarquía y calidad sin deuda

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-2.1 parentId opcional | sin campo | `POST {parentId}` vincula, `GET ?parentId=` filtra, `PATCH {parentId:null}` limpia, `parentId=self` 400 | REST + MCP + plugin e2e |
| KR-2.2 Verde sin regresión | 243/123/137 verdes | siguen verdes | `npm run verify` 243, `verify-lifecycle` 123, `verify-capture` 137, `typecheck` 0 |
| KR-2.3 Plugin paridad | 5 tools memory_* | 11 tools memory_* = 5 + 6 todo/frontier con parentId | `memory/todo_create|list|get|update|delete|frontier` en plugin |
