# Brief: P4 ops control-plane (CLI + multi-instance + data-dir)

**ID:** BRIEF-p4-ops-control-plane
**Classification:** bounded-initiative (elicitado 2026-09-24; aprobado por orquestador en-chat)
**Domains-Touched:** engineering (R1), automation/ops (R8); cross-cutting: security (R2 — doctor jamás imprime secretos)
**Execution_Mode:** subagents (frozen; máx 2 lanes paralelas — INV-006)
**Approval:** 2026-09-24 — aprobado en chat antes de escribir este archivo (el BRIEF se persiste aquí sólo como ancla de referencia para las fases siguientes)
**Source:** `ROADMAP.md` P4.1 / P4.3 / P4.4

## 1. Problem

El repo sólo se opera con npm scripts sueltos: no hay `start/stop/status/doctor`, una
segunda instancia obligaría a editar código (los puertos están fijos en `src/server.ts`
y `helix.toml` sólo define `[local.dev]`), y la persistencia vive en un volumen MinIO
opaco — sobrevive restarts pero no hay directorio elegible ni respaldable.

## 2. Outcome

Un binario `bin/agent-memory.mjs` (entrada `bin` en `package.json`, cero dependencias
nuevas) que gestiona instancias por slots de 4 puertos y datos en un directorio explícito.

## 3. Scope (3 secciones, 1 solo gate)

1. **P4.1 CLI** — subcomandos `start`, `stop`, `status`, `doctor`. `start` hace spawn de
   `helix start` + `src/server.ts` del slot; `stop` apaga ambos sin tocar instancias
   ajenas; `status` reporta salud por slot; `doctor` verifica: `healthz` de Helix y REST
   del slot, presencia del bearer secret (flag, nunca el valor), storage/data-dir, y
   puertos ocupados por upstream con hint "NEVER kill".
2. **P4.3 Multi-instancia** — slots de 4 puertos consecutivos derivados de `--slot N`
   (instancia 1 → 3111 REST + 6969 Helix + 2 reservados; instancia 2 → bloque siguiente).
   Puertos derivados vía `AGENT_MEMORY_PORT` / `helix start --port` / `HELIX_URL` —
   **cero edición de código**; segunda instancia Helix vía `helix add local --name slotN`.
3. **P4.4 Data-dir** — `AGENT_MEMORY_DATA_DIR` (default `~/.local/share/agent-memory/<instancia>/`)
   pasado como `HELIX_DATA_DIR` a cada instancia. Migración de la dev existente (MinIO)
   fail-closed: `doctor --migrate` con dry-run + backup obligatorio; el volumen MinIO
   viejo nunca se destruye.

## 4. OKRs

- **KR1:** `agent-memory start|stop|status|doctor` funcionan sobre la instancia dev
  existente con evidencia de sesión (salidas de los 4 comandos); `doctor` distingue
  healthy / upstream-ocupado / Helix-abajo.
- **KR2:** Una segunda instancia (`--slot 2`) levanta y round-trippea (`remember` →
  `search`) en su quartet sin tocar ninguna línea de código fuente; la instancia 1
  sigue intacta; evidencia en `TEST_MATRIX.md`.
- **KR3:** Un `--data-dir` explícito sobrevive `helix restart` con evidencia
  (save → restart → search), la migración de la dev pasa dry-run + backup verificables,
  y README documenta ruta, respaldo y recuperación.

## 5. Constraints

- Jamás matar ni escribir al upstream en 3111/3112/3113 (regla permanente).
- Cero dependencias nuevas; `typecheck` + suites existentes verdes.
- Default 3111 del servidor intacto (paridad de contrato); los slots son derivación,
  no cambio de default.
- Ley 172-13: salida de `doctor` sin PII ni secretos; migración sin exponer contenido
  de memorias.
- MCP stdio intacto (sin puerto nuevo); runner no relaja `AGENT_MEMORY_SECRET`.

## 6. Out of Scope

P4.2 (docker-compose/k8s), P4.5 (npm publish), P4.6 (zero-container), P3.3 viewer
(los 2 slots reservados sólo reservan el espacio), MCP-HTTP.

## 7. Framings-Considered

1. Quartet = **slots fijos de 4 puertos** (elegido) vs par-de-puertos vs paridad upstream 3111/3112/3113.
2. **Binario Node `bin/`** (elegido) vs bash vs npm-scripts-only.
3. **`HELIX_DATA_DIR` como única vía con migración fail-closed** (elegido) vs sólo-instancias-nuevas vs documentar volumen MinIO.

**Falsifiable bet:** si `HELIX_DATA_DIR` no puede sustituir al MinIO gestionado de Helix
sin pérdida (o el CLI de Helix no lo respeta en la versión v0.0.6), el framing 3 cae y se
debe degradar al framing 3b (data-dir sólo para instancias nuevas). Riesgo irreversible
declarado: la migración mueve datos vivos — dry-run + backup obligatorio, volumen MinIO intocado.

## 8. Traceability

| Roadmap | OKR | Spec |
|---|---|---|
| P4.1 CLI | KR1 | SPEC-P4-OPS (engineering) + SPEC-P4-OPS-RUNBOOK (automation) |
| P4.3 Multi-instance | KR2 | SPEC-P4-OPS (engineering) |
| P4.4 Data-dir | KR3 | SPEC-P4-OPS (engineering) |
