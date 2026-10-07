// The BFF's limit on one upload request. The Files tab sends every file in a
// request of its own, so for the tab it is the limit on one file.
export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

// A file as a picker or a drop zone hands it over. One that comes out of a
// folder says where in the folder it was: the browser's folder picker in
// webkitRelativePath ("project/src/main.go"), the drop zone in path
// ("/project/src/main.go", and "./main.go" for a file on its own).
type PickedFile = File & { path?: string; relativePath?: string };

// Where below the destination directory a picked file goes. Nothing is
// repaired here beyond the leading "./" or "/" a drop zone adds: the BFF
// refuses any path that could leave the destination.
export const uploadRelativePath = (file: File): string => {
  const picked = file as PickedFile;
  const raw =
    picked.webkitRelativePath ||
    picked.path ||
    picked.relativePath ||
    file.name;
  return raw.replace(/^(\.?\/)+/, '') || file.name;
};

export const formatBytes = (bytes: number): string => {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // One decimal below 100, and none where it would be a zero: 64 MiB, 1.5 MiB.
  const rounded = value >= 100 ? Math.round(value) : Number(value.toFixed(1));
  return `${rounded} ${units[unit]}`;
};
