---
phase: 09-frontend-creator-carousel-enhancement-branches
plan: 01
subsystem: i18n / translations
tags: [i18n, translations, carousel, enhancement, pt, es]
dependency_graph:
  requires: []
  provides: ["pt/es translations for all 33 Phase 9 user-facing strings"]
  affects: ["09-02", "09-03", "09-04"]
tech_stack:
  added: []
  patterns: ["English-string-as-key convention", "t() fallback to key for en locale"]
key_files:
  modified:
    - client/src/lib/translations.ts
decisions:
  - "en dictionary left empty per existing convention; t() falls back to the key string for English"
  - "33 new entries grouped under comment marker for discoverability"
  - "Placeholder tokens {n}, {total}, {requested} preserved verbatim per plan spec"
metrics:
  duration: "~5 minutes"
  completed: "2026-04-29T14:14:45Z"
  tasks_completed: 1
  files_modified: 1
---

# Phase 9 Plan 1: Add 33 i18n Strings for Carousel & Enhancement Summary

One-liner: Added 33 EN-keyed PT and ES translation entries for carousel and photo enhancement creator strings, including placeholder-bearing strings and two downstream-consumed aria-label keys.

## What Was Done

Appended 33 new entries to both the `pt` and `es` locale dictionaries inside `client/src/lib/translations.ts`. Each entry uses the English copy as the dictionary key (existing convention — `en: {}` stays empty and `t()` falls back to the key for English). The entries are grouped under a `// Phase 9 — Carousel & Enhancement creator strings` comment in both locale blocks for easy discovery.

## All 33 Strings (EN key → PT → ES)

| # | English Key | PT | ES |
|---|-------------|----|----|
| 1 | Carousel | Carrossel | Carrusel |
| 2 | Multi-slide Instagram carousel | Carrossel do Instagram com múltiplos slides | Carrusel de Instagram con múltiples diapositivas |
| 3 | Enhancement | Aprimoramento | Mejora |
| 4 | AI-enhanced product photo | Foto de produto aprimorada por IA | Foto de producto mejorada con IA |
| 5 | Photo enhancement is currently unavailable. | O aprimoramento de fotos está indisponível no momento. | La mejora de fotos no está disponible en este momento. |
| 6 | How many slides? | Quantos slides? | ¿Cuántas diapositivas? |
| 7 | Choose how many slides to generate... | Escolha quantos slides gerar... | Elige cuántas diapositivas generar... |
| 8 | Upload your photo | Envie sua foto | Sube tu foto |
| 9 | Upload a product photo to enhance... | Envie uma foto de produto para aprimorar... | Sube una foto de producto para mejorar... |
| 10 | Click to upload | Clique para enviar | Haz clic para subir |
| 11 | JPEG, PNG, WEBP · max 5 MB... | JPEG, PNG, WEBP · máx. 5 MB... | JPEG, PNG, WEBP · máx. 5 MB... |
| 12 | Drop your photo here | Solte sua foto aqui | Suelta tu foto aquí |
| 13 | Choose a scenery | Escolha um cenário | Elige un escenario |
| 14 | Select the background environment... | Selecione o ambiente de fundo... | Selecciona el entorno de fondo... |
| 15 | Generate Carousel | Gerar Carrossel | Generar Carrusel |
| 16 | Enhance Photo | Aprimorar Foto | Mejorar Foto |
| 17 | This photo cannot be enhanced... | Esta foto não pode ser aprimorada... | Esta foto no se puede mejorar... |
| 18 | Fewer than half the slides were generated... | Menos da metade dos slides foram gerados... | Se generaron menos de la mitad de las diapositivas... |
| 19 | Creating Your Carousel | Criando seu Carrossel | Creando tu Carrusel |
| 20 | Generating slide {n} of {total}… | Gerando slide {n} de {total}… | Generando diapositiva {n} de {total}… |
| 21 | Enhancing Your Photo | Aprimorando sua Foto | Mejorando tu Foto |
| 22 | Applying scenery and enhancing details… | Aplicando cenário e aprimorando detalhes… | Aplicando escenario y mejorando detalles… |
| 23 | Carousel Ready | Carrossel Pronto | Carrusel Listo |
| 24 | Caption | Legenda | Subtítulo |
| 25 | Only {n} of {requested} slides were generated... | Apenas {n} de {requested} slides foram gerados... | Solo se generaron {n} de {requested} diapositivas... |
| 26 | Save & Close | Salvar e Fechar | Guardar y Cerrar |
| 27 | Generate Another | Gerar Outro | Generar Otro |
| 28 | All slides in this carousel share the same format. | Todos os slides deste carrossel compartilham o mesmo formato. | Todas las diapositivas de este carrusel comparten el mismo formato. |
| 29 | Please upload JPEG, PNG, or WEBP images only. | Envie apenas imagens JPEG, PNG ou WEBP. | Sube solo imágenes JPEG, PNG o WEBP. |
| 30 | Your photo must be under 5 MB. | Sua foto deve ter menos de 5 MB. | Tu foto debe pesar menos de 5 MB. |
| 31 | Photo not accepted | Foto não aceita | Foto no aceptada |
| 32 | Remove photo | Remover foto | Eliminar foto |
| 33 | Slide {n} failed | Slide {n} falhou | Diapositiva {n} falló |

## Key Notes

**en dictionary stays empty:** The existing convention treats English as the fallback — when a key is not found in the target locale dictionary, `t()` returns the key itself (which is already the English text). No entries are added to `en: {}`.

**Placeholder tokens preserved verbatim:** Strings #20 (`{n}`, `{total}`), #25 (`{n}`, `{requested}`), and #33 (`{n}`) carry template tokens. These are preserved exactly as written in both PT and ES. Downstream code does `.replace("{n}", String(value))` substitution at runtime.

**Downstream consumers:**
- String #32 ("Remove photo") is consumed by 09-04 Task 1-F — the enhancement upload preview remove button `aria-label`
- String #33 ("Slide {n} failed") is consumed by 09-03 Task 2-E — failed-slide thumbnail `aria-label`

**CRTR-06 satisfied:** All 33 Phase 9 user-facing strings are available in EN (via fallback), PT, and ES at the moment plans 09-02, 09-03, and 09-04 land their `t()` callsites.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] `client/src/lib/translations.ts` modified and committed (d55e331)
- [x] `grep -c '"Generate Carousel"' translations.ts` returns 2
- [x] `grep -c '"Remove photo"' translations.ts` returns 2
- [x] `grep -c '"Slide {n} failed"' translations.ts` returns 2
- [x] `grep -c '// Phase 9' translations.ts` returns 2
- [x] `npm run check` exits 0
- [x] `en: {}` dictionary remains empty
