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

- Use relative imports (`../api/sandboxes`), not the `~/` path alias
- PascalCase files for components, camelCase for hooks
- `data-testid` on interactive and testable elements
- Pages are flat files in `src/pages/` (no subdirectories)
- `src/pages/index.ts` and `src/components/index.ts` are re-export lists that nothing imports; import from the source module

## Pages are self-contained

Every page under `src/pages/` gets what it needs as props and renders inside the app shell. Rules:
- Takes explicit props (workspace name, sandbox name, etc.)
- Loads its data through the `src/api/` hooks
- No app-shell chrome in a page (masthead, navigation, breadcrumbs): `src/app/` adds it
- Pure PatternFly components only

## Hooks

Data fetching uses React Query (`@tanstack/react-query`) with centralized query keys from `src/api/queryKeys.ts`:

```tsx
import { sandboxKeys } from './queryKeys';

export const useSandboxes = (workspace: string, labelSelector?: string) =>
  useQuery({
    queryKey: sandboxKeys.list(workspace, labelSelector),
    queryFn: () => listSandboxes(workspace, labelSelector),
  });
```

API client functions use `get`, `post`, `put`, `del` from `./client`:

```tsx
import { get, post, del } from './client';

export const listSandboxes = (workspace: string): Promise<Sandbox[]> =>
  get<Sandbox[]>(`/api/v1/workspaces/${workspace}/sandboxes`);
```

Custom hooks for shared UI patterns live in `src/hooks/` (e.g., `useBulkDelete`, `useListPage`, `useTableSelection`).

## TypeScript

- Strict typing, no `any`
- Discriminated unions for complex state
- `type` over `interface` for props

## PatternFly 6

- Barrel imports: `import { Button, Modal } from '@patternfly/react-core'`
- No MUI, no custom design system
- No project CSS files
- A `style` prop only for what PatternFly has no prop or utility class for

### Styling hierarchy (prefer top, fallback down)

1. **PF component props** — `<Flex gap={{ default: 'gapSm' }}>`, `<FlexItem flex={{ default: 'flex_1' }}>`, `<Content component="p">`, `<Title size={TitleSizes.md}>`. Always the first choice.
2. **PF utility classes** — `pf-v6-u-text-truncate`, `pf-v6-u-font-family-monospace`, etc. Use only when no component prop exists for the style.
3. **A `style` prop** — only for what PatternFly has no prop or utility class for, such as `minWidth: 0` for flex truncation. Never a CSS file of the project's own.

## Navigation

Prefer `<Link>` over `useNavigate()`. Reserve `useNavigate` for post-action redirects.

## Testing

- Jest + React Testing Library
- `__tests__/*.spec.tsx` adjacent to source
- `data-testid` selectors preferred, then a11y selectors
