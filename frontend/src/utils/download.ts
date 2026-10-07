// Hands text to the browser as a file to save.
export const downloadText = (
  fileName: string,
  text: string,
  type: string,
): void => {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
};
