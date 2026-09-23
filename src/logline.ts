/**
 * src/logline.ts — print-site single-line guard (CWE-117 / SEC-P121-01).
 *
 * WHY: log forgery (CWE-117) — a stored newline-bearing value interpolated
 * into a rendered stdout/stderr line can forge a second (governance/audit)
 * line out of one output event. EVERY value interpolated into a rendered
 * line passes through `oneLine` first: collapse whitespace runs (incl.
 * embedded `\n`, `\r`, `\r\n`, tab) to a single space + trim. It applies
 * ONLY to the PRINTED form — the query/request still receives the verbatim
 * value (print/query separation), so a newline-bearing stored project name
 * can no longer forge a second rendered line.
 *
 * Same transform as the P3.1 delete-reason guard in `src/server.ts`, kept
 * as a separate site ON PURPOSE: unifying the two guards is tracked backlog
 * SEC-P121-03 (harden together so they never drift). Extracted from
 * `scripts/purge.ts` (which runs `main()` at module top level, so importing
 * it for a test would RUN a purge) — behavior is byte-identical to the
 * original module-private helper.
 *
 * NOT hardened here: `\s+` leaves non-whitespace line-breakers (U+0085 NEL,
 * C1 controls, ESC) intact — that residual is SEC-P121-03 backlog, shared
 * with the server guard. Regression tests must NOT pin U+0085 behavior.
 */
export function oneLine(value: string | number | boolean): string {
  return String(value).replace(/\s+/g, " ").trim();
}
