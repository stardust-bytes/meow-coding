---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.

## Project-Specific Constraints (<Project Name>)

This skill is used within the **<Project Name>** project. Every implementation MUST follow these rules:

### 1. Use Base Components, Never Raw HTML

All UI elements MUST use the project's base components. **Never** write raw HTML equivalents:

| Base Component | Use instead of |
|---|---|
| `BaseButton` | `<button>`, `<a>` styled as button |
| `BaseInput` | `<input>`, `<textarea>` |
| `BaseSelect` | `<select>`, custom dropdown |
| `BaseCheckbox` | `<input type="checkbox">` |
| `BaseModal` | Custom overlay dialog |
| `BaseTable` | `<table>`, raw HTML table |
| `BaseCard` | `<div>` styled as card |
| `BaseBadge` | `<span>` styled as badge |
| `BaseTabs` | Custom tab navigation |
| `BaseToast` | Custom notification popup |
| `BaseLoading` | Custom spinner/skeleton |
| `BaseEmptyState` | Custom empty placeholder |
| `BasePagination` | Custom pagination UI |
| `BasePopover` | Custom tooltip/dropdown |
| `BaseConfirmDialog` | `window.confirm()` |

If a needed base component does not exist, create it in `frontend/src/components/`, then use it.

### 2. Follow the Project's Existing Theme

- Always use **Tailwind CSS classes** with **CSS variables** from the project theme (`var(--primary)`, `var(--border)`, `var(--bg)`). Never hardcode colors.
- Use **vue-i18n** (`t()` from `useI18n()`) for ALL user-facing text. Never hardcode strings.
- Follow the styling patterns of existing pages in `frontend/src/modules/`. Check neighboring components before implementing.
- Use `<script setup>` syntax for all Vue components.
- Use TypeScript everywhere.

### 3. Match Existing Patterns Before Innovating

- Before writing new code, read at least one existing page or component in the same module to understand conventions (imports, stores, composables, icon libraries, layout patterns).
- This project uses **`vue-icons-plus/hi2`** (Heroicons v2 outline) for icons. Check which icon set existing pages use before choosing icons.
- For CRUD list screens, follow the **Global Frontend CRUD List UI Baseline** defined in `AGENTS.md`.

### 4. Do Not Invent Without Asking

- If the user's request is ambiguous, ask clarifying questions with concrete options.
- If you need a new component, pattern, or dependency beyond what exists in the project, flag it and ask before proceeding.
- If the design direction could go multiple ways, propose 2-3 options with tradeoffs and recommend one.
- Never add new npm packages without explicit user approval.

User requests:
$ARGUMENTS