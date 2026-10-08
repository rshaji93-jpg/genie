# Personal AI Genie - Development Directives

## Component Architecture Rules
- Keep `frontend/src/app/page.tsx` minimal as an entry point.
- Place all UI modules inside `frontend/src/components/genie/`:
  - `HeaderBar.tsx`: Navigation, Ink Black palette (`#070b12`), Ocean Blue borders (`border-cyan-900/30`), and Rainbow gradient accents.
  - `DynamicTeamModal.tsx`: Room governance with dynamic capacity modes (pair, squad, custom limit, unlimited) instead of fixed 1/50 capacity.
  - `SlideDockDrawer.tsx`: Collapsible bottom drawer for secondary tools (VIP Unlimited, Flashcards, Study Engine, Share Room) to avoid chat dock overlap.
  - `WorkspaceContainer.tsx`: Coordinates layout state, responsive viewports, and primary message dispatch.
- Always use TypeScript with Tailwind CSS.