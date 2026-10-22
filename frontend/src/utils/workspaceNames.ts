// What the lists across workspaces need from a resource's metadata: every
// row there names the workspace it is in.
type WorkspaceScoped = { metadata: { workspace?: string } };

// The workspace a resource is in, or '' when the gateway named none.
export const workspaceOf = (item: WorkspaceScoped): string =>
  item.metadata.workspace ?? '';

// A name is only unique within its workspace, so rows across workspaces are
// keyed, and filtered, on both: "team-a/agent".
export const scopedName = (item: {
  metadata: { workspace?: string; name: string };
}): string => `${workspaceOf(item)}/${item.metadata.name}`;

// The path of a workspace's page, or of a page inside it, with each name
// encoded as one path segment.
export const workspacePath = (workspace: string): string =>
  `/workspaces/${encodeURIComponent(workspace)}`;

export const sandboxPath = (workspace: string, name: string): string =>
  `${workspacePath(workspace)}/sandboxes/${encodeURIComponent(name)}`;
