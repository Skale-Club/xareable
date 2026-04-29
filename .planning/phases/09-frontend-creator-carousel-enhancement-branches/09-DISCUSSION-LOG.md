# Phase 9: Frontend Creator — Carousel & Enhancement Branches - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-29
**Phase:** 09-frontend-creator-carousel-enhancement-branches
**Areas discussed:** Step flow per content type, Scenery picker UX, Per-slide carousel progress, Result handoff

---

## Step flow per content type

### Q1: Content Type step visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Sempre visível (Recomendado) | Primeiro passo sempre exibe os 4 cards. Remove VIDEO_ENABLED. | |
| Só quando >1 tipo disponível | Se admin libera só 1 tipo, pula direto pra esse fluxo. | ✓ (refinada) |
| Sempre visível mas com locks visuais | Tipos sem crédito ficam com badge "Upgrade". | |

**User's response:** "eles ficam sempre visíveis, porém podemos desabilitar um deles ou quase todos a qualquer momento... se eu pedir para deixar so o modulo de post, o campo inicial de selecao nao se aplica, afinal so tem uma opcao, no momento o unico que vai ficar desativado é o video, os outros 3 ativa"

**Notes:** Hybrid of options 1 and 2 — types are admin-toggleable via code-level flag (matching the existing `VIDEO_ENABLED` operational pattern), and the Content Type step is shown only when ≥2 types are enabled. Captured as D-01/D-02/D-03.

### Q2: Carousel branch step ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Reference→Slides→Mood→Text→Logo→Format | Mantém ordem do Image, adiciona Slides. | |
| Slides→Reference→Mood→Format (sem Text/Logo) (Recomendado) | Slide count primeiro; sem Text-on-image (CRSL-10) e sem Logo. | ✓ (defer to recommendation) |
| Reference→Mood→Slides+Format combinado | Combina slide count + ratio num step só. | |

**User's response:** "pense e aca o reconendado, lembrando de fazer tudo em inkgles"

**Notes:** User deferred to recommended option. Captured as D-04..D-07.

### Q3: Enhancement branch step ordering

| Option | Description | Selected |
|--------|-------------|----------|
| Upload→Scenery (Recomendado) | Foto primeiro, depois cenária. | ✓ (defer to recommendation, with addendum on aspect ratios) |
| Scenery→Upload | Cenário primeiro, depois foto. | |
| Combined single-step | Tudo num step só. | |

**User's response:** "faca o recomendado, porem aqui no enrancement, pode ter mais opcoes de aspect ratio"

**Notes:** User accepted recommended Upload→Scenery flow but added a request about aspect ratios — flagged as ambiguous and clarified in Q4.

### Q4 (follow-up): Aspect ratio meaning in Enhancement

| Option | Description | Selected |
|--------|-------------|----------|
| Aceitar uploads em qualquer ratio | Frontend aceita qualquer ratio no upload; backend normaliza pra 1:1 (já funciona). | ✓ |
| Output em multiplos ratios | Resultado final em vários ratios — requer mudança de backend. | |
| Adiável — deixa 1:1 por enquanto | Ignora por agora, defer pra v2. | |

**User's response:** "Aceitar uploads em qualquer ratio"

**Notes:** Captured as D-09 — frontend doesn't restrict aspect ratio on upload, backend ENHC-05 normalization stays. Multi-ratio output deferred.

---

## Scenery picker UX

### Q5: Picker layout

| Option | Description | Selected |
|--------|-------------|----------|
| Grid de cards com thumbnail (Recomendado) | Espelha admin SceneriesCard, grid 1/2/3 cols. | ✓ |
| Lista compacta com thumb pequeno | Linhas com thumb 48x48 + label. | |
| Dropdown com preview em hover | Select padrão, hover mostra preview. | |

**User's response:** "Grid de cards com thumbnail (Recomendado)"

**Notes:** Captured as D-12, D-13, D-14. Mirrors Phase 8 admin pattern.

### Q6: Empty scenery catalog edge case

| Option | Description | Selected |
|--------|-------------|----------|
| Bloquear Enhancement no Content Type step (Recomendado) | Hide Enhancement option, inline note. | ✓ (Claude's Discretion) |
| Permitir entrar mas mostrar empty state | Empty state no step de scenery. | |
| Fallback hardcoded (1 cenária default) | Frontend embute white-studio se vazio. | |

**User's response:** "nao entendi isso"

**Notes:** User asked for clarification. Picked recommended option as Claude's Discretion (D-15) — easily flippable if user disagrees on review.

---

## Per-slide carousel progress

### Q7: Visualization style

| Option | Description | Selected |
|--------|-------------|----------|
| Thumbnails progressivas (Recomendado) | N quadrados, cada um vira thumbnail real quando o slide termina. | ✓ |
| Círculos preenchendo + barra global | N círculos no topo + barra agregada. | |
| Só barra agregada com texto | Igual o flow de image atual. | |

**User's response:** "Thumbnails progressivas (Recomendado)"

**Notes:** Captured as D-16, D-17, D-18. Visual reveal as slides emerge.

---

## Result handoff após generate

### Q8: Carousel completion

| Option | Description | Selected |
|--------|-------------|----------|
| Stay-in-creator com grid de slides + botões | Grid de slides + Save & Close + Generate Another. | ✓ |
| Abrir PostViewer com slide 1 + badge | Reusa flow atual, slide 1 placeholder. | |
| Toast + fechar + ir pra galeria | Toast + redirect /posts. | |

**User's response:** "Stay-in-creator com grid de slides + botões"

**Notes:** Captured as D-19. Decouples Phase 9 from Phase 10 PostViewer slide navigation.

### Q9: Enhancement completion

| Option | Description | Selected |
|--------|-------------|----------|
| Abrir PostViewer normal (Recomendado) | Reusa openViewer({...}). | ✓ |
| Stay-in-creator com before/after | Source vs result lado a lado. | |
| Toast + fechar + ir pra galeria | Toast + redirect. | |

**User's response:** "Abrir PostViewer normal (Recomendado)"

**Notes:** Captured as D-20. Reuses existing image/video pattern.

---

## Claude's Discretion

- **D-15** (empty scenery catalog) — picked block-at-Content-Type approach
- **D-22** (reset on type change) — picked full reset for predictability

## Deferred Ideas

- Multi-aspect-ratio Enhancement output (would require backend change in `enhancement.service.ts`)
- Admin UI for Content Type enabling (operational code flag is sufficient for v1.1)
- All v2 items pre-recorded in REQUIREMENTS.md §v2 (CRSL-V2-x, ENHC-V2-x, SHRD-V2-x)
