// The cells the lists across workspaces share. The helpers live with the
// rest of the workspace-scoped naming (utils/workspaceNames) and the image
// cell with the sandbox components; this keeps the one import those lists use.
export { scopedName, workspaceOf } from '../utils/workspaceNames';
export { default as ImageReference } from './sandbox/ImageReference';
