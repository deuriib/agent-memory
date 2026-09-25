# Product Brief: Todos — follow-ups para agentes

**ID:** BRIEF-todos
**Initiator:** orchestrator (Montilla)
**Date:** 2026-09-25
**Status:** approved
**Execution_Mode:** subagents (frozen at frame-intent; trivial <15 lines goes by CEO fast-path checkpoint-only, outside methodology)
**Domains-Touched:** [engineering, security, automation/ops]
**Classification:** bounded-initiative (well-scoped intent, 3 vías de creación ya probadas aguas arriba) — announced bounded, ratchet one-way
**Framings-Considered:**
  - F1 Renombrar Actions upstream 1:1 (incl. edges requires/unlocks/gated_by) → más fiel pero sobre-ingeniería para nuestro contrato single-process, YAGNI lo recorta.
  - F2 (recomendado) Todos minimal con parentId opcional, sin grafo de dependencias: status pending→active→done/blocked, frontier = pending∪active priority-ordered, search por title/description, parentId jerárquico. 3 vías: MCP memory_todo_create, REST POST /memory|/agentmemory/todos, Hooks auto-extract desde cuerpos largos. YAGNI: sin edges complejos, sin leases, sin signals.
  - F3 Solo memoria con tag `todo:` → reutiliza Memory pero contamina search y no da status flow pedido en UI.
**Approval:** chat-yes — user (2026-09-25)

## Problem Statement

Los agentes surgen follow-ups durante sesiones — decisions to revisit, files to inspect, tasks blocked on input — que se pierden entre sesiones. La imagen de referencia exige una superficie “No todos tracked yet” con flujo `pending → active → done/blocked`, frontier de lo desbloqueado y listo, búsqueda, y 3 vías de creación. Hoy no existe entidad Todo; upstream llama esto Actions.

## Desired Outcome

Un agente (o humano) crea un todo por MCP, por `curl POST /memory/todos` (y alias `/agentmemory/todos` del screenshot) o por Hooks que auto-extraen de cuerpos largos; lista/filtra por `status/priority/search/frontier/parentId`; mueve status `pending→active→done|blocked`; consulta `frontier` (pending∪active, high→low) y ve “Search todos…” funcionando. Nombre everywhere `todos`, nunca `actions`. Con `parentId` opcional para sub-todos.

## Scope

### In Scope
- Nodo Helix `Todo {todoId,title,description,priority:low|medium|high,status:pending|active|done|blocked,project,sessionId,createdAt,updatedAt,parentId?}` [engineering]
- REST: `POST /memory/todos`, `GET /memory/todos?project&limit&status&priority&search&frontier&parentId`, `GET /memory/todos/:id`, `PATCH /memory/todos/:id`, `DELETE /memory/todos/:id`, `GET /memory/frontier`; alias `/agentmemory/todos|/frontier` [engineering]
- MCP: `memory_todo_create/list/get/update/delete`, `memory_frontier` [engineering][security - bearer عبر _meta]
- Plugin OpenCode: 6 tools `memory/todo_*` + `frontier` con `parentId` [engineering][automation/ops]
- Hooks `hooks/capture.mjs`: auto-extract ≤3 todos desde cuerpos ≥400 con heurística TODO/decision/revisit/inspect/blocked [automation/ops]
- Auth: bearer guard salvo `livez`, nunca loggear secret [security]

### Out of Scope
- Grafo de dependencias `requires/unlocks/gated_by/conflicts_with`, leases, signals/routines upstream — se dejan para P4.3 multi-agent
- Viewer UI completo; solo backend para que la UI del screenshot consuma
- Migración de datos de Actions upstream

## Stakeholders

| Role | Agent | Involvement |
|------|-------|-------------|
| Sponsor | orchestrator | Decision authority |
| Owner | general(vasquez) — Engineering | Delivery ownership |
| Touched | general(barrera) — Security, general(espinoza) — Automation/Ops | Review / sign-off |

## Constraints
- Budget: 0 new deps, HelixDB v3 only, Node builtins
- Timeline: single lane, verifica 243/123/137 existentes verdes
- Regulatory: Ley 172-13 — hooks nunca capturan prompt text, solo títulos sanitizados
- Brand/GTM: nombre `todos` everywhere, ejemplo curl del screenshot usa `/agentmemory/todos` y debe funcionar

## Open Questions
- [x] ¿parentId debe validar existencia? Sí, fail-closed 400 `parent todo not found` — decidido y shippeado
- [ ] ¿Índice dedicado para parentId? Por ahora filtro app-side; medir si lista por padre crece >1k
