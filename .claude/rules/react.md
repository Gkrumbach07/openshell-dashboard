---
description: React component, hook, and page conventions for OpenShell Dashboard
globs: "frontend/**/*.tsx,frontend/**/*.ts"
alwaysApply: false
---

# React Conventions

## Components

Functional components only. `type` for props (not `interface`). Default-export components, named-export hooks/utils.

```tsx
type SandboxListProps = {
  workspace: string;
  onSelect?: (name: string) => void;
};

const SandboxList: React.FC<SandboxListProps> = ({ workspace, onSelect }) => { ... };
export default SandboxList;
```

- `~/` path alias maps to `frontend/src/`
- PascalCase files for components, camelCase for hooks
- `data-testid` on interactive and testable elements
- Import directly from source modules, not barrel `index.ts` re-exports

## Page components must be exportable

Every page under `src/pages/` is designed to be imported by a downstream consumer and wrapped. Rules:
- Takes explicit props (workspace name, sandbox name, etc.)
- Uses internal `src/api/` hooks for data — never assumes external context providers
- No `ApplicationsPage` wrapper, no `ProjectSelector`, no dashboard-specific chrome
- Pure PatternFly components only

## Hooks

Data fetching uses React Query (`@tanstack/react-query`):

```tsx
export const useSandboxes = (workspace: string) =>
  useQuery({
    queryKey: ['sandboxes', workspace],
    queryFn: () => api.listSandboxes(workspace),
  });
```

## TypeScript

- Strict typing, no `any`
- Discriminated unions for complex state
- `type` over `interface` for props

## PatternFly 6

- Barrel imports: `import { Button, Modal } from '@patternfly/react-core'`
- Layout via PF components: `Stack`, `Flex`, `Grid`, `Split`, `Gallery`
- Semantic tokens for any custom SCSS: `var(--pf-t--global--spacer--md)`
- No inline styles with hardcoded values
- No MUI — PatternFly only

## Navigation

Prefer `<Link>` over `useNavigate()`. Reserve `useNavigate` for post-action redirects.

## Testing

- Jest + React Testing Library
- `__tests__/*.spec.tsx` adjacent to source
- `data-testid` selectors preferred, then a11y selectors
