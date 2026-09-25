# OKRs: Brainy — Segundo Cerebro CODE/PARA

**Period:** Q4 2026 (MVP 10 semanas — PRD §11 F1-F5)
**Owner:** orchestrator (Montilla)
**Brief Reference:** BRIEF-brainy

## Objective 1: Marca Brainy sin deuda agentmemory/iii

*Renombrar el producto de punta a punta y limpiar la herencia iii-engine, sin romper a usuarios actuales más allá de un breaking change documentado con alias decompat.*

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-1.1 Rename atómico | `package.json:2` name `agent-memory`, `helix.toml:2` `agent-memory`, `bin/agent-memory.mjs`, env `AGENT_MEMORY_*`, docs con `agentmemory`/`iii` | `package.json` name `brainy`, `helix.toml` project `brainy`, `bin/brainy.mjs` (+ symlink/dual bin compat 1 versión con deprecation warning), env `BRAINY_*` con alias `AGENT_MEMORY_*`, 0 ocurrencias `iii-engine`/`agentmemory` fuera de compat layer | `grep -r "agentmemory\|iii-engine" --exclude-dir=.helix --exclude-dir=node_modules` + `grep -r "AGENT_MEMORY_"` sólo en compat alias + `git diff --stat` + `npm run typecheck` |
| KR-1.2 Docs & brand | README/CONTRACT/CHANGELOG posicionan `agent-memory` plano | README reescrito Brainy (segundo cerebro CODE/PARA), CONTRACT Brainy v1, CHANGELOG breaking change entry, `docs/CONTRACT.md` actualizado con nuevos labels | Diff `README.md` + `docs/CONTRACT.md` + `CHANGELOG.md` + marketing sign-off |

## Objective 2: CODE/PARA v1 operativo sobre HelixDB (<10ms híbrido)

*Capturar, organizar (PARA), destilar y expresar conocimiento con retrieval híbrido unificado grafo+vector+BM25.*

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-2.1 Captura + esquema | Modelo plano Session/Memory/Concept 384-dim | Esquema HelixQL PRD §5.2 vivo: N::Note/Project/Area/Resource/Archive + compat Memory/Agent/Context, E::BELONGS_TO/REFERENCES/SUPERSEDES/ABOUT/APPLIES_TO/CAPTURED_BY, vector index 1536 dims (configurable), `bootstrap` crea 9-10 índices y `searchByText` responde | `npm run bootstrap` → `READY` + `helix query` de esquema + `TEST_MATRIX.md` §F1 |
| KR-2.2 Organize PARA automático | Sin clasificación PARA | `brainy add`/`POST /v1/notes` auto-clasifica 100% notas en P/A/R/Ar vía embeddings+heurística, `brainy move` dinámico, `RELATES_TO` auto (>0.85 sim) | `verify` F2: add 20 notas variadas → 100% con `BELONGS_TO` a PARA + `npm run eval` scorecard sin regresión |
| KR-2.3 Destill + Express + híbrido | Búsqueda BM25/vector separada | `brainy distill` resumen 1 línea (LLM configurable), `brainy context --project` + `brainy export --format markdown` Obsidian vault, `POST /v1/search` híbrida (vector+grafo+BM25) <10ms a 10k nodos, `GET /v1/context/:project` con graph_path | `verify` F3: distill+SUPERSEDES round-trip + export markdown válido + `scripts/eval.ts` hybrid R@5 no menor que baseline + p95 <10ms en `docs/benchmarks/SCORECARD.md` |

## Objective 3: Integración nativa con agentes (MCP + compat agentmemory)

*Claude Code/Cursor consumen Brainy sin API keys externas, y usuarios `agentmemory` migran sin re-escribir agentes.*

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-3.1 MCP Brainy | 11 tools `memory_*` sobre stdio | Servidor MCP Brainy stdio con `brainy_search`/`brainy_capture`/`brainy_link`/`brainy_reality_check` (+ alias `memory_*` compat), handshake expone 4+ tools nuevas, 200ms p95 | `npm run verify-skills` + MCP handshake `tools/list` + live round-trip `brainy_search`/`brainy_capture` |
| KR-3.2 Compat & migración | Sin migración SQLite | `brainy.compat.agentmemory` migra `memories.statement→Memory.statement`, `objects.name→Resource.name`, `contexts.name→Context.name`, `links`→edges; `POST /v1/memory` acepta payload legacy; agentes `@agentmemory/mcp` cambian sólo URL | `scripts/import-transcript` migrado → `remember` round-trip idéntico + `verify` legacy payload test + `docs/benchmarks/SCORECARD.md` |

**Gate links:** SPEC-brainy-foundation (R1) · SPEC-brainy-para (R1) · SPEC-brainy-graph (R1) · SPEC-brainy-mcp (R1) · SPEC-brainy-ops (R8) · ARCHITECTURE.md + SECURITY_REVIEW (R2/R4).
