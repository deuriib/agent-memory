# OKRs: P4 ops control-plane (CLI + multi-instance + data-dir)

**Period:** Q3 2026
**Owner:** orchestrator
**Brief Reference:** BRIEF-p4-ops-control-plane

## Objective 1: Operable con un CLI real (P4.1)

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-1.1 (KR1) | Sin `start/stop/status/doctor` — sólo npm scripts sueltos | Los 4 subcomandos funcionan sobre la instancia dev con evidencia de sesión; `doctor` distingue `healthy` / `upstream-holds-port` / `helix-down` (contrato cerrado 0/1/2/3/4/5, precedencia 5>4>3>1>0) | Salidas verbatim + exit codes en `TEST_MATRIX.md` §P4 OPS |

## Objective 2: Segunda instancia sin editar código (P4.3)

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-2.1 (KR2) | Una segunda instancia exige editar código/puertos a mano | `--slot 2` levanta y round-trippea (`remember` → `search`) en su quartet (3114/6970/3115/3116) con `git diff` vacío sobre `src/ db/ hooks/ plugins/ scripts/`; instancia 1 intacta | `TEST_MATRIX.md` KR2 row + `git diff --stat` |

## Objective 3: Datos en un directorio explícito y respaldable (P4.4)

| Key Result | Baseline | Target | Measurement |
|------------|----------|--------|-------------|
| KR-3.1 (KR3) | Volumen MinIO opaco — sin directorio elegible ni respaldable | `--data-dir` explícito sobrevive `helix restart` (save → restart → search); migración dry-run + backup verificables con volumen MinIO intacto; README documenta ruta, respaldo y recuperación | `TEST_MATRIX.md` KR3 row + README diff + evidencia de backup |

**Gate links:** SPEC-P4-OPS (R1) · SPEC-P4-OPS-RUNBOOK (R8) · ARCHITECTURE.md (contrato canónico).
