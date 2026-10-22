export const workspaceOf = (item: {
  metadata: { workspace?: string };
}): string => item.metadata.workspace ?? '';

// Names are unique only within a workspace.
export const scopedName = (item: {
  metadata: { workspace?: string; name: string };
}): string => `${workspaceOf(item)}/${item.metadata.name}`;

export const ImageReference: React.FC<{ image?: string }> = ({ image }) =>
  image ? (
    <span className="pf-v6-u-font-family-monospace" title={image}>
      {image}
    </span>
  ) : (
    <>-</>
  );
